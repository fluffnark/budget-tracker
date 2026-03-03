from fastapi import Cookie, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Owner
from app.security import read_session_cookie


def get_current_owner(
    session: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> Owner:
    if not session:
        raise HTTPException(status_code=401, detail="Not authenticated")
    owner_id = read_session_cookie(session)
    if not owner_id:
        raise HTTPException(status_code=401, detail="Invalid session")
    owner = db.execute(select(Owner).where(Owner.id == owner_id)).scalar_one_or_none()
    if not owner:
        raise HTTPException(status_code=401, detail="Owner not found")
    return owner
