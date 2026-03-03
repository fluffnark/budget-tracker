from __future__ import annotations

from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from math import ceil

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Account, BalanceSnapshot, Category, Transaction


def _category_path_map(db: Session) -> dict[int, str]:
    categories = list(db.execute(select(Category).order_by(Category.id.asc())).scalars())
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


def _txns_for_range(
    db: Session,
    *,
    start_dt: datetime,
    end_dt: datetime,
    include_pending: bool,
    include_transfers: bool,
):
    q = (
        select(Transaction, Category.name, Account.name, Account.type)
        .join(Account, Account.id == Transaction.account_id)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(Transaction.posted_at >= start_dt)
        .where(Transaction.posted_at < end_dt)
    )
    if not include_pending:
        q = q.where(Transaction.is_pending.is_(False))
    if not include_transfers:
        q = q.where(Transaction.transfer_id.is_(None))
    return db.execute(q).all()


def _totals(rows: list[tuple[Transaction, str | None, str, str]]) -> dict:
    inflow = 0.0
    outflow = 0.0
    for txn, _, _, _ in rows:
        amount = float(txn.amount)
        if amount >= 0:
            inflow += amount
        else:
            outflow += abs(amount)
    return {
        "inflow": round(inflow, 2),
        "outflow": round(outflow, 2),
        "net": round(inflow - outflow, 2),
    }


def weekly_report(
    db: Session,
    *,
    start: date,
    end: date,
    include_pending: bool,
    include_transfers: bool,
) -> dict:
    start_dt = datetime(start.year, start.month, start.day, tzinfo=UTC)
    end_dt = datetime(end.year, end.month, end.day, tzinfo=UTC) + timedelta(days=1)
    rows = _txns_for_range(
        db,
        start_dt=start_dt,
        end_dt=end_dt,
        include_pending=include_pending,
        include_transfers=include_transfers,
    )

    category_spend = defaultdict(float)
    largest = []
    utilities = defaultdict(float)

    for txn, category_name, account_name, _ in rows:
        amount = float(txn.amount)
        cat = category_name or "Uncategorized/Needs Review"
        if amount < 0:
            category_spend[cat] += abs(amount)
        largest.append(
            {
                "id": txn.id,
                "date": txn.posted_at.date().isoformat(),
                "description": txn.description_norm,
                "amount": amount,
                "account": account_name,
                "category": cat,
            }
        )
        if cat.startswith("Utilities"):
            utilities[cat] += abs(amount)

    largest = sorted(largest, key=lambda item: abs(item["amount"]), reverse=True)[:10]
    top_categories = sorted(category_spend.items(), key=lambda item: item[1], reverse=True)[:8]

    return {
        "totals": _totals(rows),
        "top_categories": [{"category": k, "amount": round(v, 2)} for k, v in top_categories],
        "largest_transactions": largest,
        "utilities": [{"category": k, "amount": round(v, 2)} for k, v in sorted(utilities.items())],
    }


