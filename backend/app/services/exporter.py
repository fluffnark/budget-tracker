from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile
from xml.sax.saxutils import escape

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Account, BalanceSnapshot, Category, Merchant, Transaction
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


def build_sheets_export(
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
        .order_by(Transaction.posted_at.asc(), Transaction.id.asc())
    )

    categories_all = list(db.execute(select(Category).order_by(Category.id.asc())).scalars())
    category_paths = _build_category_paths(categories_all)
    latest_balance_ids = (
        select(
            BalanceSnapshot.account_id,
            BalanceSnapshot.id.label("latest_snapshot_id"),
        )
        .where(
            BalanceSnapshot.id.in_(
                select(func.max(BalanceSnapshot.id)).group_by(BalanceSnapshot.account_id)
            )
        )
        .subquery()
    )
    latest_balance_subq = (
        select(
            BalanceSnapshot.account_id,
            BalanceSnapshot.balance,
            BalanceSnapshot.available_balance,
            BalanceSnapshot.captured_at,
        )
        .join(
            latest_balance_ids,
            BalanceSnapshot.id == latest_balance_ids.c.latest_snapshot_id,
        )
        .subquery()
    )
    account_balances = {
        row.account_id: row
        for row in db.execute(select(latest_balance_subq)).all()
    }

    def export_amount(amount: float) -> float:
        if scrub and round_amounts:
            return round(amount / 5) * 5
        return amount

    def export_merchant(name: str | None) -> str | None:
        if not name:
            return None
        if scrub and hash_merchants:
            if not any(token in name.upper() for token in _UTILITIES_WHITELIST):
                return f"m_{stable_hash(name)}"
        return name

    def export_account_name(account: Account) -> str:
        if scrub:
            return f"{account.source_type}:{account.type}:{stable_hash(account.id)[:8]}"
        return account.name

    def category_parts(category: Category | None) -> tuple[str, str]:
        if category is None:
            return ("Uncategorized/Needs Review", "Uncategorized/Needs Review")
        path = category_paths.get(category.id, category.name)
        family = path.split(" > ")[0].strip()
        return (family, path)

    monthly_summary: dict[str, dict[str, float | int]] = defaultdict(
        lambda: {
            "income": 0.0,
            "spending": 0.0,
            "transfers": 0.0,
            "savings_transfers": 0.0,
            "net_cashflow": 0.0,
            "txn_count": 0,
        }
    )
    category_monthly: dict[tuple[str, str, str], float] = defaultdict(float)
    family_totals: dict[str, float] = defaultdict(float)
    category_totals: dict[str, float] = defaultdict(float)
    daily_spend: dict[str, float] = defaultdict(float)
    transactions_rows: list[list[object | None]] = []
    largest_outflow: tuple[str, float] | None = None
    largest_inflow: tuple[str, float] | None = None
    pending_count = 0

    for txn, account, category, merchant in db.execute(q).all():
        amount = float(txn.amount)
        normalized_amount = round(export_amount(amount), 2)
        merchant_name = export_merchant(merchant.name_canonical if merchant else None)
        family, category_path = category_parts(category)
        month_key = txn.posted_at.strftime("%Y-%m")
        category_kind = category.system_kind if category else "uncategorized"
        abs_amount = abs(normalized_amount)

        transactions_rows.append(
            [
                txn.id,
                txn.posted_at.date().isoformat(),
                month_key,
                normalized_amount,
                abs_amount,
                txn.currency,
                export_account_name(account),
                account.type,
                account.source_type,
                family,
                category_path,
                category_kind,
                merchant_name,
                txn.description_norm,
                txn.is_pending,
                txn.transfer_id is not None or category_kind == "transfer",
                txn.notes,
            ]
        )

        monthly_summary[month_key]["txn_count"] += 1
        pending_count += 1 if txn.is_pending else 0
        if normalized_amount >= 0:
            monthly_summary[month_key]["income"] += normalized_amount
            if largest_inflow is None or normalized_amount > largest_inflow[1]:
                largest_inflow = (txn.description_norm, normalized_amount)
        else:
            if category_kind == "transfer" or txn.transfer_id is not None:
                monthly_summary[month_key]["transfers"] += abs_amount
                if category_path.lower().find("savings") >= 0 or category_path.lower().find("roth") >= 0:
                    monthly_summary[month_key]["savings_transfers"] += abs_amount
            else:
                monthly_summary[month_key]["spending"] += abs_amount
                category_monthly[(month_key, family, category_path)] += abs_amount
                family_totals[family] += abs_amount
                category_totals[category_path] += abs_amount
                daily_spend[txn.posted_at.date().isoformat()] += abs_amount
                if largest_outflow is None or abs_amount > largest_outflow[1]:
                    largest_outflow = (txn.description_norm, abs_amount)

    monthly_rows: list[list[object]] = []
    for month_key, values in sorted(monthly_summary.items()):
        income = float(values["income"])
        spending = float(values["spending"])
        transfers = float(values["transfers"])
        savings_transfers = float(values["savings_transfers"])
        net_cashflow = income - spending
        monthly_rows.append(
            [
                month_key,
                round(income, 2),
                round(spending, 2),
                round(transfers, 2),
                round(savings_transfers, 2),
                round(net_cashflow, 2),
                int(values["txn_count"]),
            ]
        )

    category_month_rows = [
        [month, family, category_path, round(amount, 2)]
        for (month, family, category_path), amount in sorted(
            category_monthly.items(), key=lambda item: (item[0][0], -item[1], item[0][2])
        )
    ]
    family_total_rows = [
        [family, round(amount, 2)]
        for family, amount in sorted(family_totals.items(), key=lambda item: (-item[1], item[0]))
    ]
    category_total_rows = [
        [path, path.split(" > ")[0].strip(), round(amount, 2)]
        for path, amount in sorted(category_totals.items(), key=lambda item: (-item[1], item[0]))
    ]

    account_rows: list[list[object | None]] = []
    accounts = list(db.execute(select(Account).order_by(Account.name.asc())).scalars())
    for account in accounts:
        balance = account_balances.get(account.id)
        snapshot_balance = round(float(balance.balance), 2) if balance and balance.balance is not None else None
        snapshot_available = (
            round(float(balance.available_balance), 2)
            if balance and balance.available_balance is not None
            else None
        )
        account_rows.append(
            [
                export_account_name(account),
                account.type,
                account.source_type,
                account.currency,
                bool(account.is_active),
                snapshot_balance,
                snapshot_available,
                balance.captured_at.isoformat() if balance and balance.captured_at else None,
            ]
        )

    total_income = round(sum(float(values["income"]) for values in monthly_summary.values()), 2)
    total_spending = round(sum(float(values["spending"]) for values in monthly_summary.values()), 2)
    total_transfers = round(sum(float(values["transfers"]) for values in monthly_summary.values()), 2)
    total_savings_transfers = round(
        sum(float(values["savings_transfers"]) for values in monthly_summary.values()), 2
    )
    range_days = max(1, (end - start).days + 1)
    range_months = max(1, len(monthly_rows))
    avg_weekly_spend = round((total_spending / range_days) * 7, 2)
    avg_monthly_spend = round(total_spending / range_months, 2)
    analytics_summary_rows = [
        ["period_start", start.isoformat()],
        ["period_end", end.isoformat()],
        ["transaction_count", len(transactions_rows)],
        ["pending_transaction_count", pending_count],
        ["income_total", total_income],
        ["spending_total_ex_transfers", total_spending],
        ["transfer_volume", total_transfers],
        ["savings_transfer_volume", total_savings_transfers],
        ["net_cashflow_ex_transfers", round(total_income - total_spending, 2)],
        ["avg_weekly_spend", avg_weekly_spend],
        ["avg_monthly_spend", avg_monthly_spend],
        ["largest_outflow_label", largest_outflow[0] if largest_outflow else None],
        ["largest_outflow_amount", largest_outflow[1] if largest_outflow else None],
        ["largest_inflow_label", largest_inflow[0] if largest_inflow else None],
        ["largest_inflow_amount", largest_inflow[1] if largest_inflow else None],
    ]
    family_analytics_rows = []
    for family, amount in sorted(family_totals.items(), key=lambda item: (-item[1], item[0])):
        share = round(amount / total_spending, 4) if total_spending > 0 else 0
        family_analytics_rows.append(
            [family, round(amount, 2), share, round(amount / range_months, 2)]
        )
    daily_spend_rows = [
        [day, round(amount, 2)] for day, amount in sorted(daily_spend.items())
    ]

    return {
        "workbook_name": f"budget-tracker-sheets-{start.isoformat()}-to-{end.isoformat()}",
        "generated_at": datetime.now(UTC).isoformat(),
        "sheets": [
            {
                "name": "transactions",
                "columns": [
                    "transaction_id",
                    "date",
                    "month",
                    "signed_amount",
                    "absolute_amount",
                    "currency",
                    "account",
                    "account_type",
                    "source_type",
                    "family",
                    "category_path",
                    "category_kind",
                    "merchant",
                    "description_norm",
                    "is_pending",
                    "is_transfer",
                    "notes",
                ],
                "rows": transactions_rows,
            },
            {
                "name": "monthly_summary",
                "columns": [
                    "month",
                    "income",
                    "spending_ex_transfers",
                    "transfer_volume",
                    "savings_transfer_volume",
                    "net_cashflow_ex_transfers",
                    "transaction_count",
                ],
                "rows": monthly_rows,
            },
            {
                "name": "category_monthly",
                "columns": ["month", "family", "category_path", "spending"],
                "rows": category_month_rows,
            },
            {
                "name": "family_totals",
                "columns": ["family", "spending"],
                "rows": family_total_rows,
            },
            {
                "name": "accounts_snapshot",
                "columns": [
                    "account",
                    "account_type",
                    "source_type",
                    "currency",
                    "is_active",
                    "balance",
                    "available_balance",
                    "snapshot_captured_at",
                ],
                "rows": account_rows,
            },
            {
                "name": "analytics_summary",
                "columns": ["metric", "value"],
                "rows": analytics_summary_rows,
            },
            {
                "name": "analytics_family",
                "columns": [
                    "family",
                    "spending",
                    "share_pct_of_spending",
                    "avg_monthly_spending",
                ],
                "rows": family_analytics_rows,
            },
            {
                "name": "analytics_categories",
                "columns": ["category_path", "family", "spending"],
                "rows": category_total_rows,
            },
            {
                "name": "analytics_daily_spend",
                "columns": ["date", "spending"],
                "rows": daily_spend_rows,
            },
        ],
    }


