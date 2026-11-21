# ---------------------------------------------------------
# auth.py: everything about logging in.
#   1. Passwords: "blend" them (hash) so we never store the real one.
#   2. Tokens: the "wristband" you get at login (a signed JWT).
#   3. get_current_user: the bouncer every private route uses.
# ---------------------------------------------------------
import os
from datetime import datetime, timedelta, timezone

import bcrypt                                   # the password blender
import jwt                                      # PyJWT: makes and checks tokens
from fastapi import Depends, HTTPException
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from database import get_db
from models import User


# --- The secret key: signs every token. Lives in .env (never on GitHub). ---
# Tiny .env reader: each line looks like NAME=value.
def _read_env_file(path=".env"):
    if os.path.exists(path):
        with open(path) as f:                   # with: opens the file and closes it when done
            for line in f:
                if "=" in line and not line.startswith("#"):
                    name, value = line.strip().split("=", 1)   # split at the FIRST "=" only
                    os.environ.setdefault(name, value)         # setdefault: don't overwrite a real env var

_read_env_file()
SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("SECRET_KEY is missing. Add SECRET_KEY=... to the .env file.")

ALGORITHM = "HS256"                 # the signing method (standard, simple)
TOKEN_LIFETIME = timedelta(days=1)  # the wristband stops working after 1 day → log in again


# --- 1. Passwords ---

# hash_password: "mypassword123" → "$2b$12$Xk9..." (can't be turned back)
def hash_password(password: str) -> str:
    # gensalt() adds a random "pinch of salt", so two people with the SAME
    # password still get DIFFERENT hashes.
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()
    # .encode(): text → bytes (bcrypt works on bytes); .decode(): bytes → text (to store it)


# verify_password: blend what was typed and see if it matches the saved hash.
def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode(), hashed.encode())


# --- 2. Tokens (the wristband) ---

# create_token: make a signed wristband saying "this is user <id>", valid for 1 day.
# "ver" = the user's token_version. A password reset adds 1 to it, so every
# wristband made BEFORE the reset stops working (= "logs out other sessions").
def create_token(user: User) -> str:
    expires = datetime.now(timezone.utc) + TOKEN_LIFETIME
    payload = {"sub": str(user.id), "ver": user.token_version, "exp": expires}   # sub = who it's for; exp = expiry
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


# --- 3. The bouncer ---

# OAuth2PasswordBearer: tells FastAPI "tokens come in the Authorization header,
# and you get one from POST /login". It also adds the 🔒 Authorize button to /docs.
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="login")

# The ONE error for every bad wristband (fake, expired, user deleted...).
# 401 = "who are you? log in first".
NOT_LOGGED_IN = HTTPException(
    status_code=401,
    detail="Not logged in (or your login expired)",
    headers={"WWW-Authenticate": "Bearer"},
)


# get_current_user: put `user: User = Depends(get_current_user)` on a route,
# and that route only runs for someone with a valid wristband. You get their User row.
def get_current_user(token: str = Depends(oauth2_scheme), db: Session = Depends(get_db)) -> User:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])   # checks signature AND expiry
        user_id = int(payload["sub"])
        version = int(payload.get("ver", 0))         # old tokens (before versions existed) count as 0
    except (jwt.PyJWTError, KeyError, ValueError):   # fake / expired / broken token
        raise NOT_LOGGED_IN
    user = db.get(User, user_id)
    if user is None or user.token_version != version:   # user gone, OR password was reset since this login
        raise NOT_LOGGED_IN
    return user


# --- 4. Continue with Google ---

GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID")   # from Google Cloud Console; put it in .env


# verify_google_token: ask Google's library "is this ID token real, for OUR app, and is the
# email verified?" Returns Google's info about the person, or None if anything is wrong.
def verify_google_token(token: str) -> dict | None:
    if not GOOGLE_CLIENT_ID:
        return None                                  # Google login isn't set up yet
    try:
        from google.oauth2 import id_token           # imported here so the app still runs without it
        from google.auth.transport import requests as google_requests
        info = id_token.verify_oauth2_token(token, google_requests.Request(), GOOGLE_CLIENT_ID)
    except Exception:                                # bad / expired / wrong app / no internet...
        return None
    if not info.get("email_verified"):
        return None
    return info


# --- 5. Password reset links ---

# make_reset_token: a long random secret for the email link. We only store its HASH,
# so even someone who reads the database can't use the links.
def make_reset_token() -> tuple[str, str]:
    import secrets, hashlib
    token = secrets.token_urlsafe(32)
    return token, hashlib.sha256(token.encode()).hexdigest()


def hash_reset_token(token: str) -> str:
    import hashlib
    return hashlib.sha256(token.encode()).hexdigest()