def monthly_report(
    db: Session,
    *,
    year: int,
    month: int,
    include_pending: bool,
    include_transfers: bool,
) -> dict:
    start = date(year, month, 1)
    if month == 12:
        next_month_start = date(year + 1, 1, 1)
        prev_month = date(year, 11, 1)
    else:
        next_month_start = date(year, month + 1, 1)
        prev_month = date(year - 1, 12, 1) if month == 1 else date(year, month - 1, 1)

    current_rows = _txns_for_range(
        db,
        start_dt=datetime.combine(start, datetime.min.time(), tzinfo=UTC),
        end_dt=datetime.combine(next_month_start, datetime.min.time(), tzinfo=UTC),
        include_pending=include_pending,
        include_transfers=include_transfers,
    )

    prev_rows = _txns_for_range(
        db,
        start_dt=datetime.combine(prev_month, datetime.min.time(), tzinfo=UTC),
        end_dt=datetime.combine(start, datetime.min.time(), tzinfo=UTC),
        include_pending=include_pending,
        include_transfers=include_transfers,
    )

    current_cat = defaultdict(float)
    prev_cat = defaultdict(float)
    utilities = defaultdict(float)

    for txn, category_name, _, _ in current_rows:
        cat = category_name or "Uncategorized/Needs Review"
        amount = float(txn.amount)
        if amount < 0:
            current_cat[cat] += abs(amount)
        if cat.startswith("Utilities"):
            utilities[cat] += abs(amount)

    for txn, category_name, _, _ in prev_rows:
        cat = category_name or "Uncategorized/Needs Review"
        amount = float(txn.amount)
        if amount < 0:
            prev_cat[cat] += abs(amount)

    breakdown = sorted(current_cat.items(), key=lambda item: item[1], reverse=True)
    deltas = []
    for cat, amount in breakdown:
        deltas.append(
            {
                "category": cat,
                "current": round(amount, 2),
                "previous": round(prev_cat.get(cat, 0.0), 2),
                "delta": round(amount - prev_cat.get(cat, 0.0), 2),
            }
        )

    return {
        "totals": _totals(current_rows),
        "category_breakdown": [{"category": k, "amount": round(v, 2)} for k, v in breakdown],
        "mom_deltas": deltas,
        "utilities": [{"category": k, "amount": round(v, 2)} for k, v in sorted(utilities.items())],
    }


def yearly_report(
    db: Session,
    *,
    year: int,
    include_pending: bool,
    include_transfers: bool,
) -> dict:
    monthly_totals = []
    category_map = defaultdict(lambda: [0.0] * 12)

    for month in range(1, 13):
        start = date(year, month, 1)
        next_start = date(year + 1, 1, 1) if month == 12 else date(year, month + 1, 1)
        rows = _txns_for_range(
            db,
            start_dt=datetime.combine(start, datetime.min.time(), tzinfo=UTC),
            end_dt=datetime.combine(next_start, datetime.min.time(), tzinfo=UTC),
            include_pending=include_pending,
            include_transfers=include_transfers,
        )
        totals = _totals(rows)
        monthly_totals.append({"month": month, **totals})

        per_cat = defaultdict(float)
        for txn, category_name, _, _ in rows:
            amount = float(txn.amount)
            if amount < 0:
                per_cat[category_name or "Uncategorized/Needs Review"] += abs(amount)
        for category_name, amount in per_cat.items():
            category_map[category_name][month - 1] = round(amount, 2)

    category_trends = [
        {"category": category_name, "months": values}
        for category_name, values in sorted(
            category_map.items(), key=lambda item: sum(item[1]), reverse=True
        )[:8]
    ]

    return {"year": year, "monthly_totals": monthly_totals, "category_trends": category_trends}


