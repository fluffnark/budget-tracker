from __future__ import annotations

import html
import json
import smtplib
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from email.message import EmailMessage
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import Session

from app.models import Account, BalanceSnapshot, Category, Transaction
from app.services.email_reports import load_email_report_settings
from app.services.exporter import build_llm_export


@dataclass
class AdvisorBundle:
    start: date
    end: date
    days: int
    stats: dict[str, Any]
    charts: dict[str, Any]
    scrubbed_payload: dict[str, Any]
    prompt_markdown: str


def _period_range(*, days: int, end_date: date | None = None) -> tuple[date, date]:
    end = end_date or datetime.now(UTC).date()
    start = end - timedelta(days=max(days, 1) - 1)
    return start, end


def _bar(value: float, max_value: float, width: int = 26) -> str:
    if max_value <= 0:
        return ""
    filled = int(round((max(0.0, value) / max_value) * width))
    return "█" * max(0, min(width, filled))


def _txns_for_range(
    db: Session,
    *,
    start: date,
    end: date,
    include_pending: bool,
    include_transfers: bool,
) -> list[tuple[Transaction, Account, Category | None]]:
    q = (
        select(Transaction, Account, Category)
        .join(Account, Account.id == Transaction.account_id)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .where(Transaction.posted_at >= datetime.combine(start, datetime.min.time(), tzinfo=UTC))
        .where(
            Transaction.posted_at
            < datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC)
        )
        .order_by(Transaction.posted_at.asc())
    )
    if not include_pending:
        q = q.where(Transaction.is_pending.is_(False))
    if not include_transfers:
        q = q.where(
            and_(
                Transaction.transfer_id.is_(None),
                or_(Category.system_kind.is_(None), Category.system_kind != "transfer"),
            )
        )
    return list(db.execute(q).all())


def _is_retirement_account(account: Account) -> bool:
    token = f"{(account.name or '').lower()} {(account.type or '').lower()}"
    return any(part in token for part in ["ira", "401k", "retirement", "roth", "pension"])


def _is_mortgage_account(account: Account) -> bool:
    token = f"{(account.name or '').lower()} {(account.type or '').lower()}"
    return any(part in token for part in ["mortgage", "home loan", "housing loan"])


def _is_liability_account(account: Account) -> bool:
    token = (account.type or "").lower()
    return any(
        part in token
        for part in ["credit", "loan", "mortgage", "liability", "debt"]
    ) or _is_mortgage_account(account)


def _latest_account_snapshot(db: Session) -> list[tuple[Account, float, float | None]]:
    latest_subq = (
        select(
            BalanceSnapshot.account_id.label("account_id"),
            func.max(BalanceSnapshot.id).label("latest_snapshot_id"),
        )
        .group_by(BalanceSnapshot.account_id)
        .subquery()
    )
    rows = db.execute(
        select(
            Account,
            BalanceSnapshot.balance,
            BalanceSnapshot.available_balance,
        )
        .join(latest_subq, latest_subq.c.account_id == Account.id)
        .join(
            BalanceSnapshot,
            and_(
                BalanceSnapshot.account_id == Account.id,
                BalanceSnapshot.id == latest_subq.c.latest_snapshot_id,
            ),
        )
    ).all()
    return [
        (
            account,
            float(balance or 0.0),
            float(available) if available is not None else None,
        )
        for account, balance, available in rows
    ]


