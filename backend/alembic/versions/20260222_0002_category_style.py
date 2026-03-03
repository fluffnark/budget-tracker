"""add category style fields

Revision ID: 20260222_0002
Revises: 20260222_0001
Create Date: 2026-02-22
"""

from alembic import op

revision = "20260222_0002"
down_revision = "20260222_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute("ALTER TABLE categories ADD COLUMN IF NOT EXISTS color VARCHAR(20)")
    op.execute("ALTER TABLE categories ADD COLUMN IF NOT EXISTS icon VARCHAR(50)")


def downgrade() -> None:
    op.execute("ALTER TABLE categories DROP COLUMN IF EXISTS icon")
    op.execute("ALTER TABLE categories DROP COLUMN IF EXISTS color")