def sankey_data(
    db: Session,
    *,
    start: date,
    end: date,
    include_pending: bool,
    include_transfers: bool,
    mode: str = "account_to_category",
    category_id: int | None = None,
) -> dict:
    start_dt = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
    q = (
        select(Transaction, Category, Account)
        .join(Account, Account.id == Transaction.account_id)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(Transaction.posted_at >= start_dt)
        .where(Transaction.posted_at < end_dt)
    )
    if not include_pending:
        q = q.where(Transaction.is_pending.is_(False))
    if not include_transfers:
        q = q.where(Transaction.transfer_id.is_(None))
    if category_id is not None:
        q = q.where(Transaction.category_id == category_id)
    rows = db.execute(q).all()
    category_paths = _category_path_map(db)

    if mode == "income_hub_outcomes":
        nodes: list[dict] = []
        node_idx: dict[str, int] = {}

        def ensure_node(label: str, kind: str, color: str | None = None) -> int:
            key = f"{kind}:{label}"
            if key in node_idx:
                return node_idx[key]
            idx = len(nodes)
            nodes.append(
                {
                    "name": label,
                    "kind": kind,
                    "color": color,
                    "icon": None,
                    "category_id": None,
                }
            )
            node_idx[key] = idx
            return idx

        source_to_hub: dict[tuple[str, str], float] = defaultdict(float)
        hub_to_outcome: dict[tuple[str, str], float] = defaultdict(float)
        outcome_to_detail: dict[tuple[str, str], float] = defaultdict(float)

        def income_source_label(category_path: str, description_norm: str) -> str:
            path_upper = (category_path or "").upper()
            desc_upper = (description_norm or "").upper()
            if "SALARY" in path_upper or "PAYROLL" in desc_upper:
                return "Income: Salary"
            if "INTEREST" in path_upper or "DIVIDEND" in desc_upper or "REFUND" in desc_upper:
                return "Income: Other (dividends/interest/refunds)"
            return "Income: Other (dividends/interest/refunds)"

        def classify_outcome_detail(category_path: str, description_norm: str) -> tuple[str, str]:
            path = category_path or "Uncategorized/Needs Review"
            path_upper = path.upper()
            desc_upper = (description_norm or "").upper()
            if "TRAVEL" in path_upper:
                return "Travel", f"Travel → {path.split(' > ')[-1]}"
            if "MORTGAGE" in path_upper or "MORTGAGE" in desc_upper:
                return "Debt Service", "Debt Service → Mortgage"
            if any(
                token in desc_upper
                for token in ["CITI", "CITIBANK", "CREDIT CARD", "CARD PAYMENT", "PAYMENT, THANK YOU"]
            ):
                return "Debt Service", "Debt Service → Credit Card Payoff"
            if any(
                token in desc_upper
                for token in ["WEALTHFRONT", "VANGUARD", "ROTH", "IRA", "BROKERAGE", "INVEST"]
            ):
                if "WEALTHFRONT" in desc_upper:
                    return "Savings & Investing", "Savings & Investing → Wealthfront"
                if "ROTH" in desc_upper:
                    return "Savings & Investing", "Savings & Investing → Vanguard Roth IRA"
                return "Savings & Investing", "Savings & Investing → Vanguard Brokerage"
            if path_upper.startswith("TRANSFERS"):
                return "Internal Transfers", "Internal Transfers → Other internal moves"
            return "Living Expenses", f"Living Expenses → {path}"

        for txn, category, account in rows:
            amount = float(txn.amount)
            if amount == 0:
                continue

            hub = account.name
            category_path = (
                category_paths.get(category.id, category.name)
                if category is not None
                else "Uncategorized/Needs Review"
            )
            abs_amount = abs(amount)

            if txn.transfer_id is not None:
                if amount < 0:
                    hub_to_outcome[(hub, "Internal Transfers")] += abs_amount
                else:
                    source_to_hub[("Internal Transfers", hub)] += abs_amount
                continue

            if amount > 0:
                source = income_source_label(category_path, txn.description_norm)
                if source.startswith("Income"):
                    source_to_hub[(source, hub)] += abs_amount
                else:
                    source_to_hub[("Transfers In (external)", hub)] += abs_amount
                continue

            outcome, detail = classify_outcome_detail(category_path, txn.description_norm)
            hub_to_outcome[(hub, outcome)] += abs_amount
            outcome_to_detail[(outcome, detail)] += abs_amount

        # Keep top detail nodes per outcome to prevent visual overload.
        detail_limit = 8
        kept_details: dict[str, set[str]] = defaultdict(set)
        overflow_totals: dict[str, float] = defaultdict(float)
        for outcome in {outcome for outcome, _detail in outcome_to_detail.keys()}:
            detail_rows = sorted(
                [(detail, value) for (oc, detail), value in outcome_to_detail.items() if oc == outcome],
                key=lambda item: item[1],
                reverse=True,
            )
            for idx, (detail, value) in enumerate(detail_rows):
                if idx < detail_limit:
                    kept_details[outcome].add(detail)
                else:
                    overflow_totals[outcome] += value

        links_map: dict[tuple[int, int], float] = defaultdict(float)

        for (source_label, hub_label), value in source_to_hub.items():
            source_id = ensure_node(source_label, "source", "var(--series-2)")
            hub_id = ensure_node(hub_label, "account", None)
            links_map[(source_id, hub_id)] += value

        for (hub_label, outcome_label), value in hub_to_outcome.items():
            hub_id = ensure_node(hub_label, "account", None)
            outcome_color = {
                "Living Expenses": "var(--series-1)",
                "Travel": "var(--series-4)",
                "Debt Service": "var(--danger)",
                "Savings & Investing": "var(--series-5)",
                "Internal Transfers": "var(--text-subtle)",
            }.get(outcome_label, "var(--series-1)")
            outcome_id = ensure_node(outcome_label, "outcome", outcome_color)
            links_map[(hub_id, outcome_id)] += value

        for (outcome_label, detail_label), value in outcome_to_detail.items():
            if detail_label in kept_details[outcome_label]:
                detail_name = detail_label
            else:
                suffix = {
                    "Living Expenses": "Other (Living)",
                    "Travel": "Other (Travel)",
                    "Debt Service": "Other (Debt)",
                    "Savings & Investing": "Other (Savings)",
                    "Internal Transfers": "Other internal moves",
                }.get(outcome_label, "Other")
                detail_name = f"{outcome_label} → {suffix}"
            outcome_id = ensure_node(outcome_label, "outcome", None)
            detail_id = ensure_node(detail_name, "detail", None)
            links_map[(outcome_id, detail_id)] += value

        links = [
            {"source": src, "target": dst, "value": round(value, 2)}
            for (src, dst), value in sorted(links_map.items(), key=lambda item: item[1], reverse=True)
        ]
        return {"nodes": nodes, "links": links}

    nodes: list[dict] = []
    node_idx: dict[str, int] = {}

    def ensure_node(
        label: str,
        kind: str,
        *,
        color: str | None = None,
        icon: str | None = None,
        category_ref: int | None = None,
    ) -> int:
        key = f"{kind}:{label}"
        if key in node_idx:
            return node_idx[key]
        idx = len(nodes)
        nodes.append(
            {
                "name": label,
                "kind": kind,
                "color": color,
                "icon": icon,
                "category_id": category_ref,
            }
        )
        node_idx[key] = idx
        return idx

    links_map: dict[tuple[int, int], float] = defaultdict(float)

    for txn, category, account in rows:
        amount = float(txn.amount)
        if amount == 0:
            continue
        cat_name = category.name if category else "Uncategorized/Needs Review"
        cat_color = category.color if category else "#6C757D"
        cat_icon = category.icon if category else "❔"
        cat_ref = category.id if category else None
        account_name = account.name

        if mode == "category_to_account":
            source = ensure_node(
                cat_name,
                "category",
                color=cat_color,
                icon=cat_icon,
                category_ref=cat_ref,
            )
            target = ensure_node(account_name, "account")
        else:
            source = ensure_node(account_name, "account")
            target = ensure_node(
                cat_name,
                "category",
                color=cat_color,
                icon=cat_icon,
                category_ref=cat_ref,
            )
        links_map[(source, target)] += abs(amount)

    links = [
        {"source": src, "target": dst, "value": round(value, 2)}
        for (src, dst), value in sorted(links_map.items(), key=lambda item: item[1], reverse=True)
    ]
    return {"nodes": nodes, "links": links}


