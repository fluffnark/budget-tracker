from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import re
from statistics import mean

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.models import BudgetCategoryPlan, BudgetMonth, Category, Merchant, Transaction


@dataclass
class _CategoryInfo:
    id: int
    name: str
    path: str
    parent_id: int | None
    parent_name: str | None
    family_name: str
    spend_bucket: str | None
    color: str | None
    icon: str | None
    has_children: bool


def _month_start(value: date) -> date:
    return date(value.year, value.month, 1)


def _next_month(value: date) -> date:
    if value.month == 12:
        return date(value.year + 1, 1, 1)
    return date(value.year, value.month + 1, 1)


def _period_bounds(period: str, anchor: date) -> tuple[date, date]:
    if period == "weekly":
        start = anchor - timedelta(days=anchor.weekday())
        end = start + timedelta(days=6)
        return start, end
    if period == "monthly":
        start = date(anchor.year, anchor.month, 1)
        end = _next_month(start) - timedelta(days=1)
        return start, end
    if period == "yearly":
        return date(anchor.year, 1, 1), date(anchor.year, 12, 31)
    raise ValueError(f"Unsupported period: {period}")


def _category_path_map(categories: list[Category]) -> dict[int, str]:
    by_id = {category.id: category for category in categories}
    cache: dict[int, str] = {}

    def walk(category_id: int, seen: set[int] | None = None) -> str:
        if category_id in cache:
            return cache[category_id]
        category = by_id[category_id]
        if category.parent_id is None or category.parent_id not in by_id:
            cache[category_id] = category.name
            return category.name
        seen = seen or set()
        if category_id in seen:
            cache[category_id] = category.name
            return category.name
        seen.add(category_id)
        cache[category_id] = f"{walk(category.parent_id, seen)} > {category.name}"
        return cache[category_id]

    for category in categories:
        walk(category.id)
    return cache


def _load_category_info(db: Session) -> tuple[list[_CategoryInfo], dict[int, _CategoryInfo]]:
    categories = list(db.execute(select(Category).order_by(Category.name.asc())).scalars())
    path_map = _category_path_map(categories)
    child_counts = defaultdict(int)
    by_id = {category.id: category for category in categories}
    for category in categories:
        if category.parent_id is not None:
            child_counts[category.parent_id] += 1

    infos: list[_CategoryInfo] = []
    for category in categories:
        if category.system_kind != "expense":
            continue
        info = _CategoryInfo(
            id=category.id,
            name=category.name,
            path=path_map.get(category.id, category.name),
            parent_id=category.parent_id,
            parent_name=by_id[category.parent_id].name if category.parent_id in by_id else None,
            family_name=(path_map.get(category.id, category.name).split(" > ")[0]),
            spend_bucket=category.spend_bucket,
            color=category.color,
            icon=category.icon,
            has_children=child_counts[category.id] > 0,
        )
        infos.append(info)
    return infos, {info.id: info for info in infos}


def _default_fixed(path: str) -> bool:
    upper = path.upper()
    return any(
        token in upper
        for token in [
            "MORTGAGE",
            "RENT",
            "INSURANCE",
            "INTERNET",
            "MOBILE",
            "UTILITIES",
            "TUITION",
        ]
    )


def _default_essential(family: str, spend_bucket: str | None = None) -> bool:
    if spend_bucket == "essential":
        return True
    if spend_bucket == "discretionary":
        return False
    return family not in {"Entertainment", "Travel", "Charity", "Personal"}


def _expense_totals_by_category(db: Session, start: date, end: date) -> dict[int, float]:
    start_dt = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    rows = db.execute(
        select(Transaction.category_id, func.sum(func.abs(Transaction.amount)))
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(Transaction.posted_at >= start_dt)
        .where(Transaction.posted_at < end_dt)
        .where(Transaction.amount < 0)
        .where(Transaction.transfer_id.is_(None))
        .where(
            or_(Category.system_kind.is_(None), Category.system_kind != "transfer")
        )
        .group_by(Transaction.category_id)
    ).all()
    return {category_id: float(total or 0) for category_id, total in rows if category_id is not None}


