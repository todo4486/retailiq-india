"""Authentication routes, and the guard that protects the rest of the API."""
import datetime as dt

from flask import Blueprint, jsonify, request, session

from errors import ApiError
from services import auth

bp = Blueprint("auth", __name__, url_prefix="/api/auth")

# Everything else under /api needs a signed-in user.
PUBLIC_PATHS = {"/api/auth/login", "/api/auth/register", "/api/auth/forgot-password", "/api/auth/reset-password",
                "/api/auth/me", "/api/public/summary"}
# A session without "remember me" also ends after this long, even if the browser stays open.
SHORT_SESSION_HOURS = 12


def _present(user):
    return {"id": user["User_ID"], "name": user["Name"], "email": user["Email"]}


def _start_session(user, remember):
    session.clear()
    session["user_id"] = user["User_ID"]
    session["epoch"] = user["Session_Epoch"]
    session["started"] = dt.datetime.now().isoformat()
    session["remember"] = bool(remember)
    # A permanent cookie survives closing the browser, for 30 days. Otherwise it is browser-session only.
    session.permanent = bool(remember)


def current_user():
    user_id = session.get("user_id")
    if not user_id:
        return None
    if not session.get("remember"):
        started = dt.datetime.fromisoformat(session.get("started", "2000-01-01"))
        if dt.datetime.now() - started > dt.timedelta(hours=SHORT_SESSION_HOURS):
            session.clear()
            return None
    user = auth.get_user(user_id)
    if not user or user["Session_Epoch"] != session.get("epoch"):
        session.clear()
        return None
    return user


def require_login():
    if not request.path.startswith("/api/") or request.path in PUBLIC_PATHS:
        return None
    if not current_user():
        return jsonify({"error": {"code": "unauthenticated", "message": "Please sign in to continue."}}), 401
    return None


def _body():
    return request.get_json(silent=True) or {}


@bp.post("/register")
def register():
    body = _body()
    user = auth.register(body.get("name"), body.get("email"), body.get("password"))
    _start_session(user, remember=False)
    return jsonify(_present(user)), 201


@bp.post("/login")
def login():
    body = _body()
    if not body.get("email") or not body.get("password"):
        raise ApiError("Enter your email and password.", code="missing_fields")
    user = auth.login(body["email"], body["password"], request.remote_addr)
    _start_session(user, remember=body.get("remember"))
    return jsonify(_present(user))


@bp.post("/logout")
def logout():
    session.clear()
    return jsonify({"signed_out": True})


@bp.get("/me")
def me():
    user = current_user()
    return jsonify({"user": _present(user) if user else None})


@bp.patch("/me")
def update_me():
    user = current_user()
    auth.update_profile(user["User_ID"], _body().get("name"))
    return jsonify(_present(auth.get_user(user["User_ID"])))


@bp.post("/forgot-password")
def forgot_password():
    # The same answer whether or not the account exists.
    auth.request_reset(_body().get("email"))
    return jsonify({"requested": True})


@bp.post("/reset-password")
def reset_password():
    body = _body()
    auth.reset_password(body.get("token"), body.get("password"))
    return jsonify({"reset": True})