def projection_data(
    db: Session,
    *,
    utility_inflation_rate: float,
    general_inflation_rate: float,
    savings_apr: float,
) -> dict:
    now = datetime.now(UTC)
    start = now - timedelta(days=183)
    rows = _txns_for_range(
        db,
        start_dt=start,
        end_dt=now,
        include_pending=True,
        include_transfers=False,
    )

    utilities = []
    general = []
    for txn, category_name, _, _ in rows:
        amount = float(txn.amount)
        if amount >= 0:
            continue
        if (category_name or "").startswith("Utilities"):
            utilities.append(abs(amount))
        else:
            general.append(abs(amount))

    baseline_util = (sum(utilities) / max(len(utilities), 1)) * 30
    baseline_general = (sum(general) / max(len(general), 1)) * 30

    util_monthly_growth = utility_inflation_rate / 100 / 12
    general_monthly_growth = general_inflation_rate / 100 / 12
    savings_monthly_growth = savings_apr / 100 / 12

    months = []
    savings_balance = 0.0
    for idx in range(1, 13):
        util_spend = baseline_util * ((1 + util_monthly_growth) ** idx)
        general_spend = baseline_general * ((1 + general_monthly_growth) ** idx)
        total_spend = util_spend + general_spend
        savings_balance = (savings_balance + max(0.0, baseline_general - general_spend)) * (
            1 + savings_monthly_growth
        )
        months.append(
            {
                "month": idx,
                "projected_utilities": round(util_spend, 2),
                "projected_total_spend": round(total_spend, 2),
                "projected_savings": round(savings_balance, 2),
            }
        )

    return {
        "baseline_utilities_monthly": round(baseline_util, 2),
        "baseline_total_monthly": round(baseline_util + baseline_general, 2),
        "months": months,
    }


