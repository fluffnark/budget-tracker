"""add transaction review state

Revision ID: 20260412_0007
Revises: 20260317_0006
Create Date: 2026-04-12
"""

import sqlalchemy as sa

from alembic import op

revision = "20260412_0007"
down_revision = "20260317_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("transactions")}

    if "is_reviewed" not in columns:
        op.add_column(
            "transactions",
            sa.Column("is_reviewed", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
    if "reviewed_at" not in columns:
        op.add_column("transactions", sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True))

    op.execute(
        """
        UPDATE transactions
        SET is_reviewed = TRUE,
            reviewed_at = COALESCE(updated_at, created_at, NOW())
        WHERE reviewed_at IS NULL
        """
    )

    op.alter_column("transactions", "is_reviewed", server_default=None)


def downgrade() -> None:
    op.drop_column("transactions", "reviewed_at")
    op.drop_column("transactions", "is_reviewed")
