"""add manual category override flag

Revision ID: 20260222_0003
Revises: 20260222_0002
Create Date: 2026-02-22
"""

import sqlalchemy as sa

from alembic import op

revision = "20260222_0003"
down_revision = "20260222_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("transactions")}
    if "manual_category_override" in columns:
        return

    op.add_column(
        "transactions",
        sa.Column(
            "manual_category_override",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("transactions", "manual_category_override")