def balance_trends_data(
    db: Session,
    *,
    start: date,
    end: date,
    include_inactive: bool = False,
) -> dict:
    start_dt = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)

    accounts_query = select(Account)
    if not include_inactive:
        accounts_query = accounts_query.where(Account.is_active.is_(True))
    accounts = db.execute(accounts_query.order_by(Account.name.asc())).scalars().all()
    if not accounts:
        return {"accounts": [], "points": []}

    account_by_id = {account.id: account for account in accounts}
    snapshots = db.execute(
        select(BalanceSnapshot)
        .where(BalanceSnapshot.account_id.in_(list(account_by_id.keys())))
        .where(BalanceSnapshot.captured_at >= start_dt)
        .where(BalanceSnapshot.captured_at < end_dt)
        .order_by(BalanceSnapshot.captured_at.asc(), BalanceSnapshot.id.asc())
    ).scalars()

    liability_types = {"credit", "credit_card", "loan", "mortgage", "liability", "debt"}
    account_points: dict[str, list[dict]] = {account.id: [] for account in accounts}
    timeline_totals: dict[str, dict[str, float]] = {}
    latest_balance: dict[str, float] = {}

    for snapshot in snapshots:
        account = account_by_id.get(snapshot.account_id)
        if account is None:
            continue
        ts = snapshot.captured_at or snapshot.as_of
        if ts is None:
            continue
        day_key = ts.astimezone(UTC).date().isoformat()
        raw_balance = float(snapshot.balance)
        is_liability = account.type.lower() in liability_types
        signed_balance = -abs(raw_balance) if is_liability else raw_balance

        latest_balance[snapshot.account_id] = signed_balance
        account_points[snapshot.account_id].append(
            {
                "date": day_key,
                "balance": round(signed_balance, 2),
            }
        )

        assets = 0.0
        liabilities = 0.0
        for account_id, signed in latest_balance.items():
            acct = account_by_id[account_id]
            if acct.type.lower() in liability_types:
                liabilities += abs(signed)
            else:
                assets += max(0.0, signed)
        timeline_totals[day_key] = {
            "date": day_key,
            "assets": round(assets, 2),
            "liabilities": round(liabilities, 2),
            "net_worth": round(assets - liabilities, 2),
        }

    account_rows = []
    for account in accounts:
        points = account_points.get(account.id, [])
        if not points:
            continue
        account_rows.append(
            {
                "account_id": account.id,
                "name": account.name,
                "type": account.type,
                "source_type": account.source_type,
                "is_liability": account.type.lower() in liability_types,
                "points": points,
            }
        )

    points = [timeline_totals[key] for key in sorted(timeline_totals.keys())]
    return {"accounts": account_rows, "points": points}


