from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import AppSetting, Category

DEFAULT_CATEGORIES = {
    "Income": ["Salary", "Bonus", "Other Income"],
    "Housing": ["Rent", "Mortgage", "Maintenance"],
    "Utilities": [
        "Utilities/Electric",
        "Utilities/Gas",
        "Utilities/Water",
        "Utilities/Trash",
        "Utilities/Internet",
        "Utilities/Mobile",
    ],
    "Food": ["Groceries", "Dining"],
    "Transportation": ["Fuel", "Transit", "Repairs"],
    "Health": ["Medical", "Pharmacy"],
    "Personal": ["Clothing", "Home Supplies"],
    "Entertainment": ["Streaming", "Events"],
    "Travel": ["Flights", "Hotels"],
    "Education": ["Tuition", "Books"],
    "Charity": ["Donations"],
    "Fees & Interest": ["Bank Fees", "Card Interest"],
    "Taxes": ["Federal", "State"],
    "Transfers": ["Transfers/Internal"],
    "Uncategorized/Needs Review": [],
}

DEFAULT_CATEGORY_STYLE = {
    "Income": {"color": "#2A9D8F", "icon": "💼"},
    "Housing": {"color": "#6D597A", "icon": "🏠"},
    "Utilities": {"color": "#E76F51", "icon": "🔌"},
    "Food": {"color": "#F4A261", "icon": "🛒"},
    "Transportation": {"color": "#3A86FF", "icon": "🚗"},
    "Health": {"color": "#9D4EDD", "icon": "🩺"},
    "Personal": {"color": "#8D99AE", "icon": "🧍"},
    "Entertainment": {"color": "#FF006E", "icon": "🎬"},
    "Travel": {"color": "#118AB2", "icon": "✈️"},
    "Education": {"color": "#264653", "icon": "📚"},
    "Charity": {"color": "#06D6A0", "icon": "🤝"},
    "Fees & Interest": {"color": "#9C6644", "icon": "💳"},
    "Taxes": {"color": "#D62828", "icon": "🧾"},
    "Transfers": {"color": "#457B9D", "icon": "🔁"},
    "Uncategorized/Needs Review": {"color": "#6C757D", "icon": "❔"},
}


DEFAULT_SETTINGS = {
    "sync_daily_hour": str(settings.sync_daily_hour),
    "sync_daily_minute": str(settings.sync_daily_minute),
    "scrub_default": "1",
    "email_reports_enabled": "0",
    "email_report_day": "1",
    "email_report_hour": "12",
    "email_report_minute": "0",
    "email_report_recipients": "",
    "smtp_host": "",
    "smtp_port": "587",
    "smtp_username": "",
    "smtp_from": "",
    "smtp_use_tls": "1",
    "smtp_use_ssl": "0",
}


def ensure_seed_data(db: Session) -> None:
    for key, value in DEFAULT_SETTINGS.items():
        existing = db.execute(select(AppSetting).where(AppSetting.key == key)).scalar_one_or_none()
        if not existing:
            db.add(AppSetting(key=key, value=value))

    existing_categories = set(db.execute(select(Category.name)).scalars().all())

    for parent_name, children in DEFAULT_CATEGORIES.items():
        if parent_name not in existing_categories:
            if parent_name == "Income":
                kind = "income"
            elif parent_name == "Transfers":
                kind = "transfer"
            elif parent_name == "Uncategorized/Needs Review":
                kind = "uncategorized"
            else:
                kind = "expense"
            parent = Category(name=parent_name, system_kind=kind, parent_id=None)
            style = DEFAULT_CATEGORY_STYLE.get(parent_name)
            if style:
                parent.color = style["color"]
                parent.icon = style["icon"]
            db.add(parent)
            db.flush()
            existing_categories.add(parent_name)
        else:
            parent = db.execute(select(Category).where(Category.name == parent_name)).scalar_one()
            style = DEFAULT_CATEGORY_STYLE.get(parent_name)
            if style and not parent.color:
                parent.color = style["color"]
            if style and not parent.icon:
                parent.icon = style["icon"]

        for child in children:
            if child in existing_categories:
                continue
            kind = (
                parent.system_kind
                if parent.system_kind in {"income", "expense", "transfer"}
                else "expense"
            )
            db.add(
                Category(
                    name=child,
                    system_kind=kind,
                    parent_id=parent.id,
                    color=parent.color,
                    icon=parent.icon,
                )
            )
            existing_categories.add(child)

    db.commit()
