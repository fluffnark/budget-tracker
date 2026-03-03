from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, Category, Merchant, Transaction
from app.security import stable_hash

_UTILITIES_WHITELIST = {
    "PNM",
    "XCEL",
    "COMCAST",
    "CENTURYLINK",
    "T-MOBILE",
    "VERIZON",
    "AT&T",
}


def _build_category_paths(categories: list[Category]) -> dict[int, str]:
    by_id = {category.id: category for category in categories}
    cache: dict[int, str] = {}

    def walk(category_id: int, seen: set[int] | None = None) -> str:
        if category_id in cache:
            return cache[category_id]
        seen = seen or set()
        category = by_id[category_id]
        if category.parent_id is None or category.parent_id not in by_id:
            cache[category_id] = category.name
            return cache[category_id]
        if category_id in seen:
            cache[category_id] = category.name
            return cache[category_id]
        seen.add(category_id)
        path = f"{walk(category.parent_id, seen)} > {category.name}"
        cache[category_id] = path
        return path

    for category in categories:
        walk(category.id)
    return cache


def _build_category_tree(categories: list[Category], path_map: dict[int, str]) -> list[dict]:
    children_map: dict[int | None, list[Category]] = defaultdict(list)
    for category in categories:
        children_map[category.parent_id].append(category)
    for parent_id in children_map:
        children_map[parent_id].sort(key=lambda item: item.name.lower())

    def node(category: Category) -> dict:
        return {
            "id": category.id,
            "name": category.name,
            "full_path": path_map[category.id],
            "parent_id": category.parent_id,
            "system_kind": category.system_kind,
            "color": category.color,
            "icon": category.icon,
            "children": [node(child) for child in children_map.get(category.id, [])],
        }

    return [node(root) for root in children_map.get(None, [])]