def generate_advisor_bundle(
    db: Session,
    *,
    days: int,
    end_date: date | None = None,
    include_pending: bool = True,
    include_transfers: bool = False,
    hash_merchants: bool = True,
    round_amounts: bool = False,
) -> AdvisorBundle:
    start, end = _period_range(days=days, end_date=end_date)
    rows = _txns_for_range(
        db,
        start=start,
        end=end,
        include_pending=include_pending,
        include_transfers=include_transfers,
    )
    all_rows = _txns_for_range(
        db,
        start=start,
        end=end,
        include_pending=include_pending,
        include_transfers=True,
    )
    latest_accounts = _latest_account_snapshot(db)

    inflow = 0.0
    outflow = 0.0
    pending_count = 0
    uncategorized_count = 0
    transfer_count = 0
    transfer_count_all = 0
    by_category: dict[str, float] = {}
    by_account_type: dict[str, float] = {}
    by_day: dict[str, dict[str, float]] = {}

    for txn, account, category in rows:
        amount = float(txn.amount)
        day_key = txn.posted_at.date().isoformat()
        if day_key not in by_day:
            by_day[day_key] = {"inflow": 0.0, "outflow": 0.0, "net": 0.0}
        if amount >= 0:
            inflow += amount
            by_day[day_key]["inflow"] += amount
        else:
            spend = abs(amount)
            outflow += spend
            by_day[day_key]["outflow"] += spend
            category_name = category.name if category else "Uncategorized/Needs Review"
            by_category[category_name] = by_category.get(category_name, 0.0) + spend
            acct_type = account.type or "other"
            by_account_type[acct_type] = by_account_type.get(acct_type, 0.0) + spend

        by_day[day_key]["net"] = by_day[day_key]["inflow"] - by_day[day_key]["outflow"]

        if txn.is_pending:
            pending_count += 1
        if txn.transfer_id is not None or (category and category.system_kind == "transfer"):
            transfer_count += 1
        if category is None or category.system_kind == "uncategorized":
            uncategorized_count += 1

    for txn, _account, category in all_rows:
        if txn.transfer_id is not None or (category and category.system_kind == "transfer"):
            transfer_count_all += 1

    top_categories = sorted(by_category.items(), key=lambda item: item[1], reverse=True)[:10]
    account_type_spend = sorted(by_account_type.items(), key=lambda item: item[1], reverse=True)
    daily_series = [
        {
            "date": day,
            "inflow": round(values["inflow"], 2),
            "outflow": round(values["outflow"], 2),
            "net": round(values["net"], 2),
        }
        for day, values in sorted(by_day.items())
    ]

    max_cat = max((value for _, value in top_categories), default=0.0)
    top_category_chart = [
        {
            "label": name,
            "amount": round(value, 2),
            "bar": _bar(value, max_cat),
        }
        for name, value in top_categories
    ]

    max_daily_abs = max((abs(item["net"]) for item in daily_series), default=0.0)
    daily_net_chart = [
        {
            "date": item["date"],
            "net": item["net"],
            "bar": _bar(abs(item["net"]), max_daily_abs, 18),
            "direction": "up" if item["net"] >= 0 else "down",
        }
        for item in daily_series
    ]

    scrubbed_payload = build_llm_export(
        db,
        start=start,
        end=end,
        scrub=True,
        hash_merchants=hash_merchants,
        round_amounts=round_amounts,
    )

    by_type_totals: dict[str, dict[str, float]] = {}
    total_assets = 0.0
    total_liabilities = 0.0
    retirement_balance = 0.0
    mortgage_balance = 0.0

    for account, balance, available in latest_accounts:
        type_key = (account.type or "other").lower() or "other"
        bucket = by_type_totals.setdefault(
            type_key,
            {"balance": 0.0, "available": 0.0, "accounts": 0.0},
        )
        bucket["balance"] += balance
        bucket["available"] += available or 0.0
        bucket["accounts"] += 1

        if _is_liability_account(account):
            total_liabilities += abs(balance)
        else:
            total_assets += max(balance, 0.0)
        if _is_retirement_account(account):
            retirement_balance += balance
        if _is_mortgage_account(account):
            mortgage_balance += balance

    retirement_inflow = 0.0
    retirement_outflow = 0.0
    mortgage_inflow = 0.0
    mortgage_outflow = 0.0
    mortgage_category_outflow = 0.0

    for txn, account, category in all_rows:
        amount = float(txn.amount)
        if _is_retirement_account(account):
            if amount >= 0:
                retirement_inflow += amount
            else:
                retirement_outflow += abs(amount)
        if _is_mortgage_account(account):
            if amount >= 0:
                mortgage_inflow += amount
            else:
                mortgage_outflow += abs(amount)
        if category and category.id == 7 and amount < 0:
            mortgage_category_outflow += abs(amount)

    account_balance_by_type = [
        {
            "account_type": account_type,
            "balance": round(values["balance"], 2),
            "available": round(values["available"], 2),
            "account_count": int(values["accounts"]),
        }
        for account_type, values in sorted(
            by_type_totals.items(), key=lambda item: abs(item[1]["balance"]), reverse=True
        )
    ]

    stats = {
        "transaction_count": len(rows),
        "pending_count": pending_count,
        "uncategorized_count": uncategorized_count,
        "transfer_count": transfer_count,
        "transfer_count_all": transfer_count_all,
        "totals": {
            "inflow": round(inflow, 2),
            "outflow": round(outflow, 2),
            "net": round(inflow - outflow, 2),
            "savings_rate": (
                round(((inflow - outflow) / inflow) * 100, 2) if inflow > 0 else None
            ),
        },
        "top_categories": [
            {"category": name, "amount": round(value, 2)} for name, value in top_categories
        ],
        "spend_by_account_type": [
            {"account_type": name, "amount": round(value, 2)} for name, value in account_type_spend
        ],
        "account_totals": {
            "tracked_accounts": len(latest_accounts),
            "assets": round(total_assets, 2),
            "liabilities": round(total_liabilities, 2),
            "estimated_net_worth": round(total_assets - total_liabilities, 2),
            "balance_by_account_type": account_balance_by_type,
        },
        "retirement": {
            "account_count": sum(1 for account, _, _ in latest_accounts if _is_retirement_account(account)),
            "total_balance": round(retirement_balance, 2),
            "period_inflow": round(retirement_inflow, 2),
            "period_outflow": round(retirement_outflow, 2),
            "period_net_flow": round(retirement_inflow - retirement_outflow, 2),
        },
        "mortgage": {
            "account_count": sum(1 for account, _, _ in latest_accounts if _is_mortgage_account(account)),
            "total_balance": round(mortgage_balance, 2),
            "period_account_inflow": round(mortgage_inflow, 2),
            "period_account_outflow": round(mortgage_outflow, 2),
            "period_mortgage_category_outflow": round(mortgage_category_outflow, 2),
        },
    }
    charts = {
        "top_category_spend": top_category_chart,
        "daily_net": daily_net_chart,
        "monthly_summary": scrubbed_payload.get("summary", []),
    }

    prompt_markdown = _build_advisor_prompt(start=start, end=end, stats=stats, charts=charts, payload=scrubbed_payload)

    return AdvisorBundle(
        start=start,
        end=end,
        days=days,
        stats=stats,
        charts=charts,
        scrubbed_payload=scrubbed_payload,
        prompt_markdown=prompt_markdown,
    )


