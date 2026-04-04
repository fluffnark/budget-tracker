"""add category spend bucket

Revision ID: 20260317_0006
Revises: 20260314_0005
Create Date: 2026-03-17
"""

import sqlalchemy as sa

from alembic import op

revision = "20260317_0006"
down_revision = "20260314_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("categories")}
    if "spend_bucket" not in columns:
        op.add_column("categories", sa.Column("spend_bucket", sa.String(length=30), nullable=True))

    op.execute(
        """
        UPDATE categories
        SET spend_bucket = CASE
            WHEN system_kind = 'income' THEN 'income'
            WHEN system_kind = 'transfer' THEN 'transfer'
            WHEN system_kind = 'uncategorized' THEN 'uncategorized'
            WHEN name IN ('Entertainment', 'Travel', 'Charity', 'Personal')
                THEN 'discretionary'
            WHEN name = 'Education'
                THEN 'savings'
            WHEN name = 'Fees & Interest'
                THEN 'debt'
            ELSE 'essential'
        END
        WHERE parent_id IS NULL
        """
    )
    op.execute(
        """
        UPDATE categories AS child
        SET spend_bucket = CASE
            WHEN child.system_kind = 'income' THEN 'income'
            WHEN child.system_kind = 'transfer' THEN 'transfer'
            WHEN child.system_kind = 'uncategorized' THEN 'uncategorized'
            WHEN parent.name IN ('Entertainment', 'Travel', 'Charity', 'Personal')
                THEN 'discretionary'
            WHEN parent.name = 'Education'
                THEN 'savings'
            WHEN parent.name = 'Fees & Interest'
                THEN 'debt'
            ELSE 'essential'
        END
        FROM categories AS parent
        WHERE child.parent_id = parent.id
        """
    )


def downgrade() -> None:
    op.drop_column("categories", "spend_bucket")
