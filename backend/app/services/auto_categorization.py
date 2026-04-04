from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from difflib import SequenceMatcher

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Account,
    Category,
    ClassificationRule,
    Merchant,
    Transaction,
)
from app.services.rules import _matches

TOKEN_RE = re.compile(r"[A-Z0-9]+")
STOP_TOKENS = {
    "ACH",
    "DEBIT",
    "CARD",
    "PURCHASE",
    "PAYMENT",
    "TRANSFER",
    "ONLINE",
    "WITHDRAWAL",
    "CHECK",
    "POS",
    "DBT",
    "CREDIT",
}
KEYWORD_RULES: list[tuple[list[str], list[str], int | None, float, str]] = [
    (["PAYROLL", "DIRECT DEP", "SALARY"], ["Salary", "Income"], 1, 0.95, "keyword_income"),
    (["MORTGAGE"], ["Mortgage", "Housing"], -1, 0.94, "keyword_mortgage"),
    (
        ["COMCAST", "XFINITY", "INTERNET", "ISP"],
        ["Utilities/Internet", "Utilities"],
        -1,
        0.9,
        "keyword_utilities_internet",
    ),
    (
        ["VERIZON", "AT&T", "TMOBILE", "T-MOBILE"],
        ["Utilities/Mobile", "Utilities"],
        -1,
        0.9,
        "keyword_utilities_mobile",
    ),
    (
        ["PNM", "ELECTRIC", "ENERGY", "POWER"],
        ["Utilities/Electric", "Utilities"],
        -1,
        0.9,
        "keyword_utilities_electric",
    ),
    (
        ["SHELL", "CHEVRON", "EXXON", "MAVERIK", "CIRCLE K", "FUEL", "GAS STATION"],
        ["Fuel", "Transportation"],
        -1,
        0.9,
        "keyword_fuel",
    ),
    (
        [
            "STARBUCKS",
            "MCDONALD",
            "DOORDASH",
            "GRUBHUB",
            "CHIPOTLE",
            "SUBWAY",
            "COFFEE",
            "CAFE",
            "ESPRESSO",
        ],
        ["Dining", "Food"],
        -1,
        0.89,
        "keyword_dining",
    ),
    (
        ["WALMART", "TARGET", "COSTCO", "KROGER", "SMITHS", "SAFEWAY", "ALBERTSONS", "WHOLE FOODS", "TRADER JOE"],
        ["Groceries", "Food"],
        -1,
        0.89,
        "keyword_groceries",
    ),
    (
        ["NETFLIX", "SPOTIFY", "HULU", "DISNEY", "YOUTUBE", "APPLE.COM/BILL"],
        ["Streaming", "Entertainment"],
        -1,
        0.88,
        "keyword_streaming",
    ),
    (
        ["FEE", "OVERDRAFT", "LATE CHARGE", "INTEREST"],
        ["Bank Fees", "Card Interest", "Fees & Interest"],
        None,
        0.88,
        "keyword_fees_interest",
    ),
]
TRANSFER_HINT_TOKENS = [
    "BANKING WITHDRAWAL TRANSFER TO",
    "TRANSFER",
    "XFER",
    "ACH",
    "ONLINE PMT",
    "PAYMENT, THANK YOU",
    "AUTOPAY",
    "OVERDRAFT",
    "VENMO",
    "ZELLE",
    "WEALTHFRONT",
    "VANGUARD",
    "RETIREMENT",
]


@dataclass
class Suggestion:
    transaction_id: str
    suggested_category_id: int
    confidence: float
    reason: str
    category_path: str


@dataclass
class LearnedCategoryModel:
    class_counts: Counter[int]
    token_counts: dict[int, Counter[str]]
    token_totals: dict[int, int]
    vocabulary: set[str]
    known_tokens: set[str]


def _tokenize(text: str) -> Counter[str]:
    return Counter(TOKEN_RE.findall((text or "").upper()))


def _description_key(text: str) -> str:
    return " ".join((text or "").upper().split()[:4])