def _build_advisor_prompt(
    *,
    start: date,
    end: date,
    stats: dict[str, Any],
    charts: dict[str, Any],
    payload: dict[str, Any],
) -> str:
    context = {
        "period": {"start": start.isoformat(), "end": end.isoformat()},
        "stats": stats,
        "charts": charts,
    }
    return (
        "# Role\n"
        "You are an expert personal financial adviser and cash-flow strategist.\n\n"
        "# Objective\n"
        "Review the scrubbed budget dataset and produce practical, high-impact recommendations.\n\n"
        "# Constraints\n"
        "- Do not request personally identifiable information.\n"
        "- Assume this is a local-only single-user budget system.\n"
        "- Respect transfer-aware accounting and pending transaction caveats.\n\n"
        "# Required Output Format (Markdown)\n"
        "1. Executive Summary (5 bullets max)\n"
        "2. Top 5 Actionable Recommendations (each with: impact estimate, confidence, and next step)\n"
        "3. Risk Assessment (cashflow, debt, concentration, liquidity, downside scenarios)\n"
        "4. Tax Considerations (federal/state planning opportunities, account placement, caveats)\n"
        "5. Market Research & Figures (inflation, rates, broad market context relevant to recommendations)\n"
        "6. 30-Day Plan\n"
        "7. 90-Day Plan\n"
        "8. Outlook (3, 6, and 12 month scenarios with assumptions)\n"
        "9. Recommended Reading & Optional Advisors (books, newsletters, credentialed advisor types)\n"
        "10. Questions To Clarify (max 5)\n\n"
        "# Research & Evidence Rules\n"
        "- Include concrete figures where relevant, but separate facts vs estimates.\n"
        "- For market/tax claims, provide source name and recency (month/year).\n"
        "- If unsure, state uncertainty explicitly instead of guessing.\n"
        "- Keep recommendations practical for a U.S.-based household.\n\n"
        "Use concise language, concrete numbers, and avoid generic advice.\n\n"
        "## Context Snapshot (JSON)\n"
        "```json\n"
        f"{json.dumps(context, indent=2)}\n"
        "```\n\n"
        "## Scrubbed Financial Dataset (JSON)\n"
        "```json\n"
        f"{json.dumps(payload, indent=2)}\n"
        "```\n"
    )


