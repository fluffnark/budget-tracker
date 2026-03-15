"""budget planning tables

Revision ID: 20260314_0004
Revises: 20260222_0003
Create Date: 2026-03-14
"""

import sqlalchemy as sa

from alembic import op

revision = "20260314_0004"
down_revision = "20260222_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "budget_months",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("month_start", sa.Date(), nullable=False, unique=True),
        sa.Column("income_target", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("starting_cash", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("planned_savings", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column(
            "leftover_strategy", sa.String(length=30), nullable=False, server_default="unassigned"
        ),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    op.create_table(
        "budget_category_plans",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("budget_month_id", sa.Integer(), sa.ForeignKey("budget_months.id"), nullable=False),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=False),
        sa.Column("planned_amount", sa.Numeric(14, 2), nullable=False, server_default="0"),
        sa.Column("is_fixed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("is_essential", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("rollover_mode", sa.String(length=20), nullable=False, server_default="none"),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("budget_month_id", "category_id", name="uq_budget_category_month"),
    )
    op.create_index(
        "idx_budget_category_month",
        "budget_category_plans",
        ["budget_month_id", "category_id"],
    )


def downgrade() -> None:
    op.drop_index("idx_budget_category_month", table_name="budget_category_plans")
    op.drop_table("budget_category_plans")
    op.drop_table("budget_months")