def _augment_tokens(description: str, merchant_name: str | None, account_type: str | None) -> Counter[str]:
    tokens = _tokenize(description)
    if merchant_name:
        for token, count in _tokenize(merchant_name).items():
            tokens[f"M_{token}"] += count
    account_token = (account_type or "").strip().upper()
    if account_token:
        tokens[f"A_{account_token}"] += 1
    return tokens


def _token_set(text: str) -> set[str]:
    return {token for token in TOKEN_RE.findall((text or "").upper()) if len(token) > 2 and token not in STOP_TOKENS}


def _jaccard(a: set[str], b: set[str]) -> float:
    if not a or not b:
        return 0.0
    union_size = len(a | b)
    if union_size == 0:
        return 0.0
    return len(a & b) / union_size


def _text_similarity(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.upper(), b.upper()).ratio()


def _clamp_confidence(value: float) -> float:
    return round(max(0.0, min(1.0, value)), 3)


def _logsumexp(values: list[float]) -> float:
    if not values:
        return 0.0
    max_value = max(values)
    if math.isinf(max_value):
        return max_value
    return max_value + math.log(sum(math.exp(value - max_value) for value in values))


def _category_paths(db: Session) -> dict[int, str]:
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


def _category_name_index(db: Session) -> dict[str, int]:
    categories = list(db.execute(select(Category).order_by(Category.id.asc())).scalars())
    out: dict[str, int] = {}
    for category in categories:
        out[category.name.upper()] = category.id
    return out


def _keyword_suggestion(
    *,
    description: str,
    direction: int,
    category_name_index: dict[str, int],
) -> tuple[int, float, str] | None:
    desc_upper = (description or "").upper()
    for keywords, category_names, rule_direction, confidence, reason in KEYWORD_RULES:
        if rule_direction is not None and rule_direction != direction:
            continue
        if not any(token in desc_upper for token in keywords):
            continue
        for name in category_names:
            category_id = category_name_index.get(name.upper())
            if category_id is not None:
                return category_id, confidence, reason
    return None


def _transfer_suggestion(
    *,
    description: str,
    category_name_index: dict[str, int],
) -> tuple[int, float, str] | None:
    desc_upper = (description or "").upper()
    if not any(token in desc_upper for token in TRANSFER_HINT_TOKENS):
        return None
    transfer_category_id = category_name_index.get("TRANSFERS/INTERNAL")
    if transfer_category_id is None:
        transfer_category_id = category_name_index.get("TRANSFERS")
    if transfer_category_id is None:
        return None
    return transfer_category_id, 0.84, "transfer_pattern"


def _active_rules(db: Session) -> list[ClassificationRule]:
    return list(
        db.execute(
            select(ClassificationRule)
            .where(ClassificationRule.is_active.is_(True))
            .order_by(ClassificationRule.priority.asc(), ClassificationRule.id.asc())
        ).scalars()
    )


def _build_learned_models(
    corpus_rows: list[tuple[Transaction, str | None]],
    *,
    min_examples_per_category: int = 2,
) -> dict[int, LearnedCategoryModel]:
    by_direction_rows: dict[int, list[tuple[Transaction, str | None]]] = defaultdict(list)
    for txn, merchant_name in corpus_rows:
        direction = -1 if float(txn.amount) < 0 else 1
        by_direction_rows[direction].append((txn, merchant_name))

    out: dict[int, LearnedCategoryModel] = {}
    for direction, rows in by_direction_rows.items():
        class_counts: Counter[int] = Counter()
        token_counts: dict[int, Counter[str]] = defaultdict(Counter)
        token_totals: dict[int, int] = defaultdict(int)
        vocabulary: set[str] = set()
        known_tokens: set[str] = set()

        for txn, merchant_name in rows:
            if txn.category_id is None:
                continue
            class_counts[txn.category_id] += 1
            tokens = _augment_tokens(
                txn.description_norm or "",
                merchant_name=merchant_name,
                account_type=txn.account.type if txn.account else None,
            )
            if not tokens:
                continue
            token_counts[txn.category_id].update(tokens)
            token_totals[txn.category_id] += int(sum(tokens.values()))
            vocabulary.update(tokens.keys())
            known_tokens.update(tokens.keys())

        # Keep only categories with enough support.
        keep_categories = {
            category_id
            for category_id, count in class_counts.items()
            if count >= min_examples_per_category
        }
        if not keep_categories or not vocabulary:
            continue

        class_counts = Counter(
            {category_id: count for category_id, count in class_counts.items() if category_id in keep_categories}
        )
        token_counts = {
            category_id: counts
            for category_id, counts in token_counts.items()
            if category_id in keep_categories
        }
        token_totals = {
            category_id: total
            for category_id, total in token_totals.items()
            if category_id in keep_categories
        }

        out[direction] = LearnedCategoryModel(
            class_counts=class_counts,
            token_counts=token_counts,
            token_totals=token_totals,
            vocabulary=vocabulary,
            known_tokens=known_tokens,
        )

    return out