def _income_and_spend_for_month(db: Session, start: date) -> tuple[float, float]:
    end = _next_month(start)
    start_dt = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    end_dt = datetime.combine(end, datetime.min.time(), tzinfo=UTC)
    rows = db.execute(
        select(Transaction.amount, Category.system_kind)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(Transaction.posted_at >= start_dt)
        .where(Transaction.posted_at < end_dt)
        .where(Transaction.transfer_id.is_(None))
        .where(or_(Category.system_kind.is_(None), Category.system_kind != "transfer"))
    ).all()

    income = 0.0
    spend = 0.0
    for amount_raw, system_kind in rows:
        amount = float(amount_raw)
        if amount > 0 or system_kind == "income":
            income += max(amount, 0.0)
        elif amount < 0:
            spend += abs(amount)
    return round(income, 2), round(spend, 2)


def _recent_average_by_category(db: Session, month_start: date, months: int) -> dict[int, float]:
    totals: dict[int, float] = defaultdict(float)
    for offset in range(1, months + 1):
        target = month_start
        for _ in range(offset):
            target = target.replace(day=1) - timedelta(days=1)
            target = date(target.year, target.month, 1)
        month_totals = _expense_totals_by_category(db, target, _next_month(target) - timedelta(days=1))
        for category_id, amount in month_totals.items():
            totals[category_id] += amount
    return {category_id: round(total / months, 2) for category_id, total in totals.items()}


def _load_budget_month(db: Session, month_start: date) -> BudgetMonth | None:
    return db.execute(
        select(BudgetMonth).where(BudgetMonth.month_start == month_start)
    ).scalar_one_or_none()


def _family_rollup(
    rows: list[dict],
    family_actuals: dict[str, float],
) -> list[dict]:
    family_map: dict[str, dict[str, float | str]] = {}
    for row in rows:
        bucket = family_map.setdefault(
            row["family"],
            {
                "family": row["family"],
                "planned_amount": 0.0,
                "actual_amount": 0.0,
                "essential_planned": 0.0,
                "discretionary_planned": 0.0,
            },
        )
        bucket["planned_amount"] = float(bucket["planned_amount"]) + row["planned_amount"]
        if row["is_essential"]:
            bucket["essential_planned"] = float(bucket["essential_planned"]) + row["planned_amount"]
        else:
            bucket["discretionary_planned"] = float(bucket["discretionary_planned"]) + row["planned_amount"]

    for family, bucket in family_map.items():
        actual = family_actuals.get(family, 0.0)
        bucket["actual_amount"] = actual
        bucket["remaining_amount"] = round(float(bucket["planned_amount"]) - actual, 2)

    return sorted(
        [
            {
                "family": str(bucket["family"]),
                "planned_amount": round(float(bucket["planned_amount"]), 2),
                "actual_amount": round(float(bucket["actual_amount"]), 2),
                "remaining_amount": round(float(bucket["remaining_amount"]), 2),
                "essential_planned": round(float(bucket["essential_planned"]), 2),
                "discretionary_planned": round(float(bucket["discretionary_planned"]), 2),
            }
            for bucket in family_map.values()
        ],
        key=lambda item: item["planned_amount"],
        reverse=True,
    )