def build_llm_export(
    db: Session,
    *,
    start: date,
    end: date,
    scrub: bool,
    hash_merchants: bool,
    round_amounts: bool,
) -> dict:
    q = (
        select(Transaction, Account, Category, Merchant)
        .join(Account, Account.id == Transaction.account_id)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .outerjoin(Merchant, Merchant.id == Transaction.merchant_id)
        .where(Transaction.posted_at >= datetime.combine(start, datetime.min.time(), tzinfo=UTC))
        .where(
            Transaction.posted_at
            < datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
        )
    )

    txns = []
    monthly = defaultdict(lambda: {"inflow": 0.0, "outflow": 0.0, "net": 0.0})
    categories_all = list(db.execute(select(Category).order_by(Category.id.asc())).scalars())
    category_paths = _build_category_paths(categories_all)

    for txn, account, category, merchant in db.execute(q).all():
        amount = float(txn.amount)
        export_amount = amount
        if scrub and round_amounts:
            export_amount = round(amount / 5) * 5

        merchant_name = merchant.name_canonical if merchant else None
        if scrub and merchant_name and hash_merchants:
            if not any(name in merchant_name.upper() for name in _UTILITIES_WHITELIST):
                merchant_name = f"m_{stable_hash(merchant_name)}"

        entry = {
            "id": txn.id,
            "transaction_id": txn.id,
            "date": txn.posted_at.date().isoformat(),
            "amount": round(export_amount, 2),
            "currency": txn.currency,
            "description_norm": txn.description_norm,
            "merchant_canonical": merchant_name,
            "account_type": account.type,
            "category_id": category.id if category else None,
            "category_path": (
                category_paths.get(category.id, category.name)
                if category
                else "Uncategorized/Needs Review"
            ),
            "category": (
                category_paths.get(category.id, category.name)
                if category
                else "Uncategorized/Needs Review"
            ),
            "is_pending": txn.is_pending,
            "is_transfer": txn.transfer_id is not None,
            "notes": txn.notes,
        }

        if not scrub:
            entry["account_name"] = account.name
            entry["description_raw"] = txn.description_raw

        month_key = txn.posted_at.strftime("%Y-%m")
        if amount >= 0:
            monthly[month_key]["inflow"] += amount
        else:
            monthly[month_key]["outflow"] += abs(amount)
        monthly[month_key]["net"] = monthly[month_key]["inflow"] - monthly[month_key]["outflow"]

        txns.append(entry)

    categories = [
        {
            "id": category.id,
            "name": category.name,
            "full_path": category_paths.get(category.id, category.name),
            "parent_id": category.parent_id,
            "system_kind": category.system_kind,
            "color": category.color,
            "icon": category.icon,
        }
        for category in categories_all
    ]
    category_tree = _build_category_tree(categories_all, category_paths)

    summary = [
        {
            "month": month,
            "inflow": round(values["inflow"], 2),
            "outflow": round(values["outflow"], 2),
            "net": round(values["net"], 2),
        }
        for month, values in sorted(monthly.items())
    ]

    prompt_template = (
        "# Role\n"
        "You are a finance categorization assistant.\n\n"
        "# Output Gate\n"
        "Return exactly one JSON object and nothing else.\n"
        "Do not include thoughts, explanations, markdown, or code fences.\n"
        "First character must be `{` and last character must be `}`.\n\n"
        "# Primary Goal\n"
        "Categorize uncategorized transactions using ONLY the provided category IDs.\n\n"
        "# Required Workflow\n"
        "1. Inspect `transactions`.\n"
        "2. Select ONLY rows where `needs_category_review` is true.\n"
        "3. Ignore rows where `needs_category_review` is false.\n"
        "4. For each selected row, choose the best `category_id` from `categories` / `category_tree`.\n"
        "5. Add reusable `proposed_rules` only when pattern quality is high.\n"
        "6. Provide concise `insights`.\n\n"
        "# Non-Negotiable Rules\n"
        "- Output MUST be strict JSON only (no markdown, no prose, no code fences).\n"
        "- If any rows have `needs_category_review=true`, `proposed_assignments` MUST NOT be empty.\n"
        "- `proposed_assignments` may be empty ONLY when zero rows have `needs_category_review=true`.\n"
        "- `transaction_id` values MUST come verbatim from `transactions[].transaction_id` in Input Data.\n"
        "- Never use `id` in assignments; always return `transaction_id`.\n"
        "- Never invent transaction IDs or category IDs.\n"
        "- Use ONLY valid category IDs from `categories`.\n"
        "- At most one assignment per `transaction_id`.\n"
        "- Allowed rule `match_type`: `contains`, `regex`, `merchant`, `account`.\n"
        "- For regex, use JSON-escaped strings (example: `\"\\\\bVANGUARD\\\\b\"`).\n"
        "- Use transfer categories (`46`/`47`) only for true transfer/payment flows, not normal spend.\n"
        "- Keep `reason` short and specific.\n\n"
        "# Insights Shape Rules\n"
        "- `insights.recurring_costs` must be objects with `label` and `estimated_monthly`.\n"
        "- `insights.utilities_seasonality` must be objects with `category` and `trend`.\n"
        "- `insights.savings_opportunities` must be objects with `title`, `monthly_impact`, and `action`.\n\n"
        "# Anti-Hallucination Check\n"
        "- Verify every proposed `transaction_id` exists in Input Data before finalizing.\n"
        "- Prefer fewer high-confidence assignments over many weak guesses.\n\n"
        "# Categorization Rubric (Use This)\n"
        "1. Amount sign first:\n"
        "- Positive amount: prefer Income categories unless clearly a transfer/reversal.\n"
        "- Negative amount: prefer Expense categories unless clearly a transfer/payment.\n"
        "2. Transfer decision:\n"
        "- Use `46`/`47` only for account-to-account movement, card payments, ACH transfers, broker sweeps.\n"
        "- DO NOT use `46`/`47` for merchants (groceries, utilities, travel, restaurants, retail, streaming).\n"
        "3. Keyword-to-category hints:\n"
        "- INTERNET/STARLINK/COMCAST -> Utilities/Internet (14)\n"
        "- ELECTRIC/PNM/POWER -> Utilities/Electric (10)\n"
        "- WATER/TRASH -> Utilities/Water (12) or Utilities/Trash (13)\n"
        "- COSTCO/SAFEWAY/TRADER JOE/WHOLE FOODS -> Groceries (17)\n"
        "- RESTAURANT/DOORDASH/UBER EATS -> Dining (18)\n"
        "- SHELL/CHEVRON/EXXON/CIRCLE K -> Fuel (20)\n"
        "- PAYROLL/SALARY -> Salary (2)\n"
        "- INTEREST/DIVIDEND -> Other Income (4)\n"
        "4. Confidence policy:\n"
        "- If uncertain, skip that transaction instead of forcing a weak assignment.\n"
        "- Prioritize precision over recall.\n\n"
        "# Rule Generation Policy\n"
        "- Create a rule only if at least 2 transactions share the same stable merchant/description pattern.\n"
        "- Avoid overly broad patterns like `PAYMENT`, `TRANSFER`, `PURCHASE`, or single generic words.\n"
        "- Keep rule priorities in 700-900 for specific merchants/patterns.\n\n"
        "# Output JSON Schema\n"
        "{\n"
        '  "proposed_assignments": [\n'
        '    {"transaction_id":"string","category_id":123,"reason":"short"}\n'
        "  ],\n"
        '  "proposed_rules": [\n'
        '    {"match_type":"contains|regex|merchant|account","pattern":"string","category_id":123,"priority":100,"reason":"short"}\n'
        "  ],\n"
        '  "insights": {\n'
        '    "recurring_costs":[{"label":"string","estimated_monthly":0}],\n'
        '    "utilities_seasonality":[{"category":"string","trend":"string"}],\n'
        '    "savings_opportunities":[{"title":"string","monthly_impact":0,"action":"string"}]\n'
        "  }\n"
        "}\n\n"
        "# Minimal Valid Example\n"
        "{\n"
        '  "proposed_assignments":[{"transaction_id":"abc","category_id":12,"reason":"merchant match"}],\n'
        '  "proposed_rules":[],\n'
        '  "insights":{"recurring_costs":[],"utilities_seasonality":[],"savings_opportunities":[]}\n'
        "}\n\n"
        "# Final Self-Check Before Reply\n"
        "- JSON parses.\n"
        "- No extra keys.\n"
        "- All `transaction_id` values exist in Input Data.\n"
        "- Assignment coverage is non-empty when uncategorized rows exist."
    )

    return {
        "transactions": txns,
        "categories": categories,
        "category_tree": category_tree,
        "summary": summary,
        "prompt_template": prompt_template,
    }