def _predict_with_learned_model(
    *,
    model: LearnedCategoryModel | None,
    description: str,
    merchant_name: str | None,
    account_type: str | None,
) -> tuple[int, float] | None:
    if model is None:
        return None
    if not model.class_counts or not model.vocabulary:
        return None

    features = _augment_tokens(description, merchant_name=merchant_name, account_type=account_type)
    if not features:
        return None
    overlap = len(set(features.keys()) & model.known_tokens)
    if overlap < 2:
        return None

    alpha = 1.0
    total_classes = sum(model.class_counts.values())
    vocab_size = max(1, len(model.vocabulary))

    category_scores: dict[int, float] = {}
    for category_id, class_count in model.class_counts.items():
        prior = math.log(class_count / total_classes)
        token_total = model.token_totals.get(category_id, 0)
        denom = token_total + alpha * vocab_size
        score = prior
        token_profile = model.token_counts.get(category_id, Counter())
        for token, count in features.items():
            likelihood = (token_profile.get(token, 0) + alpha) / denom
            score += count * math.log(likelihood)
        category_scores[category_id] = score

    if not category_scores:
        return None
    best_category, best_score = max(category_scores.items(), key=lambda item: item[1])
    normalizer = _logsumexp(list(category_scores.values()))
    top_prob = math.exp(best_score - normalizer)
    if top_prob < 0.62:
        return None
    return best_category, _clamp_confidence(top_prob)