def get_budget_month_snapshot(db: Session, month: date) -> dict:
    month_start = _month_start(month)
    infos, info_by_id = _load_category_info(db)
    current_month = _load_budget_month(db, month_start)
    plans = {
        plan.category_id: plan
        for plan in (
            db.execute(
                select(BudgetCategoryPlan).join(BudgetMonth).where(BudgetMonth.month_start == month_start)
            )
            .scalars()
            .all()
            if current_month is not None
            else []
        )
    }

    actuals = _expense_totals_by_category(db, month_start, _next_month(month_start) - timedelta(days=1))
    last_month = month_start.replace(day=1) - timedelta(days=1)
    last_month_start = date(last_month.year, last_month.month, 1)
    last_month_actuals = _expense_totals_by_category(
        db, last_month_start, _next_month(last_month_start) - timedelta(days=1)
    )
    avg_3_month_actuals = _recent_average_by_category(db, month_start, 3)
    recent_income: list[float] = []
    recent_surplus: list[float] = []
    cursor = month_start
    for _ in range(1, 4):
        cursor = cursor.replace(day=1) - timedelta(days=1)
        cursor = date(cursor.year, cursor.month, 1)
        month_income, month_spend = _income_and_spend_for_month(db, cursor)
        recent_income.append(month_income)
        recent_surplus.append(max(month_income - month_spend, 0.0))

    family_actuals: dict[str, float] = defaultdict(float)
    for category_id, amount in actuals.items():
        info = info_by_id.get(category_id)
        if info is None:
            continue
        family_actuals[info.family_name] += amount

    rows: list[dict] = []
    for info in infos:
        if info.has_children:
            continue
        plan = plans.get(info.id)
        planned_amount = float(plan.planned_amount) if plan else 0.0
        actual_amount = actuals.get(info.id, 0.0)
        rows.append(
            {
                "category_id": info.id,
                "category_name": info.name,
                "category_path": info.path,
                "parent_category_name": info.parent_name or info.family_name,
                "family": info.family_name,
                "planned_amount": round(planned_amount, 2),
                "actual_amount": round(actual_amount, 2),
                "remaining_amount": round(planned_amount - actual_amount, 2),
                "last_month_actual": round(last_month_actuals.get(info.id, 0.0), 2),
                "avg_3_month_actual": round(avg_3_month_actuals.get(info.id, 0.0), 2),
                "is_fixed": bool(plan.is_fixed) if plan else _default_fixed(info.path),
                "is_essential": bool(plan.is_essential)
                if plan
                else _default_essential(info.family_name, info.spend_bucket),
                "rollover_mode": plan.rollover_mode if plan else "none",
            }
        )

    rows.sort(key=lambda row: (row["family"], row["category_path"]))
    family_summaries = _family_rollup(rows, family_actuals)

    income_target = float(current_month.income_target) if current_month else 0.0
    starting_cash = float(current_month.starting_cash) if current_month else 0.0
    planned_savings = float(current_month.planned_savings) if current_month else 0.0
    planned_spending = round(sum(row["planned_amount"] for row in rows), 2)
    actual_spending = round(sum(actuals.values()), 2)
    income_available = round(income_target + starting_cash, 2)
    essential_planned = round(sum(row["planned_amount"] for row in rows if row["is_essential"]), 2)
    discretionary_planned = round(
        sum(row["planned_amount"] for row in rows if not row["is_essential"]), 2
    )

    return {
        "month_start": month_start,
        "income_target": income_target,
        "starting_cash": starting_cash,
        "planned_savings": planned_savings,
        "suggested_income_target": round(sum(recent_income) / len(recent_income), 2)
        if recent_income
        else 0.0,
        "suggested_planned_savings": round(sum(recent_surplus) / len(recent_surplus), 2)
        if recent_surplus
        else 0.0,
        "leftover_strategy": current_month.leftover_strategy if current_month else "unassigned",
        "income_available": income_available,
        "planned_spending": planned_spending,
        "actual_spending": actual_spending,
        "remaining_to_budget": round(income_available - planned_spending - planned_savings, 2),
        "essential_planned": essential_planned,
        "discretionary_planned": discretionary_planned,
        "rows": rows,
        "family_summaries": family_summaries,
    }


def save_budget_month_snapshot(
    db: Session,
    *,
    month: date,
    income_target: float,
    starting_cash: float,
    planned_savings: float,
    leftover_strategy: str,
    rows: list[dict],
) -> dict:
    month_start = _month_start(month)
    budget_month = _load_budget_month(db, month_start)
    if budget_month is None:
        budget_month = BudgetMonth(month_start=month_start)
        db.add(budget_month)
        db.flush()

    budget_month.income_target = Decimal(str(round(income_target, 2)))
    budget_month.starting_cash = Decimal(str(round(starting_cash, 2)))
    budget_month.planned_savings = Decimal(str(round(planned_savings, 2)))
    budget_month.leftover_strategy = leftover_strategy

    existing = {
        plan.category_id: plan
        for plan in db.execute(
            select(BudgetCategoryPlan).where(BudgetCategoryPlan.budget_month_id == budget_month.id)
        )
        .scalars()
        .all()
    }
    seen_ids: set[int] = set()
    for row in rows:
        category_id = int(row["category_id"])
        seen_ids.add(category_id)
        plan = existing.get(category_id)
        if plan is None:
            plan = BudgetCategoryPlan(budget_month_id=budget_month.id, category_id=category_id)
            db.add(plan)
        plan.planned_amount = Decimal(str(round(float(row["planned_amount"]), 2)))
        plan.is_fixed = bool(row["is_fixed"])
        plan.is_essential = bool(row["is_essential"])
        plan.rollover_mode = str(row["rollover_mode"])

    for category_id, plan in existing.items():
        if category_id not in seen_ids:
            db.delete(plan)

    db.commit()
    return get_budget_month_snapshot(db, month_start)