def build_sheets_xlsx(workbook: dict) -> bytes:
    dashboard_metrics = {
        "Income total": "currency",
        "Spending total": "currency",
        "Transfer volume": "currency",
        "Savings transfer volume": "currency",
        "Net cashflow": "currency",
        "Average weekly spend": "currency",
        "Average monthly family spend": "currency",
        "Top family spend": "currency",
        "Months in export": "integer",
    }

    def col_name(index: int) -> str:
        out = ""
        n = index
        while n > 0:
            n, rem = divmod(n - 1, 26)
            out = chr(65 + rem) + out
        return out

    def style_id(style_name: str | None) -> str:
        style_map = {
            None: "0",
            "header": "1",
            "currency": "2",
            "percent": "3",
            "date": "4",
            "integer": "5",
            "title": "6",
        }
        return style_map.get(style_name, "0")

    def xml_cell(cell_ref: str, value: object | None, *, style_name: str | None = None) -> str:
        style_attr = f' s="{style_id(style_name)}"' if style_name else ""
        if isinstance(value, dict) and "formula" in value:
            formula = escape(str(value["formula"]))
            return f'<c r="{cell_ref}"{style_attr}><f>{formula}</f></c>'
        if value is None:
            return f'<c r="{cell_ref}"{style_attr}/>'
        if isinstance(value, bool):
            return f'<c r="{cell_ref}" t="b"{style_attr}><v>{1 if value else 0}</v></c>'
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f'<c r="{cell_ref}"{style_attr}><v>{value}</v></c>'
        text = escape(str(value))
        return f'<c r="{cell_ref}" t="inlineStr"{style_attr}><is><t>{text}</t></is></c>'

    def sanitize_sheet_name(name: str, used: set[str]) -> str:
        cleaned = "".join("_" if ch in '[]:*?/\\' else ch for ch in name)[:31] or "Sheet"
        candidate = cleaned
        counter = 2
        while candidate in used:
            suffix = f"_{counter}"
            candidate = f"{cleaned[: max(1, 31 - len(suffix))]}{suffix}"
            counter += 1
        used.add(candidate)
        return candidate

    used_names: set[str] = set()
    workbook_sheets = []
    dashboard_name = sanitize_sheet_name("dashboard", used_names)
    workbook_sheets.append({"id": 1, "name": dashboard_name, "columns": [], "rows": []})
    for idx, sheet in enumerate(workbook["sheets"], start=2):
        workbook_sheets.append(
            {
                "id": idx,
                "source_name": sheet["name"],
                "name": sanitize_sheet_name(sheet["name"], used_names),
                "columns": sheet["columns"],
                "rows": sheet["rows"],
            }
        )
    sheet_name_by_source = {
        sheet.get("source_name", sheet["name"]): sheet["name"] for sheet in workbook_sheets
    }

    family_rows = next(
        (len(sheet["rows"]) for sheet in workbook["sheets"] if sheet["name"] == "analytics_family"),
        0,
    )
    monthly_rows = next(
        (len(sheet["rows"]) for sheet in workbook["sheets"] if sheet["name"] == "monthly_summary"),
        0,
    )
    daily_rows = next(
        (len(sheet["rows"]) for sheet in workbook["sheets"] if sheet["name"] == "analytics_daily_spend"),
        0,
    )

    def sheet_ref(source_name: str) -> str:
        return f"'{sheet_name_by_source[source_name]}'"

    family_sheet_ref = sheet_ref("analytics_family")
    monthly_sheet_ref = sheet_ref("monthly_summary")
    daily_sheet_ref = sheet_ref("analytics_daily_spend")
    category_sheet_ref = sheet_ref("analytics_categories")
    category_rows = next(
        (len(sheet["rows"]) for sheet in workbook["sheets"] if sheet["name"] == "analytics_categories"),
        0,
    )

    dashboard_rows: list[list[object | None]] = [
        ["Budget Tracker Analytics Dashboard", None],
        ["Metric", "Formula-driven value"],
        ["Income total", {"formula": f"SUM({monthly_sheet_ref}!B2:B{monthly_rows + 1})"}],
        ["Spending total", {"formula": f"SUM({monthly_sheet_ref}!C2:C{monthly_rows + 1})"}],
        ["Transfer volume", {"formula": f"SUM({monthly_sheet_ref}!D2:D{monthly_rows + 1})"}],
        ["Savings transfer volume", {"formula": f"SUM({monthly_sheet_ref}!E2:E{monthly_rows + 1})"}],
        ["Net cashflow", {"formula": "B3-B4"}],
        [
            "Average weekly spend",
            {"formula": f"AVERAGE({daily_sheet_ref}!B2:B{daily_rows + 1})*7"},
        ],
        [
            "Average monthly family spend",
            {"formula": f"AVERAGE({family_sheet_ref}!D2:D{family_rows + 1})"},
        ],
        ["Top family spend", {"formula": f"MAX({family_sheet_ref}!B2:B{family_rows + 1})"}],
        [
            "Top family label",
            {
                "formula": f"INDEX({family_sheet_ref}!A2:A{family_rows + 1},MATCH(B10,{family_sheet_ref}!B2:B{family_rows + 1},0))"
            },
        ],
        ["Months in export", {"formula": f"COUNTA({monthly_sheet_ref}!A2:A{monthly_rows + 1})"}],
        ["Rows below update automatically when source tabs change.", None],
    ]

    rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>"""
    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/xl/drawings/drawing1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>
  <Override PartName="/xl/charts/chart1.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
  <Override PartName="/xl/charts/chart2.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
  <Override PartName="/xl/charts/chart3.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>
""" + "".join(
        f'  <Override PartName="/xl/worksheets/sheet{sheet["id"]}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\n'
        for sheet in workbook_sheets
    ) + "</Types>"
    workbook_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
