"""Future categorization suggestion service.

This module intentionally ships with a stubbed implementation in v1.
See docs/ML_CATEGORIZATION.md for planned feature extraction and model strategy.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy.orm import Session


def suggest_categories(
    db: Session,
    *,
    start: date,
    end: date,
) -> list[dict[str, Any]]:
    """Return future ML/clustering suggestions.

    TODO(v2): return ranked suggestions with confidence and explanation fields.
    """
    _ = db, start, end
    return []