def build_advisor_email(
    *,
    bundle: AdvisorBundle,
    advisor_response: str,
) -> dict[str, str]:
    totals = bundle.stats["totals"]
    top_categories = bundle.stats.get("top_categories", [])[:8]
    monthly_summary = bundle.charts.get("monthly_summary", [])[-6:]
    daily_net = bundle.charts.get("daily_net", [])[-14:]
    savings_rate = totals.get("savings_rate")
    savings_rate_text = (
        f"{savings_rate:.2f}%"
        if isinstance(savings_rate, (int, float))
        else "n/a (no inflow in period)"
    )
    period_label = f"{bundle.start.isoformat()} to {bundle.end.isoformat()}"
    subject = f"Budget Advisor Report: {bundle.end.strftime('%B %Y')}"

    top_category_md = "\n".join(
        [
            f"| {row['category']} | ${row['amount']:.2f} |"
            for row in top_categories
        ]
    )
    if not top_category_md:
        top_category_md = "| No spend categories found | $0.00 |"

    monthly_md = "\n".join(
        [
            f"| {row.get('month', '-')} | ${float(row.get('inflow', 0.0)):.2f} | ${float(row.get('outflow', 0.0)):.2f} | ${float(row.get('net', 0.0)):.2f} |"
            for row in monthly_summary
        ]
    )
    if not monthly_md:
        monthly_md = "| n/a | $0.00 | $0.00 | $0.00 |"

    daily_chart_md = "\n".join(
        [
            f"- {row['date']}: {'+' if row['net'] >= 0 else '-'}${abs(float(row['net'])):.2f} {row['bar']}"
            for row in daily_net
        ]
    )
    if not daily_chart_md:
        daily_chart_md = "- n/a"

    markdown = (
        f"# Financial Advisor Report\n\n"
        f"**Period:** {period_label}\n\n"
        f"## Snapshot\n"
        f"- Inflow: **${totals['inflow']:.2f}**\n"
        f"- Outflow: **${totals['outflow']:.2f}**\n"
        f"- Net: **${totals['net']:.2f}**\n"
        f"- Savings Rate: **{savings_rate_text}**\n"
        f"- Transactions: **{bundle.stats['transaction_count']}**\n"
        f"- Pending: **{bundle.stats['pending_count']}**\n"
        f"- Uncategorized: **{bundle.stats['uncategorized_count']}**\n\n"
        f"## Top Spend Categories\n"
        f"| Category | Spend |\n"
        f"|---|---:|\n"
        f"{top_category_md}\n\n"
        f"## Monthly Trend (Last 6)\n"
        f"| Month | Inflow | Outflow | Net |\n"
        f"|---|---:|---:|---:|\n"
        f"{monthly_md}\n\n"
        f"## Daily Net Movement (Last 14 Days)\n"
        f"{daily_chart_md}\n\n"
        f"## Advisor Recommendations\n\n"
        f"{advisor_response.strip() or '_No advisor response provided yet._'}\n"
    )

    top_category_rows_html = "".join(
        [
            "<tr>"
            f"<td>{html.escape(row['category'])}</td>"
            f"<td style='text-align:right;'>${float(row['amount']):.2f}</td>"
            "</tr>"
            for row in top_categories
        ]
    ) or "<tr><td>No spend categories found</td><td style='text-align:right;'>$0.00</td></tr>"

    monthly_rows_html = "".join(
        [
            "<tr>"
            f"<td>{html.escape(str(row.get('month', '-')))}</td>"
            f"<td style='text-align:right;'>${float(row.get('inflow', 0.0)):.2f}</td>"
            f"<td style='text-align:right;'>${float(row.get('outflow', 0.0)):.2f}</td>"
            f"<td style='text-align:right;'>${float(row.get('net', 0.0)):.2f}</td>"
            "</tr>"
            for row in monthly_summary
        ]
    ) or (
        "<tr><td>n/a</td><td style='text-align:right;'>$0.00</td>"
        "<td style='text-align:right;'>$0.00</td><td style='text-align:right;'>$0.00</td></tr>"
    )

    advisor_html = (
        html.escape(advisor_response.strip()).replace("\n", "<br/>")
        if advisor_response.strip()
        else "<em>No advisor response provided yet.</em>"
    )

    html_body = f"""
<html>
  <body style="margin:0;padding:0;background:#f4f6f8;font-family:'Segoe UI',Arial,sans-serif;color:#1f2937;">
    <div style="max-width:900px;margin:24px auto;background:#ffffff;border:1px solid #dbe2ea;border-radius:14px;overflow:hidden;">
      <div style="padding:24px 28px;background:linear-gradient(135deg,#1f4f46,#2f7f74);color:#ffffff;">
        <h1 style="margin:0 0 6px;font-size:28px;">Financial Advisor Report</h1>
        <p style="margin:0;opacity:.95;">Period: {html.escape(period_label)}</p>
      </div>
      <div style="padding:22px 28px;">
        <table width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:18px;border-collapse:separate;border-spacing:10px 10px;">
          <tr>
            <td style="background:#f8fafc;border:1px solid #e5edf4;border-radius:10px;padding:14px;">
              <div style="font-size:12px;color:#6b7280;">Inflow</div>
              <div style="font-size:24px;font-weight:700;">${totals['inflow']:.2f}</div>
            </td>
            <td style="background:#f8fafc;border:1px solid #e5edf4;border-radius:10px;padding:14px;">
              <div style="font-size:12px;color:#6b7280;">Outflow</div>
              <div style="font-size:24px;font-weight:700;">${totals['outflow']:.2f}</div>
            </td>
            <td style="background:#f8fafc;border:1px solid #e5edf4;border-radius:10px;padding:14px;">
              <div style="font-size:12px;color:#6b7280;">Net</div>
              <div style="font-size:24px;font-weight:700;color:{'#0f766e' if totals['net'] >= 0 else '#b91c1c'};">${totals['net']:.2f}</div>
            </td>
            <td style="background:#f8fafc;border:1px solid #e5edf4;border-radius:10px;padding:14px;">
              <div style="font-size:12px;color:#6b7280;">Savings Rate</div>
              <div style="font-size:24px;font-weight:700;">{html.escape(savings_rate_text)}</div>
            </td>
          </tr>
        </table>

        <h2 style="margin:4px 0 10px;font-size:20px;">Top Spend Categories</h2>
        <table width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse;border:1px solid #e5edf4;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#f8fafc;">
              <th align="left" style="border-bottom:1px solid #e5edf4;">Category</th>
              <th align="right" style="border-bottom:1px solid #e5edf4;">Spend</th>
            </tr>
          </thead>
          <tbody>{top_category_rows_html}</tbody>
        </table>

        <h2 style="margin:18px 0 10px;font-size:20px;">Monthly Trend (Last 6)</h2>
        <table width="100%" cellspacing="0" cellpadding="8" style="border-collapse:collapse;border:1px solid #e5edf4;border-radius:10px;overflow:hidden;">
          <thead>
            <tr style="background:#f8fafc;">
              <th align="left" style="border-bottom:1px solid #e5edf4;">Month</th>
              <th align="right" style="border-bottom:1px solid #e5edf4;">Inflow</th>
              <th align="right" style="border-bottom:1px solid #e5edf4;">Outflow</th>
              <th align="right" style="border-bottom:1px solid #e5edf4;">Net</th>
            </tr>
          </thead>
          <tbody>{monthly_rows_html}</tbody>
        </table>

        <h2 style="margin:18px 0 10px;font-size:20px;">Advisor Recommendations</h2>
        <div style="border:1px solid #e5edf4;background:#fbfdff;border-radius:10px;padding:14px;line-height:1.55;">
          {advisor_html}
        </div>

        <p style="margin-top:16px;font-size:12px;color:#6b7280;">
          Generated from privacy-scrubbed data (hashed merchants, no account names, no credentials).
        </p>
      </div>
    </div>
  </body>
</html>
""".strip()

    return {"subject": subject, "markdown": markdown, "html": html_body}


