"""
Local authentication: registration, login, and password reset.

Security decisions, ready to explain in a viva:
  * Passwords are stored only as salted PBKDF2-SHA256 hashes (600,000 iterations). A hash is
    one-way: login re-hashes the attempt and compares, so the password itself is never stored.
  * Login gives the same message for an unknown email and a wrong password, and checks a dummy
    hash for unknown emails, so an attacker cannot use responses to discover who has an account.
  * Repeated failures lock an email and address pair for a few minutes.
  * Reset tokens are random, single-use and expire. Only their SHA-256 hash is stored, so reading
    the database does not give anyone a usable reset link.
  * A reset raises Session_Epoch, which signs out sessions started before it.
"""
import datetime as dt
import hashlib
import logging
import re
import secrets
import threading
import time

from sqlalchemy.exc import IntegrityError
from werkzeug.security import check_password_hash, generate_password_hash

from db.connection import execute, one
from errors import ApiError

HASH_METHOD = "pbkdf2:sha256:600000"
_DUMMY_HASH = generate_password_hash("not-a-real-password", method=HASH_METHOD)
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
RESET_MINUTES = 30
MAX_FAILURES = 5
LOCK_SECONDS = 300

_failures = {}
_failures_lock = threading.Lock()
log = logging.getLogger("retailiq.auth")


def password_problems(password):
    problems = []
    if len(password) < 8:
        problems.append("at least 8 characters")
    if not re.search(r"[A-Z]", password):
        problems.append("an uppercase letter")
    if not re.search(r"[a-z]", password):
        problems.append("a lowercase letter")
    if not re.search(r"\d", password):
        problems.append("a number")
    return problems


def _require_valid_password(password):
    problems = password_problems(password or "")
    if problems:
        raise ApiError("Password needs " + ", ".join(problems) + ".", code="weak_password")


def _clean_email(email):
    return (email or "").strip().lower()


def register(name, email, password):
    name = (name or "").strip()
    email = _clean_email(email)
    if len(name) < 2:
        raise ApiError("Enter your full name.", code="invalid_name")
    if not EMAIL_RE.match(email) or len(email) > 255:
        raise ApiError("Enter a valid email address.", code="invalid_email")
    _require_valid_password(password)
    try:
        execute(
            "INSERT INTO USERS (Name, Email, Password_Hash, Created_At) VALUES (:n, :e, :h, :t)",
            {"n": name[:120], "e": email, "h": generate_password_hash(password, method=HASH_METHOD), "t": dt.datetime.now()},
        )
    except IntegrityError:
        raise ApiError("An account with this email already exists. Sign in instead.", status=409, code="email_taken")
    return get_user_by_email(email)


def get_user_by_email(email):
    return one("SELECT * FROM USERS WHERE Email = :e", {"e": _clean_email(email)})


def get_user(user_id):
    return one("SELECT * FROM USERS WHERE User_ID = :i", {"i": user_id})


def _check_lock(key):
    with _failures_lock:
        count, until = _failures.get(key, (0, 0))
        if until > time.time():
            minutes = max(1, round((until - time.time()) / 60))
            raise ApiError(f"Too many failed attempts. Try again in about {minutes} minute(s).", status=429, code="locked")


def _note_failure(key):
    with _failures_lock:
        count, _ = _failures.get(key, (0, 0))
        count += 1
        _failures[key] = (0, time.time() + LOCK_SECONDS) if count >= MAX_FAILURES else (count, 0)


def login(email, password, address):
    key = (_clean_email(email), address)
    _check_lock(key)
    user = get_user_by_email(email)
    # The dummy check keeps timing the same whether or not the account exists.
    valid = check_password_hash(user["Password_Hash"] if user else _DUMMY_HASH, password or "")
    if not user or not valid:
        _note_failure(key)
        raise ApiError("Incorrect email or password.", status=401, code="invalid_credentials")
    with _failures_lock:
        _failures.pop(key, None)
    return user


def request_reset(email):
    """
    Create a reset token. This local install has no email service, so the link goes to the API
    server's log. A deployment would send it by email from this same place.
    """
    user = get_user_by_email(email)
    if not user:
        return
    token = secrets.token_urlsafe(32)
    execute("DELETE FROM PASSWORD_RESETS WHERE User_ID = :u", {"u": user["User_ID"]})
    execute(
        "INSERT INTO PASSWORD_RESETS (Token_Hash, User_ID, Expires_At) VALUES (:h, :u, :x)",
        {"h": hashlib.sha256(token.encode()).hexdigest(), "u": user["User_ID"],
         "x": dt.datetime.now() + dt.timedelta(minutes=RESET_MINUTES)},
    )
    log.warning("Password reset link for %s (valid %d minutes): http://localhost:5173/reset-password?token=%s",
                user["Email"], RESET_MINUTES, token)


def reset_password(token, password):
    _require_valid_password(password)
    token_hash = hashlib.sha256((token or "").encode()).hexdigest()
    row = one("SELECT * FROM PASSWORD_RESETS WHERE Token_Hash = :h", {"h": token_hash})
    if not row or dt.datetime.fromisoformat(row["Expires_At"]) < dt.datetime.now():
        raise ApiError("This reset link is invalid or has expired. Request a new one.", code="invalid_token")
    execute(
        "UPDATE USERS SET Password_Hash = :p, Session_Epoch = Session_Epoch + 1 WHERE User_ID = :u",
        {"p": generate_password_hash(password, method=HASH_METHOD), "u": row["User_ID"]},
    )
    execute("DELETE FROM PASSWORD_RESETS WHERE User_ID = :u", {"u": row["User_ID"]})


def update_profile(user_id, name):
    name = (name or "").strip()
    if len(name) < 2:
        raise ApiError("Enter your full name.", code="invalid_name")
    execute("UPDATE USERS SET Name = :n WHERE User_ID = :u", {"n": name[:120], "u": user_id})