""" + "".join(
        f'    <sheet name="{escape(sheet["name"])}" sheetId="{sheet["id"]}" r:id="rId{sheet["id"]}"/>\n'
        for sheet in workbook_sheets
    ) + """  </sheets>
</workbook>"""
    workbook_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
""" + "".join(
        f'  <Relationship Id="rId{sheet["id"]}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{sheet["id"]}.xml"/>\n'
        for sheet in workbook_sheets
    ) + """  <Relationship Id="rId100" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>"""
    styles = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <numFmts count="3">
    <numFmt numFmtId="164" formatCode="$#,##0.00"/>
    <numFmt numFmtId="165" formatCode="0.00%"/>
    <numFmt numFmtId="166" formatCode="yyyy-mm-dd"/>
  </numFmts>
  <cellXfs count="7">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left"/></xf>
    <xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left"/></xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>"""
    created = escape(datetime.now(UTC).replace(microsecond=0).isoformat())
    core = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>{escape(workbook["workbook_name"])}</dc:title>
  <dc:creator>Budget Tracker</dc:creator>
  <cp:lastModifiedBy>Budget Tracker</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">{created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">{created}</dcterms:modified>
</cp:coreProperties>"""
    app = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Budget Tracker</Application>
  <TitlesOfParts><vt:vector size="{len(workbook_sheets)}" baseType="lpstr">""" + "".join(
        f"<vt:lpstr>{escape(sheet['name'])}</vt:lpstr>" for sheet in workbook_sheets
    ) + """</vt:vector></TitlesOfParts>
</Properties>"""

    def infer_style(
        sheet_name: str,
        row_idx: int,
        col_idx: int,
        value: object | None,
        *,
        columns: list[str],
        include_header: bool = True,
    ) -> str | None:
        if include_header and row_idx == 1:
            return "header"
        if sheet_name == dashboard_name:
            if row_idx == 1:
                return "title"
            if row_idx == 2:
                return "header"
            if row_idx >= 3 and col_idx == 2:
                metric = str(dashboard_rows[row_idx - 1][0])
                return dashboard_metrics.get(metric)
        if not columns or col_idx > len(columns):
            return None
        header = columns[col_idx - 1]
        if header in {"date", "period_start", "period_end"}:
            return "date"
        if header in {
            "income",
            "spending_ex_transfers",
            "transfer_volume",
            "savings_transfer_volume",
            "net_cashflow_ex_transfers",
            "spending",
            "balance",
            "available_balance",
            "signed_amount",
            "absolute_amount",
            "avg_monthly_spending",
            "value",
        }:
            return "currency" if isinstance(value, (int, float)) or isinstance(value, dict) else None
        if header == "share_pct_of_spending":
            return "percent"
        if header in {"transaction_count", "pending_transaction_count", "is_pending", "is_transfer"}:
            return "integer" if isinstance(value, (int, float)) or isinstance(value, dict) else None
        return None

    def sheet_xml(
        columns: list[str],
        rows: list[list[object | None]],
        *,
        with_drawing: bool = False,
        sheet_name: str,
        include_header: bool = True,
    ) -> str:
        all_rows = [columns, *rows] if include_header else rows
        row_xml = []
        for row_idx, row in enumerate(all_rows, start=1):
            cells = []
            for col_idx, value in enumerate(row, start=1):
                style_name = infer_style(
                    sheet_name,
                    row_idx,
                    col_idx,
                    value,
                    columns=columns,
                    include_header=include_header,
                )
                cells.append(
                    xml_cell(f"{col_name(col_idx)}{row_idx}", value, style_name=style_name)
                )
            row_xml.append(f'<row r="{row_idx}">{"".join(cells)}</row>')
        drawing_xml = (
            '<drawing xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId1"/>'
            if with_drawing
            else ""
        )
        return """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>""" + "".join(row_xml) + f"""</sheetData>{drawing_xml}
</worksheet>"""

    def dashboard_sheet_xml() -> str:
        return sheet_xml(
            [],
            dashboard_rows,
            with_drawing=True,
            sheet_name=dashboard_name,
            include_header=False,
        )

    def chart_xml(title: str, category_range: str, value_range: str) -> str:
        return f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <c:chart>
    <c:title>
      <c:tx>
        <c:rich>
          <a:bodyPr/>
          <a:lstStyle/>
          <a:p><a:r><a:t>{escape(title)}</a:t></a:r></a:p>
        </c:rich>
      </c:tx>
    </c:title>
    <c:plotArea>
      <c:layout/>
      <c:barChart>
        <c:barDir val="col"/>
        <c:grouping val="clustered"/>
        <c:varyColors val="0"/>
        <c:ser>
          <c:idx val="0"/>
          <c:order val="0"/>
          <c:tx><c:v>{escape(title)}</c:v></c:tx>
          <c:cat><c:strRef><c:f>{escape(category_range)}</c:f></c:strRef></c:cat>
          <c:val><c:numRef><c:f>{escape(value_range)}</c:f></c:numRef></c:val>
        </c:ser>
        <c:axId val="123456"/>
        <c:axId val="123457"/>
      </c:barChart>
      <c:catAx>
        <c:axId val="123456"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:axPos val="b"/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="123457"/>
        <c:crosses val="autoZero"/>
        <c:auto val="1"/>
        <c:lblAlgn val="ctr"/>
        <c:lblOffset val="100"/>
      </c:catAx>
      <c:valAx>
        <c:axId val="123457"/>
        <c:scaling><c:orientation val="minMax"/></c:scaling>
        <c:axPos val="l"/>
        <c:majorGridlines/>
        <c:tickLblPos val="nextTo"/>
        <c:crossAx val="123456"/>
        <c:crosses val="autoZero"/>
      </c:valAx>
    </c:plotArea>
    <c:legend><c:legendPos val="r"/></c:legend>
    <c:plotVisOnly val="1"/>
  </c:chart>