def suggest_for_range(
    db: Session,
    *,
    start: date,
    end: date,
    account_ids: list[str] | None = None,
    include_pending: bool = True,
    include_transfers: bool = False,
    max_suggestions: int = 200,
) -> list[Suggestion]:
    max_suggestions = max(1, min(max_suggestions, 1000))
    path_map = _category_paths(db)
    category_name_index = _category_name_index(db)

    base_where = [
        Transaction.posted_at >= datetime.combine(start, datetime.min.time(), tzinfo=UTC),
        Transaction.posted_at
        < datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC),
    ]
    if account_ids:
        base_where.append(Transaction.account_id.in_(account_ids))
    if not include_pending:
        base_where.append(Transaction.is_pending.is_(False))
    if not include_transfers:
        base_where.append(Transaction.transfer_id.is_(None))

    uncategorized_rows = db.execute(
        select(Transaction, Account.type, Merchant.name_canonical)
        .join(Account, Account.id == Transaction.account_id)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .outerjoin(Merchant, Merchant.id == Transaction.merchant_id)
        .where(
            and_(
                *base_where,
                or_(
                    Transaction.category_id.is_(None),
                    Category.system_kind == "uncategorized",
                ),
                Transaction.manual_category_override.is_(False),
            )
        )
        .order_by(Transaction.posted_at.desc())
        .limit(max_suggestions)
    ).all()

    if not uncategorized_rows:
        return []

    corpus_rows = db.execute(
        select(Transaction, Merchant.name_canonical, Account.type)
        .join(Account, Account.id == Transaction.account_id)
        .outerjoin(Category, Category.id == Transaction.category_id)
        .outerjoin(Merchant, Merchant.id == Transaction.merchant_id)
        .where(
            and_(
                Transaction.category_id.is_not(None),
                Category.system_kind != "uncategorized",
                Transaction.manual_category_override.is_(False),
                Transaction.posted_at
                >= datetime.combine(start - timedelta(days=365), datetime.min.time(), tzinfo=UTC),
                Transaction.posted_at
                < datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=UTC),
            )
        )
        .order_by(Transaction.posted_at.desc())
        .limit(10000)
    ).all()

    merchant_counts: dict[tuple[str, int], Counter[int]] = defaultdict(Counter)
    description_counts: dict[tuple[str, int], Counter[int]] = defaultdict(Counter)
    nearest_examples: list[tuple[int, int, str, str | None, str | None, set[str]]] = []
    learned_models = _build_learned_models(
        [(txn, merchant_name) for txn, merchant_name, _account_type in corpus_rows]
    )

    for txn, merchant_name, account_type in corpus_rows:
        if txn.category_id is None:
            continue
        direction = -1 if float(txn.amount) < 0 else 1
        if merchant_name:
            merchant_counts[(merchant_name.upper(), direction)][txn.category_id] += 1
        desc_key = _description_key(txn.description_norm or "")
        if desc_key:
            description_counts[(desc_key, direction)][txn.category_id] += 1
        token_set = _token_set(txn.description_norm or "")
        if token_set:
            nearest_examples.append(
                (
                    txn.category_id,
                    direction,
                    txn.description_norm or "",
                    merchant_name.upper() if merchant_name else None,
                    account_type.upper() if account_type else None,
                    token_set,
                )
            )

    corpus_size = len(corpus_rows)
    active_rules = _active_rules(db)
    out: list[Suggestion] = []

    for txn, account_type, merchant_name in uncategorized_rows:
        suggested_id: int | None = None
        confidence = 0.0
        reason = ""
        desc_norm = txn.description_norm or ""
        account_norm = (account_type or "").upper()
        txn_direction = -1 if float(txn.amount) < 0 else 1

        for rule in active_rules:
            if _matches(rule.match_type, rule.pattern, desc_norm, account_norm):
                suggested_id = rule.category_id
                confidence = 0.99
                reason = f"rule_match:{rule.match_type}"
                break

        if suggested_id is None:
            transfer_pick = _transfer_suggestion(
                description=desc_norm,
                category_name_index=category_name_index,
            )
            if transfer_pick is not None:
                suggested_id, confidence, reason = transfer_pick

        if suggested_id is None:
            keyword_pick = _keyword_suggestion(
                description=desc_norm,
                direction=txn_direction,
                category_name_index=category_name_index,
            )
            if keyword_pick is not None:
                suggested_id, confidence, reason = keyword_pick

        if suggested_id is None:
            learned_pick = _predict_with_learned_model(
                model=learned_models.get(txn_direction),
                description=desc_norm,
                merchant_name=merchant_name,
                account_type=account_type,
            )
            if learned_pick is not None:
                suggested_id, confidence = learned_pick
                reason = "learned_nb"

        if suggested_id is None and merchant_name:
            counts = merchant_counts.get((merchant_name.upper(), txn_direction))
            if counts:
                top_id, top_count = counts.most_common(1)[0]
                total = sum(counts.values())
                ratio = top_count / max(total, 1)
                if total >= 2 and ratio >= 0.7:
                    suggested_id = top_id
                    confidence = min(0.97, 0.7 + ratio * 0.25)
                    reason = f"merchant_history:{merchant_name}"

        if suggested_id is None:
            desc_key = _description_key(desc_norm)
            counts = description_counts.get((desc_key, txn_direction))
            if counts:
                top_id, top_count = counts.most_common(1)[0]
                total = sum(counts.values())
                ratio = top_count / max(total, 1)
                if total >= 2 and ratio >= 0.65:
                    suggested_id = top_id
                    confidence = min(0.94, 0.65 + ratio * 0.2)
                    reason = "description_history"

        if suggested_id is None and corpus_size >= 5:
            candidate_tokens = _token_set(desc_norm)
            if candidate_tokens:
                scored_by_category: dict[int, list[float]] = defaultdict(list)
                for (
                    hist_category_id,
                    hist_direction,
                    hist_description,
                    hist_merchant_upper,
                    hist_account_upper,
                    hist_tokens,
                ) in nearest_examples:
                    if hist_direction != txn_direction:
                        continue
                    token_sim = _jaccard(candidate_tokens, hist_tokens)
                    if token_sim < 0.22:
                        continue
                    desc_sim = _text_similarity(desc_norm, hist_description)
                    merchant_bonus = (
                        0.15
                        if merchant_name and hist_merchant_upper and merchant_name.upper() == hist_merchant_upper
                        else 0.0
                    )
                    account_bonus = (
                        0.05
                        if account_type and hist_account_upper and account_type.upper() == hist_account_upper
                        else 0.0
                    )
                    neighbor_score = (0.62 * token_sim) + (0.33 * desc_sim) + merchant_bonus + account_bonus
                    if neighbor_score >= 0.5:
                        scored_by_category[hist_category_id].append(neighbor_score)

                if scored_by_category:
                    ranked = sorted(
                        (
                            (
                                category_id,
                                sum(sorted(scores, reverse=True)[:3])
                                / max(1, len(sorted(scores, reverse=True)[:3])),
                                len(scores),
                            )
                            for category_id, scores in scored_by_category.items()
                        ),
                        key=lambda item: item[1],
                        reverse=True,
                    )
                    best_category, best_score, support_count = ranked[0]
                    second_score = ranked[1][1] if len(ranked) > 1 else 0.0
                    if (
                        support_count >= 2
                        and best_score >= 0.72
                        and (best_score - second_score) >= 0.06
                    ):
                        suggested_id = best_category
                        confidence = _clamp_confidence(min(0.92, 0.55 + (best_score * 0.45)))
                        reason = "nearest_neighbor_similarity"

        if suggested_id is None:
            continue

        out.append(
            Suggestion(
                transaction_id=txn.id,
                suggested_category_id=suggested_id,
                confidence=_clamp_confidence(confidence),
                reason=reason,
                category_path=path_map.get(suggested_id, str(suggested_id)),
            )
        )

    out.sort(key=lambda row: row.confidence, reverse=True)
    return out[:max_suggestions]