def get_budget_period_summary(db: Session, *, period: str, anchor: date) -> dict:
    start, end = _period_bounds(period, anchor)
    infos, info_by_id = _load_category_info(db)
    actuals = _expense_totals_by_category(db, start, end)

    family_map: dict[str, dict[str, object]] = {}
    for info in infos:
        if info.family_name not in family_map:
            family_map[info.family_name] = {
                "family": info.family_name,
                "amount": 0.0,
                "subcategories": [],
            }

    for category_id, amount in actuals.items():
        info = info_by_id.get(category_id)
        if info is None:
            continue
        family_bucket = family_map.setdefault(
            info.family_name,
            {"family": info.family_name, "amount": 0.0, "subcategories": []},
        )
        family_bucket["amount"] = round(float(family_bucket["amount"]) + amount, 2)
        subcategories = family_bucket["subcategories"]
        assert isinstance(subcategories, list)
        subcategories.append(
            {
                "category": info.name,
                "path": info.path,
                "amount": round(amount, 2),
            }
        )

    families = sorted(
        [
            {
                "family": str(item["family"]),
                "amount": round(float(item["amount"]), 2),
                "subcategories": sorted(
                    item["subcategories"], key=lambda row: row["amount"], reverse=True
                ),
            }
            for item in family_map.values()
            if float(item["amount"]) > 0
        ],
        key=lambda item: item["amount"],
        reverse=True,
    )

    history_count = {"weekly": 8, "monthly": 6, "yearly": 5}[period]
    history_points: list[tuple[date, date, str, dict[str, float]]] = []
    cursor = anchor
    for _ in range(history_count):
        current_start, current_end = _period_bounds(period, cursor)
        point_totals = _expense_totals_by_category(db, current_start, current_end)
        family_totals: dict[str, float] = defaultdict(float)
        for category_id, amount in point_totals.items():
            info = info_by_id.get(category_id)
            if info is None:
                continue
            family_totals[info.family_name] += amount
        if period == "weekly":
            label = current_start.strftime("%b %d")
            cursor = current_start - timedelta(days=1)
        elif period == "monthly":
            label = current_start.strftime("%b")
            cursor = current_start - timedelta(days=1)
        else:
            label = current_start.strftime("%Y")
            cursor = date(current_start.year - 1, 12, 31)
        history_points.append((current_start, current_end, label, family_totals))

    top_families = [item["family"] for item in families[:4]]
    trend = [
        {
            "label": label,
            "start": point_start,
            "end": point_end,
            "total": round(sum(family_totals.values()), 2),
            "families": {family: round(family_totals.get(family, 0.0), 2) for family in top_families},
        }
        for point_start, point_end, label, family_totals in reversed(history_points)
    ]

    return {
        "period": period,
        "start": start,
        "end": end,
        "total_spend": round(sum(actuals.values()), 2),
        "families": families,
        "trend": trend,
    }


def _subscription_group_label(merchant_name: str | None, description_norm: str) -> str:
    if merchant_name:
        return merchant_name
    label = (description_norm or "").upper()
    label = re.sub(r"^HOLD:\s*", "", label)
    for token in ("SQ *", "SQ*", "TST*", "SP ", "FNM*", "PAYPAL *", "PAYPAL "):
        label = label.replace(token, "")
    label = " ".join(label.split())
    canonical_patterns = [
        (r"\bSPOTIFY\b", "SPOTIFY"),
        (r"\bPATREON\b", "PATREON"),
        (r"\bPNM\b.*\bELECTRIC\b", "PNM ELECTRIC"),
        (r"\bSTARLINK\b", "STARLINK"),
        (r"\bOPENAI\b|\bCHATGPT\b", "OPENAI CHATGPT"),
    ]
    for pattern, replacement in canonical_patterns:
        if re.search(pattern, label):
            return replacement
    label = re.sub(r"\bP[0-9A-Z]{6,}\b", "", label)
    label = re.sub(r"\bTRACER:\s.*$", "", label)
    label = re.sub(r"\b[0-9]{4}\b", "", label)
    label = re.sub(r"\s+", " ", label).strip()
    for suffix in (" ALBUQUERQUE NM", " NM", " CA", " WA", " NY", " IT", " GA"):
        if label.endswith(suffix):
            label = label[: -len(suffix)].strip()
    return label[:80]


