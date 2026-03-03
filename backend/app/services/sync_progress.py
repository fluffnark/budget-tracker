from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime
from threading import Lock
from typing import Any


@dataclass
class SyncProgressState:
    running: bool = False
    mode: str | None = None
    current_window: int = 0
    total_windows: int = 0
    progress: float = 0.0
    message: str = "idle"
    started_at: datetime | None = None
    updated_at: datetime | None = None
    finished_at: datetime | None = None
    last_error: str | None = None
    last_result: dict[str, Any] = field(default_factory=dict)


_lock = Lock()
_state = SyncProgressState()


def _now() -> datetime:
    return datetime.now(UTC)


def start(*, mode: str) -> None:
    now = _now()
    with _lock:
        _state.running = True
        _state.mode = mode
        _state.current_window = 0
        _state.total_windows = 0
        _state.progress = 0.0
        _state.message = "starting"
        _state.started_at = now
        _state.updated_at = now
        _state.finished_at = None
        _state.last_error = None
        _state.last_result = {}


def update(*, current_window: int, total_windows: int, message: str) -> None:
    now = _now()
    total = max(0, total_windows)
    current = max(0, min(current_window, total if total else current_window))
    progress = 0.0 if total <= 0 else round(current / total, 4)
    with _lock:
        _state.current_window = current
        _state.total_windows = total
        _state.progress = progress
        _state.message = message
        _state.updated_at = now


def complete(*, result: dict[str, Any]) -> None:
    now = _now()
    with _lock:
        _state.running = False
        _state.progress = 1.0
        _state.message = "completed"
        _state.finished_at = now
        _state.updated_at = now
        _state.last_result = result


def fail(*, error: str) -> None:
    now = _now()
    with _lock:
        _state.running = False
        _state.message = "failed"
        _state.finished_at = now
        _state.updated_at = now
        _state.last_error = error


def snapshot() -> dict[str, Any]:
    with _lock:
        return {
            "running": _state.running,
            "mode": _state.mode,
            "current_window": _state.current_window,
            "total_windows": _state.total_windows,
            "progress": _state.progress,
            "message": _state.message,
            "started_at": _state.started_at.isoformat() if _state.started_at else None,
            "updated_at": _state.updated_at.isoformat() if _state.updated_at else None,
            "finished_at": _state.finished_at.isoformat() if _state.finished_at else None,
            "last_error": _state.last_error,
            "last_result": _state.last_result,
        }