def send_advisor_email(
    db: Session,
    *,
    recipients_csv: str,
    subject: str,
    markdown_body: str,
    html_body: str,
) -> dict[str, Any]:
    cfg = load_email_report_settings(db)
    recipients = [item.strip() for item in recipients_csv.split(",") if item.strip()]
    if not recipients:
        return {"sent": False, "reason": "missing_recipients", "recipient_count": 0}
    if not cfg.smtp_host or not cfg.smtp_from:
        return {"sent": False, "reason": "missing_smtp_host_or_from", "recipient_count": 0}
    if cfg.smtp_use_ssl and cfg.smtp_use_tls:
        return {"sent": False, "reason": "invalid_smtp_security_mode", "recipient_count": 0}

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = cfg.smtp_from
    msg["To"] = ", ".join(recipients)
    msg.set_content(markdown_body)
    msg.add_alternative(html_body, subtype="html")

    if cfg.smtp_use_ssl:
        with smtplib.SMTP_SSL(cfg.smtp_host, cfg.smtp_port, timeout=20) as smtp:
            if cfg.smtp_username:
                smtp.login(cfg.smtp_username, cfg.smtp_password)
            smtp.send_message(msg)
    else:
        with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=20) as smtp:
            smtp.ehlo()
            if cfg.smtp_use_tls:
                smtp.starttls()
                smtp.ehlo()
            if cfg.smtp_username:
                smtp.login(cfg.smtp_username, cfg.smtp_password)
            smtp.send_message(msg)

    return {"sent": True, "reason": None, "recipient_count": len(recipients)}