def apply_suggestions(
    db: Session,
    *,
    suggestions: list[dict],
    min_confidence: float = 0.85,
    include_pending: bool = True,
    allow_transfers: bool = False,
    dry_run: bool = False,
) -> tuple[int, int, dict[str, int]]:
    applied = 0
    skipped = 0
    reasons: dict[str, int] = defaultdict(int)

    if not suggestions:
        return 0, 0, {}

    category_ids = {int(item["suggested_category_id"]) for item in suggestions}
    uncategorized_ids = set(
        db.execute(select(Category.id).where(Category.system_kind == "uncategorized")).scalars()
    )
    existing_category_ids = set(
        db.execute(select(Category.id).where(Category.id.in_(category_ids))).scalars()
    )

    tx_ids = [str(item["transaction_id"]) for item in suggestions]
    tx_rows = db.execute(
        select(Transaction).where(Transaction.id.in_(tx_ids)).with_for_update()
    ).scalars()
    tx_by_id = {row.id: row for row in tx_rows}

    for item in suggestions:
        txn_id = str(item["transaction_id"])
        suggested_id = int(item["suggested_category_id"])
        confidence = float(item.get("confidence", 1.0))

        if confidence < min_confidence:
            skipped += 1
            reasons["below_confidence_threshold"] += 1
            continue

        txn = tx_by_id.get(txn_id)
        if txn is None:
            skipped += 1
            reasons["transaction_not_found"] += 1
            continue
        if txn.manual_category_override:
            skipped += 1
            reasons["manual_override"] += 1
            continue
        if txn.transfer_id is not None and not allow_transfers:
            skipped += 1
            reasons["transfer_skipped"] += 1
            continue
        if txn.is_pending and not include_pending:
            skipped += 1
            reasons["pending_skipped"] += 1
            continue
        if txn.category_id is not None and txn.category_id not in uncategorized_ids:
            skipped += 1
            reasons["already_categorized"] += 1
            continue
        if suggested_id not in existing_category_ids:
            skipped += 1
            reasons["invalid_category"] += 1
            continue

        applied += 1
        if not dry_run:
            txn.category_id = suggested_id

    if applied and not dry_run:
        db.commit()

    return applied, skipped, dict(reasons)
