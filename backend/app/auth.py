"""Per-user email + bcrypt password — stop-gap auth before Azure Entra.

Security model (deliberately minimal):
- Login takes email + password. Password is bcrypt-verified against the
  hash stored in approved_users.password_hash.
- Bootstrap: on first startup (if approved_users is empty), each email in
  INITIAL_ADMIN_EMAILS is seeded as 'admin' with INITIAL_ADMIN_PASSWORD.
  Users can change their password via /api/auth/change-password.
- The backend itself is *not* gated — anyone reaching the API directly can
  hit it. The actual security is VPN-only network access; this layer is
  named-user accountability + nice UX. When Entra lands, the login flow
  swaps to OAuth and the rest of the app stays put.

Login error messages are deliberately generic ("invalid email or password")
so an attacker can't enumerate which emails are on the allowlist.
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from passlib.context import CryptContext
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_app_db
from app.models import ApprovedUser

router = APIRouter(tags=["auth"])

_pw = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(plain: str) -> str:
    return _pw.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _pw.verify(plain, hashed)
    except Exception:
        return False


# ---------------------------------------------------------------------------
# Bootstrap — seed approved_users from INITIAL_ADMIN_EMAILS if empty
# ---------------------------------------------------------------------------

def bootstrap_admin_emails(adb: Session) -> int:
    """Seed approved_users from settings.INITIAL_ADMIN_EMAILS if the table
    is empty. Returns the number of rows inserted (0 if already populated)."""
    if adb.query(ApprovedUser).count() > 0:
        return 0

    raw = (settings.INITIAL_ADMIN_EMAILS or "").strip()
    if not raw:
        return 0

    initial_pw_hash = hash_password(settings.INITIAL_ADMIN_PASSWORD or "Dalux")
    inserted = 0
    for email in (e.strip().lower() for e in raw.split(",")):
        if "@" not in email:
            continue
        adb.add(ApprovedUser(
            email=email,
            name=_default_name_from_email(email),
            password_hash=initial_pw_hash,
            role="admin",
            added_by=None,  # bootstrap entries
            active=1,
        ))
        inserted += 1
    if inserted:
        adb.commit()
    return inserted


def _default_name_from_email(email: str) -> str:
    """'neil.white@thespencergroup.co.uk' → 'Neil White'."""
    local = email.split("@")[0]
    parts = local.replace("_", ".").replace("-", ".").split(".")
    return " ".join(p.capitalize() for p in parts if p) or email


# ---------------------------------------------------------------------------
# Login / me / change-password
# ---------------------------------------------------------------------------

class _LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=200)


class _UserOut(BaseModel):
    email: str
    name: Optional[str]
    role: str


class _LoginOk(BaseModel):
    user: _UserOut


@router.post("/api/auth/login", response_model=_LoginOk)
def login(req: _LoginRequest, adb: Session = Depends(get_app_db)):
    email = req.email.strip().lower()
    user = adb.query(ApprovedUser).filter(ApprovedUser.email == email).first()
    if user is None or not user.active:
        # Generic error — don't tell attackers whether the email exists
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password")

    user.last_login_at = datetime.utcnow()
    adb.commit()
    return _LoginOk(user=_UserOut(email=user.email, name=user.name, role=user.role))


@router.get("/api/auth/me", response_model=_UserOut)
def me(email: str, adb: Session = Depends(get_app_db)):
    """Lookup-only — confirms a stored email is still on the active list.
    Frontend calls this on app load to validate cached sessions; does NOT
    re-check password (that's the login screen's job)."""
    u = adb.query(ApprovedUser).filter(ApprovedUser.email == email.strip().lower()).first()
    if u is None or not u.active:
        raise HTTPException(status_code=401, detail="Not an approved user")
    return _UserOut(email=u.email, name=u.name, role=u.role)


class _ChangePasswordRequest(BaseModel):
    email: EmailStr
    current_password: str = Field(min_length=1, max_length=200)
    new_password: str = Field(min_length=4, max_length=200)


@router.post("/api/auth/change-password")
def change_password(req: _ChangePasswordRequest, adb: Session = Depends(get_app_db)):
    """User changes their own password. Requires the current one."""
    email = req.email.strip().lower()
    u = adb.query(ApprovedUser).filter(ApprovedUser.email == email).first()
    if u is None or not u.active:
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(req.current_password, u.password_hash):
        raise HTTPException(status_code=401, detail="Current password is wrong")
    if req.new_password == req.current_password:
        raise HTTPException(status_code=400, detail="New password must differ from the current one")

    u.password_hash = hash_password(req.new_password)
    adb.commit()
    return {"changed": True}


# ---------------------------------------------------------------------------
# Admin user management — /api/admin/users
# ---------------------------------------------------------------------------

class _UserRow(BaseModel):
    email: str
    name: Optional[str]
    role: str
    active: bool
    added_at: Optional[datetime]
    added_by: Optional[str]
    last_login_at: Optional[datetime]


class _AddUserRequest(BaseModel):
    email: EmailStr
    name: Optional[str] = None
    role: str = "user"
    initial_password: str = Field(min_length=4, max_length=200)
    added_by: Optional[str] = None


class _UpdateUserRequest(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None


class _AdminResetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=4, max_length=200)


def _row(u: ApprovedUser) -> _UserRow:
    return _UserRow(
        email=u.email, name=u.name, role=u.role, active=bool(u.active),
        added_at=u.added_at, added_by=u.added_by, last_login_at=u.last_login_at,
    )


@router.get("/api/admin/users", response_model=list[_UserRow])
def list_users(adb: Session = Depends(get_app_db)):
    rows = adb.query(ApprovedUser).order_by(ApprovedUser.email).all()
    return [_row(u) for u in rows]


@router.post("/api/admin/users", response_model=_UserRow)
def add_user(req: _AddUserRequest, adb: Session = Depends(get_app_db)):
    email = req.email.strip().lower()
    if req.role not in ("admin", "user"):
        raise HTTPException(400, "role must be 'admin' or 'user'")
    if adb.query(ApprovedUser).filter(ApprovedUser.email == email).first():
        raise HTTPException(409, f"{email} already exists")
    u = ApprovedUser(
        email=email,
        name=(req.name or "").strip() or _default_name_from_email(email),
        password_hash=hash_password(req.initial_password),
        role=req.role,
        added_by=req.added_by,
        active=1,
    )
    adb.add(u)
    adb.commit()
    adb.refresh(u)
    return _row(u)


@router.patch("/api/admin/users/{email}", response_model=_UserRow)
def update_user(email: str, req: _UpdateUserRequest, adb: Session = Depends(get_app_db)):
    email_norm = email.strip().lower()
    u = adb.query(ApprovedUser).filter(ApprovedUser.email == email_norm).first()
    if u is None:
        raise HTTPException(404, f"{email_norm} not found")
    if req.role is not None:
        if req.role not in ("admin", "user"):
            raise HTTPException(400, "role must be 'admin' or 'user'")
        u.role = req.role
    if req.name is not None:
        u.name = req.name.strip() or u.name
    if req.active is not None:
        u.active = 1 if req.active else 0
    adb.commit()
    adb.refresh(u)
    return _row(u)


@router.post("/api/admin/users/{email}/reset-password")
def admin_reset_password(email: str, req: _AdminResetPasswordRequest, adb: Session = Depends(get_app_db)):
    """Admin force-resets a user's password (e.g. they forgot it). The user
    can change it again via /api/auth/change-password after they log in."""
    email_norm = email.strip().lower()
    u = adb.query(ApprovedUser).filter(ApprovedUser.email == email_norm).first()
    if u is None:
        raise HTTPException(404, f"{email_norm} not found")
    u.password_hash = hash_password(req.new_password)
    adb.commit()
    return {"reset": True, "email": email_norm}


@router.delete("/api/admin/users/{email}")
def delete_user(email: str, adb: Session = Depends(get_app_db)):
    email_norm = email.strip().lower()
    u = adb.query(ApprovedUser).filter(ApprovedUser.email == email_norm).first()
    if u is None:
        raise HTTPException(404, f"{email_norm} not found")
    adb.delete(u)
    adb.commit()
    return {"deleted": email_norm}
