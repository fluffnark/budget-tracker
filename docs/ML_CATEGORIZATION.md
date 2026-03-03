# ML Categorization (Future Design)

## Scope
This document defines the v2 direction for category suggestions. v1 only ships API stubs and does not train or run heavy ML models.

## Feature Extraction
- `description_norm` token features (word n-grams, merchant-like tokens, payment keywords).
- Amount buckets (`<10`, `10-50`, `50-200`, `200+`) and sign.
- Merchant canonical id/hash when available.
- Account type (`checking`, `credit_card`, etc.).
- Day-of-month and day-of-week signals for recurring transactions.

## Candidate Approaches
1. Clustering:
- TF-IDF vectors over `description_norm`.
- Add numeric side-features (amount bucket + account type).
- Start with k-means baseline, evaluate HDBSCAN for irregular density.

2. Semi-supervised labeling:
- Use existing manually categorized transactions as labels.
- Train a lightweight classifier (logistic regression or gradient boosting).
- Blend classifier score with cluster priors and merchant history.

## Human-in-the-Loop UX
- Suggestions page shows candidate category, confidence, and why.
- User can accept/reject in bulk.
- Accepted suggestions optionally emit deterministic rules for future imports.

## Safety and Rollout
- Never overwrite manual category overrides automatically.
- Gate behind feature flag (`CATEGORIZATION_SUGGESTIONS`).
- Log only aggregate diagnostics; avoid storing sensitive raw payloads.
