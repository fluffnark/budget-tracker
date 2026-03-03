"""initial schema

Revision ID: 20260222_0001
Revises:
Create Date: 2026-02-22
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "20260222_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "owner",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("email", sa.String(length=255), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    op.create_table(
        "connections",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("kind", sa.String(length=50), nullable=False, server_default="simplefin"),
        sa.Column("access_url_encrypted", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=50), nullable=False, server_default="ok"),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    op.create_table(
        "institutions",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=255), nullable=False, unique=True),
        sa.Column("provider_meta", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.create_table(
        "accounts",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("institution_id", sa.Integer(), sa.ForeignKey("institutions.id"), nullable=True),
        sa.Column("source_type", sa.String(length=20), nullable=False),
        sa.Column("provider_account_id", sa.String(length=255), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("type", sa.String(length=50), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="USD"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    op.create_table(
        "balance_snapshots",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("account_id", sa.String(length=36), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("balance", sa.Numeric(14, 2), nullable=False),
        sa.Column("available_balance", sa.Numeric(14, 2), nullable=True),
        sa.Column("as_of", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "captured_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )
    op.create_index(
        "idx_balance_account_captured", "balance_snapshots", ["account_id", "captured_at"]
    )

    op.create_table(
        "merchants",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name_canonical", sa.String(length=255), nullable=False, unique=True),
        sa.Column("aliases", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )

    op.create_table(
        "categories",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("parent_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("system_kind", sa.String(length=50), nullable=False),
    )

    op.create_table(
        "transfers",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("txn_out_id", sa.String(length=36), nullable=False),
        sa.Column("txn_in_id", sa.String(length=36), nullable=False),
        sa.Column("confidence", sa.Numeric(4, 2), nullable=False),
        sa.Column("status", sa.String(length=30), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("txn_out_id", name="uq_transfer_out"),
        sa.UniqueConstraint("txn_in_id", name="uq_transfer_in"),
        sa.CheckConstraint("confidence >= 0 AND confidence <= 1", name="chk_transfer_conf"),
    )

    op.create_table(
        "transactions",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("account_id", sa.String(length=36), sa.ForeignKey("accounts.id"), nullable=False),
        sa.Column("provider_txn_id", sa.String(length=255), nullable=True),
        sa.Column("posted_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("amount", sa.Numeric(14, 2), nullable=False),
        sa.Column("currency", sa.String(length=10), nullable=False, server_default="USD"),
        sa.Column("description_raw", sa.Text(), nullable=False),
        sa.Column("description_norm", sa.Text(), nullable=False),
        sa.Column("is_pending", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("pending_fingerprint", sa.String(length=64), nullable=True),
        sa.Column("merchant_id", sa.Integer(), sa.ForeignKey("merchants.id"), nullable=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=True),
        sa.Column("transfer_id", sa.Integer(), sa.ForeignKey("transfers.id"), nullable=True),
        sa.Column("ingestion_hash", sa.String(length=64), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
        sa.UniqueConstraint("account_id", "ingestion_hash", name="uq_txn_ingestion"),
    )

    op.create_index(
        "uq_txn_provider",
        "transactions",
        ["account_id", "provider_txn_id"],
        unique=True,
        postgresql_where=sa.text("provider_txn_id IS NOT NULL"),
    )
    op.create_index("idx_txn_account_posted", "transactions", ["account_id", "posted_at"])
    op.create_index("idx_txn_category_posted", "transactions", ["category_id", "posted_at"])
    op.create_index("idx_txn_pending_posted", "transactions", ["is_pending", "posted_at"])

    op.create_foreign_key(
        "fk_transfer_out_txn", "transfers", "transactions", ["txn_out_id"], ["id"]
    )
    op.create_foreign_key("fk_transfer_in_txn", "transfers", "transactions", ["txn_in_id"], ["id"])

    op.create_table(
        "classification_rules",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("priority", sa.Integer(), nullable=False, server_default="100"),
        sa.Column("match_type", sa.String(length=20), nullable=False),
        sa.Column("pattern", sa.Text(), nullable=True),
        sa.Column("category_id", sa.Integer(), sa.ForeignKey("categories.id"), nullable=False),
        sa.Column(
            "merchant_override_id", sa.Integer(), sa.ForeignKey("merchants.id"), nullable=True
        ),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
    )

    op.create_table(
        "audit_log",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("action_type", sa.String(length=50), nullable=False),
        sa.Column("entity_type", sa.String(length=50), nullable=False),
        sa.Column("entity_id", sa.String(length=50), nullable=False),
        sa.Column("before", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column("after", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    op.create_table(
        "app_settings",
        sa.Column("key", sa.String(length=100), primary_key=True),
        sa.Column("value", sa.Text(), nullable=False),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False
        ),
    )

    seed_categories = [
        ("Income", None, "income"),
        ("Housing", None, "expense"),
        ("Utilities", None, "expense"),
        ("Utilities/Electric", "Utilities", "expense"),
        ("Utilities/Gas", "Utilities", "expense"),
        ("Utilities/Water", "Utilities", "expense"),
        ("Utilities/Trash", "Utilities", "expense"),
        ("Utilities/Internet", "Utilities", "expense"),
        ("Utilities/Mobile", "Utilities", "expense"),
        ("Food", None, "expense"),
        ("Transportation", None, "expense"),
        ("Health", None, "expense"),
        ("Personal", None, "expense"),
        ("Entertainment", None, "expense"),
        ("Travel", None, "expense"),
        ("Education", None, "expense"),
        ("Charity", None, "expense"),
        ("Fees & Interest", None, "expense"),
        ("Taxes", None, "expense"),
        ("Transfers", None, "transfer"),
        ("Transfers/Internal", "Transfers", "transfer"),
        ("Uncategorized/Needs Review", None, "uncategorized"),
    ]

    conn = op.get_bind()
    parent_ids = {}
    for name, parent_name, kind in seed_categories:
        parent_id = parent_ids.get(parent_name)
        result = conn.execute(
            sa.text(
                "INSERT INTO categories (name, parent_id, system_kind) "
                "VALUES (:name, :parent_id, :system_kind) RETURNING id"
            ),
            {"name": name, "parent_id": parent_id, "system_kind": kind},
        )
        parent_ids[name] = result.scalar_one()

    conn.execute(
        sa.text(
            "INSERT INTO app_settings (key, value) VALUES "
            "('sync_daily_hour','6'), ('sync_daily_minute','0'), ('scrub_default','1')"
        )
    )


def downgrade() -> None:
    op.drop_table("app_settings")
    op.drop_table("audit_log")
    op.drop_table("classification_rules")
    op.drop_index("idx_txn_pending_posted", table_name="transactions")
    op.drop_index("idx_txn_category_posted", table_name="transactions")
    op.drop_index("idx_txn_account_posted", table_name="transactions")
    op.drop_index("uq_txn_provider", table_name="transactions")
    op.drop_table("transactions")
    op.drop_table("transfers")
    op.drop_table("categories")
    op.drop_table("merchants")
    op.drop_index("idx_balance_account_captured", table_name="balance_snapshots")
    op.drop_table("balance_snapshots")
    op.drop_table("accounts")
    op.drop_table("institutions")
    op.drop_table("connections")
    op.drop_table("owner")