def _subscription_cadence(avg_days: float) -> tuple[str, float] | None:
    if 5 <= avg_days <= 9:
        return "weekly", 52 / 12
    if 12 <= avg_days <= 17:
        return "biweekly", 26 / 12
    if 25 <= avg_days <= 35:
        return "monthly", 1.0
    if 80 <= avg_days <= 100:
        return "quarterly", 1 / 3
    if 170 <= avg_days <= 195:
        return "semiannual", 1 / 6
    if 350 <= avg_days <= 380:
        return "annual", 1 / 12
    return None


def get_recurring_payment_candidates(db: Session, *, anchor: date) -> dict:
    categories = list(db.execute(select(Category)).scalars())
    category_by_id = {category.id: category for category in categories}
    lookback_start = anchor - timedelta(days=365)
    lookback_end = anchor + timedelta(days=1)
    rows = db.execute(
        select(Transaction, Category, Merchant)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .outerjoin(Merchant, Merchant.id == Transaction.merchant_id)
        .where(Transaction.posted_at >= datetime.combine(lookback_start, datetime.min.time(), tzinfo=UTC))
        .where(Transaction.posted_at < datetime.combine(lookback_end, datetime.min.time(), tzinfo=UTC))
        .where(Transaction.amount < 0)
        .where(Transaction.is_pending.is_(False))
        .where(Transaction.transfer_id.is_(None))
        .where(or_(Category.system_kind.is_(None), Category.system_kind != "transfer"))
        .order_by(Transaction.posted_at.asc())
    ).all()

    grouped: dict[str, list[tuple[Transaction, Category | None, Merchant | None]]] = defaultdict(list)
    for txn, category, merchant in rows:
        label = _subscription_group_label(
            merchant.name_canonical if merchant else None,
            txn.description_norm,
        )
        grouped[label.lower()].append((txn, category, merchant))

    entries: list[dict] = []
    review_entries: list[dict] = []
    cancel_keywords = {
        "netflix", "spotify", "hulu", "disney", "youtube", "prime", "max",
        "apple", "icloud", "audible", "patreon", "peacock", "paramount",
        "gym", "membership", "subscription", "chatgpt", "openai", "adobe",
        "microsoft", "google one", "dropbox", "canva",
    }
    essential_families = {"Housing", "Utilities", "Insurance", "Debt", "Healthcare", "Transportation"}
    variable_essential_labels = {"pnm electric", "starlink", "universal waste systems"}

    for items in grouped.values():
        if len(items) < 2:
            latest_txn, latest_category, latest_merchant = items[-1]
            label = _subscription_group_label(
                latest_merchant.name_canonical if latest_merchant else None,
                latest_txn.description_norm,
            )
            lower_label = label.lower()
            if not any(keyword in lower_label for keyword in cancel_keywords):
                continue
            if latest_category is None:
                category_name = "Uncategorized"
                family_name = "Uncategorized"
            else:
                category_name = latest_category.name
                parent = category_by_id.get(latest_category.parent_id) if latest_category.parent_id else None
                family_name = parent.name if parent is not None else latest_category.name
            amount = round(abs(float(latest_txn.amount)), 2)
            review_entries.append(
                {
                    "label": label,
                    "category_name": category_name,
                    "family_name": family_name,
                    "cadence": "review",
                    "occurrences": 1,
                    "average_amount": amount,
                    "estimated_monthly_cost": amount,
                    "last_amount": amount,
                    "last_posted_at": latest_txn.posted_at.date(),
                    "next_expected_at": None,
                    "is_cancel_candidate": True,
                    "review_reason": "Only one matching charge in current history",
                }
            )
            continue
        txns = [txn for txn, _, _ in items]
        dates = [txn.posted_at.date() for txn in txns]
        amounts = [abs(float(txn.amount)) for txn in txns]
        intervals = [(dates[i] - dates[i - 1]).days for i in range(1, len(dates))]
        if not intervals:
            continue

        avg_days = mean(intervals)
        cadence_info = _subscription_cadence(avg_days)
        if cadence_info is None:
            continue
        cadence, monthly_factor = cadence_info
        min_occurrences = 2 if cadence in {"quarterly", "semiannual", "annual"} else 3
        if len(items) < min_occurrences:
            latest_txn, latest_category, latest_merchant = items[-1]
            label = _subscription_group_label(
                latest_merchant.name_canonical if latest_merchant else None,
                latest_txn.description_norm,
            )
            lower_label = label.lower()
            if any(keyword in lower_label for keyword in cancel_keywords):
                if latest_category is None:
                    category_name = "Uncategorized"
                    family_name = "Uncategorized"
                else:
                    category_name = latest_category.name
                    parent = category_by_id.get(latest_category.parent_id) if latest_category.parent_id else None
                    family_name = parent.name if parent is not None else latest_category.name
                avg_preview = round(mean(amounts), 2)
                category_bucket = latest_category.spend_bucket if latest_category is not None else None
                review_entries.append(
                    {
                        "label": label,
                        "category_name": category_name,
                        "family_name": family_name,
                        "cadence": cadence,
                        "occurrences": len(items),
                        "average_amount": avg_preview,
                        "estimated_monthly_cost": round(avg_preview * monthly_factor, 2),
                        "last_amount": round(abs(float(latest_txn.amount)), 2),
                        "last_posted_at": latest_txn.posted_at.date(),
                        "next_expected_at": latest_txn.posted_at.date() + timedelta(days=round(avg_days)),
                        "is_cancel_candidate": category_bucket != "essential",
                        "review_reason": "Not enough history to confirm a stable recurring pattern",
                    }
                )
            continue

        avg_amount = mean(amounts)
        max_amount = max(amounts)
        min_amount = min(amounts)
        amount_spread_ratio = (max_amount - min_amount) / avg_amount if avg_amount else 0.0
        interval_spread = max(intervals) - min(intervals)

        latest_txn, latest_category, latest_merchant = items[-1]
        label = _subscription_group_label(
            latest_merchant.name_canonical if latest_merchant else None,
            latest_txn.description_norm,
        )
        categories_seen = [category for _, category, _ in items if category is not None]
        representative_category = categories_seen[-1] if categories_seen else latest_category
        if representative_category is None:
            category_name = "Uncategorized"
            family_name = "Uncategorized"
        else:
            category_name = representative_category.name
            parent = (
                category_by_id.get(representative_category.parent_id)
                if representative_category.parent_id
                else None
            )
            family_name = parent.name if parent is not None else representative_category.name
        category_bucket = representative_category.spend_bucket if representative_category else None
        lower_label = label.lower()
        max_amount_spread_ratio = 0.45
        if (
            category_bucket == "essential"
            or family_name in essential_families
            or lower_label in variable_essential_labels
        ):
            max_amount_spread_ratio = 1.6
        estimated_monthly = round(avg_amount * monthly_factor, 2)
        next_expected = latest_txn.posted_at.date() + timedelta(days=round(avg_days))
        if amount_spread_ratio > max_amount_spread_ratio or interval_spread > 18:
            continue
        is_cancel_candidate = (
            category_bucket != "essential"
            and family_name not in essential_families
            or any(keyword in lower_label for keyword in cancel_keywords)
        )
        entries.append(
            {
                "label": label,
                "category_name": category_name,
                "family_name": family_name,
                "cadence": cadence,
                "occurrences": len(items),
                "average_amount": round(avg_amount, 2),
                "estimated_monthly_cost": estimated_monthly,
                "last_amount": round(abs(float(latest_txn.amount)), 2),
                "last_posted_at": latest_txn.posted_at.date(),
                "next_expected_at": next_expected,
                "is_cancel_candidate": is_cancel_candidate,
            }
        )

    entries.sort(key=lambda item: (item["is_cancel_candidate"], item["estimated_monthly_cost"]), reverse=True)
    review_entries.sort(key=lambda item: item["estimated_monthly_cost"], reverse=True)
    cancel_candidates = [entry for entry in entries if entry["is_cancel_candidate"]]
    essential_candidates = [entry for entry in entries if not entry["is_cancel_candidate"]]

    return {
        "as_of": anchor,
        "estimated_monthly_total": round(sum(entry["estimated_monthly_cost"] for entry in entries), 2),
        "estimated_monthly_cancelable": round(
            sum(entry["estimated_monthly_cost"] for entry in cancel_candidates), 2
        ),
        "cancel_candidates": cancel_candidates[:8],
        "essential_candidates": essential_candidates[:8],
        "review_candidates": review_entries[:8],
    }
