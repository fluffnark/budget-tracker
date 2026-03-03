import logging

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

from app.security import scrub_secrets

logger = logging.getLogger("budget_tracker.request")


class SecretScrubMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        auth_present = bool(request.headers.get("authorization"))
        raw = f"{request.method} {request.url.path}?{request.url.query} auth={auth_present}"
        logger.info(scrub_secrets(raw))
        response = await call_next(request)
        return response