def mortgage_projection_data(
    *,
    principal_balance: float,
    annual_interest_rate: float,
    years_remaining: int,
    monthly_payment: float | None = None,
    extra_payment: float = 0.0,
    months_to_project: int = 360,
) -> dict:
    principal = max(0.0, float(principal_balance))
    if principal <= 0:
        return {"baseline": [], "with_extra": [], "summary": {"months_baseline": 0, "months_with_extra": 0}}

    annual_rate = max(0.0, float(annual_interest_rate))
    monthly_rate = annual_rate / 100.0 / 12.0
    months_remaining = max(1, int(years_remaining) * 12)
    max_months = max(1, int(months_to_project))
    extra = max(0.0, float(extra_payment))

    if monthly_payment is None:
        if monthly_rate == 0:
            base_payment = principal / months_remaining
        else:
            numerator = principal * monthly_rate * ((1 + monthly_rate) ** months_remaining)
            denominator = ((1 + monthly_rate) ** months_remaining) - 1
            base_payment = numerator / denominator
    else:
        base_payment = max(0.0, float(monthly_payment))

    def build_schedule(payment: float) -> tuple[list[dict], int, float]:
        balance = principal
        cumulative_interest = 0.0
        rows: list[dict] = []
        for month in range(1, max_months + 1):
            interest = balance * monthly_rate
            applied_payment = min(payment, balance + interest)
            principal_paid = max(0.0, applied_payment - interest)
            balance = max(0.0, balance - principal_paid)
            cumulative_interest += interest
            rows.append(
                {
                    "month": month,
                    "balance": round(balance, 2),
                    "payment": round(applied_payment, 2),
                    "interest": round(interest, 2),
                    "principal": round(principal_paid, 2),
                    "cumulative_interest": round(cumulative_interest, 2),
                }
            )
            if balance <= 0.0:
                break
        payoff_months = len(rows) if rows and rows[-1]["balance"] <= 0 else ceil(principal / payment) if payment > 0 else 0
        return rows, payoff_months, cumulative_interest

    baseline_rows, baseline_months, baseline_interest = build_schedule(base_payment)
    extra_rows, extra_months, extra_interest = build_schedule(base_payment + extra)

    return {
        "baseline": baseline_rows,
        "with_extra": extra_rows,
        "summary": {
            "monthly_payment": round(base_payment, 2),
            "monthly_payment_with_extra": round(base_payment + extra, 2),
            "months_baseline": baseline_months,
            "months_with_extra": extra_months,
            "interest_baseline": round(baseline_interest, 2),
            "interest_with_extra": round(extra_interest, 2),
            "interest_saved": round(max(0.0, baseline_interest - extra_interest), 2),
        },
    }


def mortgage_activity_data(
    db: Session,
    *,
    account_id: str,
    start: date,
    end: date,
) -> dict:
    start_dt = datetime.combine(start, datetime.min.time(), tzinfo=UTC)
    end_dt = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)

    txns = db.execute(
        select(Transaction)
        .where(Transaction.account_id == account_id)
        .where(Transaction.posted_at >= start_dt)
        .where(Transaction.posted_at < end_dt)
        .order_by(Transaction.posted_at.asc())
    ).scalars()

    monthly: dict[str, dict[str, float | str]] = {}
    txn_count = 0
    for txn in txns:
        txn_count += 1
        month = txn.posted_at.strftime("%Y-%m")
        row = monthly.get(month) or {
            "month": month,
            "payment_amount": 0.0,
            "charge_amount": 0.0,
            "net_change": 0.0,
        }
        amount = float(txn.amount)
        row["net_change"] = float(row["net_change"]) + amount
        if amount > 0:
            row["payment_amount"] = float(row["payment_amount"]) + amount
        elif amount < 0:
            row["charge_amount"] = float(row["charge_amount"]) + abs(amount)
        monthly[month] = row

    snapshots = db.execute(
        select(BalanceSnapshot)
        .where(BalanceSnapshot.account_id == account_id)
        .where(BalanceSnapshot.captured_at >= start_dt)
        .where(BalanceSnapshot.captured_at < end_dt)
        .order_by(BalanceSnapshot.captured_at.asc())
    ).scalars()
    snapshot_points = [
        {
            "date": snap.captured_at.date().isoformat(),
            "balance": round(float(snap.balance), 2),
        }
        for snap in snapshots
    ]

    monthly_rows = [
        {
            "month": row["month"],
            "payment_amount": round(float(row["payment_amount"]), 2),
            "charge_amount": round(float(row["charge_amount"]), 2),
            "net_change": round(float(row["net_change"]), 2),
        }
        for _, row in sorted(monthly.items(), key=lambda item: item[0])
    ]

    return {
        "monthly": monthly_rows,
        "snapshot_points": snapshot_points,
        "transaction_count": txn_count,
        "snapshot_count": len(snapshot_points),
    }