</c:chartSpace>"""

    drawing_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr><xdr:cNvPr id="2" name="Family Spend Chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId1"/></a:graphicData></a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>3</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>18</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>33</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr><xdr:cNvPr id="3" name="Monthly Spend Chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId2"/></a:graphicData></a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
  <xdr:twoCellAnchor>
    <xdr:from><xdr:col>10</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>1</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>
    <xdr:to><xdr:col>16</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>16</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>
    <xdr:graphicFrame macro="">
      <xdr:nvGraphicFramePr><xdr:cNvPr id="4" name="Top Category Spend Chart"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>
      <xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>
      <a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart r:id="rId3"/></a:graphicData></a:graphic>
    </xdr:graphicFrame>
    <xdr:clientData/>
  </xdr:twoCellAnchor>
</xdr:wsDr>"""
    drawing_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart2.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart3.xml"/>
</Relationships>"""
    dashboard_sheet_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing1.xml"/>
</Relationships>"""

    output = BytesIO()
    with ZipFile(output, "w", compression=ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types)
        archive.writestr("_rels/.rels", rels)
        archive.writestr("docProps/core.xml", core)
        archive.writestr("docProps/app.xml", app)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        archive.writestr("xl/styles.xml", styles)
        for sheet in workbook_sheets:
            if sheet["id"] == 1:
                archive.writestr(f"xl/worksheets/sheet{sheet['id']}.xml", dashboard_sheet_xml())
                archive.writestr(
                    f"xl/worksheets/_rels/sheet{sheet['id']}.xml.rels",
                    dashboard_sheet_rels,
                )
                continue
            archive.writestr(
                f"xl/worksheets/sheet{sheet['id']}.xml",
                sheet_xml(sheet["columns"], sheet["rows"], sheet_name=sheet["name"]),
            )
        archive.writestr("xl/drawings/drawing1.xml", drawing_xml)
        archive.writestr("xl/drawings/_rels/drawing1.xml.rels", drawing_rels)
        archive.writestr(
            "xl/charts/chart1.xml",
            chart_xml(
                "Family Spending",
                f"{family_sheet_ref}!$A$2:$A${family_rows + 1}",
                f"{family_sheet_ref}!$B$2:$B${family_rows + 1}",
            ),
        )
        archive.writestr(
            "xl/charts/chart2.xml",
            chart_xml(
                "Monthly Spending",
                f"{monthly_sheet_ref}!$A$2:$A${monthly_rows + 1}",
                f"{monthly_sheet_ref}!$C$2:$C${monthly_rows + 1}",
            ),
        )
        archive.writestr(
            "xl/charts/chart3.xml",
            chart_xml(
                "Top Category Spending",
                f"{category_sheet_ref}!$A$2:$A${min(category_rows + 1, 11)}",
                f"{category_sheet_ref}!$C$2:$C${min(category_rows + 1, 11)}",
            ),
        )
    return output.getvalue()
