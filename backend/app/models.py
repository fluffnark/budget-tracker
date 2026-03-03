import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Owner(Base):
    __tablename__ = "owner"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Connection(Base):
    __tablename__ = "connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    kind: Mapped[str] = mapped_column(String(50), default="simplefin", nullable=False)
    access_url_encrypted: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(50), default="ok", nullable=False)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Institution(Base):
    __tablename__ = "institutions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    provider_meta: Mapped[dict | None] = mapped_column(JSONB, nullable=True)

    accounts: Mapped[list["Account"]] = relationship(back_populates="institution")


class Account(Base):
    __tablename__ = "accounts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    institution_id: Mapped[int | None] = mapped_column(ForeignKey("institutions.id"), nullable=True)
    source_type: Mapped[str] = mapped_column(String(20), nullable=False)
    provider_account_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    type: Mapped[str] = mapped_column(String(50), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    institution: Mapped[Institution | None] = relationship(back_populates="accounts")
    transactions: Mapped[list["Transaction"]] = relationship(back_populates="account")


class BalanceSnapshot(Base):
    __tablename__ = "balance_snapshots"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    balance: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    available_balance: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    as_of: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    captured_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )

    account: Mapped[Account] = relationship()

    __table_args__ = (Index("idx_balance_account_captured", "account_id", "captured_at"),)


class Merchant(Base):
    __tablename__ = "merchants"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name_canonical: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    aliases: Mapped[list | None] = mapped_column(JSONB, nullable=True)


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    parent_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    system_kind: Mapped[str] = mapped_column(String(50), nullable=False)
    color: Mapped[str | None] = mapped_column(String(20), nullable=True)
    icon: Mapped[str | None] = mapped_column(String(50), nullable=True)

    parent: Mapped["Category | None"] = relationship(remote_side=[id])


class Transfer(Base):
    __tablename__ = "transfers"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    txn_out_id: Mapped[str] = mapped_column(ForeignKey("transactions.id"), nullable=False)
    txn_in_id: Mapped[str] = mapped_column(ForeignKey("transactions.id"), nullable=False)
    confidence: Mapped[float] = mapped_column(Numeric(4, 2), nullable=False)
    status: Mapped[str] = mapped_column(String(30), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("txn_out_id", name="uq_transfer_out"),
        UniqueConstraint("txn_in_id", name="uq_transfer_in"),
        CheckConstraint("confidence >= 0 AND confidence <= 1", name="chk_transfer_conf"),
    )


class Transaction(Base):
    __tablename__ = "transactions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    account_id: Mapped[str] = mapped_column(ForeignKey("accounts.id"), nullable=False)
    provider_txn_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    posted_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    amount: Mapped[float] = mapped_column(Numeric(14, 2), nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="USD", nullable=False)
    description_raw: Mapped[str] = mapped_column(Text, nullable=False)
    description_norm: Mapped[str] = mapped_column(Text, nullable=False)
    is_pending: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    pending_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    merchant_id: Mapped[int | None] = mapped_column(ForeignKey("merchants.id"), nullable=True)
    category_id: Mapped[int | None] = mapped_column(ForeignKey("categories.id"), nullable=True)
    transfer_id: Mapped[int | None] = mapped_column(ForeignKey("transfers.id"), nullable=True)
    ingestion_hash: Mapped[str] = mapped_column(String(64), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    manual_category_override: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    account: Mapped[Account] = relationship(back_populates="transactions")
    merchant: Mapped[Merchant | None] = relationship()
    category: Mapped[Category | None] = relationship()

    __table_args__ = (
        UniqueConstraint("account_id", "ingestion_hash", name="uq_txn_ingestion"),
        Index(
            "uq_txn_provider",
            "account_id",
            "provider_txn_id",
            unique=True,
            postgresql_where=provider_txn_id.is_not(None),
        ),
        Index("idx_txn_account_posted", "account_id", "posted_at"),
        Index("idx_txn_category_posted", "category_id", "posted_at"),
        Index("idx_txn_pending_posted", "is_pending", "posted_at"),
    )


class ClassificationRule(Base):
    __tablename__ = "classification_rules"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    match_type: Mapped[str] = mapped_column(String(20), nullable=False)
    pattern: Mapped[str | None] = mapped_column(Text, nullable=True)
    category_id: Mapped[int] = mapped_column(ForeignKey("categories.id"), nullable=False)
    merchant_override_id: Mapped[int | None] = mapped_column(
        ForeignKey("merchants.id"), nullable=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_log"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    action_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_type: Mapped[str] = mapped_column(String(50), nullable=False)
    entity_id: Mapped[str] = mapped_column(String(50), nullable=False)
    before: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    after: Mapped[dict | None] = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AppSetting(Base):
    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(100), primary_key=True)
    value: Mapped[str] = mapped_column(Text, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
