"""Account registration and Google authentication using the existing session contract."""

import hmac
import logging
import threading
import time
from collections import OrderedDict
from typing import Literal
from uuid import UUID
from urllib.parse import urlencode

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from fastapi.responses import RedirectResponse
from pydantic import EmailStr, Field, field_validator

from .auth_repository import AuthRepository
from .config import Settings, get_settings
from .mailer import MailUnavailable, Mailer
from .google_auth import GoogleAuthError, GoogleClient, configured
from .schemas import ApiModel, SignIn
from .security import Principal, new_token, token_hash


class StoreRegistration(ApiModel):
    business_name: str = Field(min_length=1, max_length=160)
    business_location: str | None = Field(default=None, max_length=240)
    data_origin: Literal["demo", "partner"]

    @field_validator("business_name", "business_location", mode="before")
    @classmethod
    def trim_store_fields(cls, value):
        return value.strip() if isinstance(value, str) else value


class SignUp(StoreRegistration):
    display_name: str = Field(min_length=1, max_length=160)
    email: EmailStr
    password: str = Field(min_length=12, max_length=128)

    @field_validator("display_name", mode="before")
    @classmethod
    def trim_name(cls, value):
        return value.strip() if isinstance(value, str) else value


class GoogleStart(ApiModel):
    intent: Literal["sign-in", "link"] = "sign-in"


class PasswordChange(ApiModel):
    current_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


class RecoveryRequest(ApiModel):
    email: EmailStr
    business_id: UUID | None = None


class RecoveryComplete(ApiModel):
    token: str = Field(min_length=20, max_length=512)
    new_password: str = Field(min_length=12, max_length=128)


class StaffInvite(ApiModel):
    email: EmailStr
    display_name: str = Field(min_length=1, max_length=160)


class InvitationAccept(ApiModel):
    token: str = Field(min_length=20, max_length=512)
    password: str = Field(min_length=12, max_length=128)


class MemberStatus(ApiModel):
    is_active: bool


class AuthLimiter:
    """Bounded per-process abuse protection; use gateway limits for multiple replicas."""

    def __init__(self):
        self.entries = OrderedDict()
        self.lock = threading.Lock()

    def check(self, key: str, limit: int, seconds: int) -> None:
        digest = token_hash(key)
        now = time.monotonic()
        with self.lock:
            count, start = self.entries.get(digest, (0, now))
            if now - start >= seconds:
                count, start = 0, now
            self.entries[digest] = (count + 1, start)
            self.entries.move_to_end(digest)
            while len(self.entries) > 4096:
                self.entries.popitem(last=False)
            if count >= limit:
                raise HTTPException(
                    429,
                    "Too many attempts. Please try again later.",
                    headers={"Retry-After": str(max(1, int(seconds - (now - start))))},
                )


limiter = AuthLimiter()
logger = logging.getLogger(__name__)


def origin_guard(request: Request, config: Settings) -> None:
    origin = request.headers.get("origin")
    if origin is not None and origin.rstrip("/") != config.cors_origin.rstrip("/"):
        raise HTTPException(403, "This request must come from the StockCast website")


def throttle(request: Request, operation: str, identity: str = "") -> None:
    address = request.client.host if request.client else "unknown"
    limiter.check("ip:" + address, 120, 60)
    limit, period = (5, 3600) if operation == "register" else (10, 60)
    limiter.check(operation + ":" + address + ":" + identity.lower(), limit, period)


def principal_data(user: Principal) -> dict[str, str]:
    return {
        "userId": user.user_id,
        "businessId": user.business_id,
        "email": user.email,
        "displayName": user.display_name,
        "role": user.role,
    }


def set_session(response: Response, session: str, csrf: str, config: Settings) -> None:
    secure = config.app_env == "production"
    response.set_cookie(
        "stockcast_session",
        session,
        httponly=True,
        secure=secure,
        samesite="strict",
        max_age=config.session_hours * 3600,
    )
    response.set_cookie(
        "stockcast_csrf",
        csrf,
        httponly=False,
        secure=secure,
        samesite="strict",
        max_age=config.session_hours * 3600,
    )


def create_auth_router(repo_dependency) -> APIRouter:
    router = APIRouter(prefix="/api/v1/auth")

    def authenticated(request: Request, repository: AuthRepository):
        raw = request.cookies.get("stockcast_session")
        if not raw:
            raise HTTPException(401, "Sign in is required")
        user, stored = repository.authenticate(raw)
        cookie = request.cookies.get("stockcast_csrf")
        header = request.headers.get("X-CSRF-Token")
        if (
            not cookie
            or not header
            or not hmac.compare_digest(cookie, header)
            or not hmac.compare_digest(token_hash(header), stored)
        ):
            raise HTTPException(403, "CSRF token is missing or invalid")
        return user

    @router.post("/password/change")
    def password_change(
        data: PasswordChange,
        request: Request,
        response: Response,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        origin_guard(request, config)
        throttle(request, "password-change")
        user = authenticated(request, repository)
        repository.change_password(user, data.current_password, data.new_password)
        response.delete_cookie("stockcast_session")
        response.delete_cookie("stockcast_csrf")
        return {"data": {"changed": True}}

    @router.post("/password/recovery")
    def recovery_request(
        data: RecoveryRequest,
        request: Request,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        origin_guard(request, config)
        throttle(request, "recovery", str(data.email))
        raw = new_token()
        if repository.create_reset(str(data.email), raw, data.business_id):
            try:
                Mailer(config).send(
                    str(data.email),
                    "Reset your StockCast password",
                    f"Open {config.public_app_url.rstrip('/')}/?reset={raw} within 30 minutes. This link works once.",
                )
            except MailUnavailable:
                logger.warning("Password recovery email delivery unavailable")
        return {"data": {"accepted": True}}

    @router.post("/password/recovery/complete")
    def recovery_complete(
        data: RecoveryComplete,
        request: Request,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        origin_guard(request, config)
        throttle(request, "recovery-complete")
        repository.consume_reset(data.token, data.new_password)
        return {"data": {"changed": True}}

    @router.get("/members")
    def members(request: Request, repository: AuthRepository = Depends(repo_dependency)):
        return {"data": repository.list_members(authenticated(request, repository))}

    @router.post("/staff/invitations", status_code=201)
    def invite_staff(
        data: StaffInvite,
        request: Request,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        origin_guard(request, config)
        throttle(request, "staff-invite", str(data.email))
        owner = authenticated(request, repository)
        raw = new_token()
        invitation = repository.create_invitation(owner, str(data.email), data.display_name, raw)
        try:
            Mailer(config).send(
                str(data.email),
                "StockCast staff invitation",
                f"Open {config.public_app_url.rstrip('/')}/?invitation={raw} within 48 hours. This invitation works once.",
            )
        except MailUnavailable as error:
            raise HTTPException(503, str(error)) from error
        return {"data": invitation}

    @router.post("/staff/invitations/accept", status_code=201)
    def accept_staff(
        data: InvitationAccept,
        request: Request,
        response: Response,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        origin_guard(request, config)
        throttle(request, "invite-accept")
        session, csrf, user = repository.accept_invitation(
            data.token, data.password, config.session_hours
        )
        set_session(response, session, csrf, config)
        return {"data": principal_data(user)}

    @router.patch("/members/{user_id}")
    def member_status(
        user_id: UUID,
        data: MemberStatus,
        request: Request,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        origin_guard(request, config)
        owner = authenticated(request, repository)
        return {"data": repository.set_staff_active(owner, user_id, data.is_active)}

    @router.get("/options")
    def options(config: Settings = Depends(get_settings)):
        return {"data": {"signUpEnabled": True, "googleEnabled": configured(config)}}

    @router.post("/sign-in")
    def sign_in(
        data: SignIn,
        request: Request,
        response: Response,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        origin_guard(request, config)
        throttle(request, "login", str(data.email))
        session, csrf, user = repository.sign_in(
            data.business_id, str(data.email), data.password, config.session_hours
        )
        set_session(response, session, csrf, config)
        return {"data": principal_data(user)}

    @router.post("/sign-up", status_code=201)
    def sign_up(
        data: SignUp,
        request: Request,
        response: Response,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        origin_guard(request, config)
        throttle(request, "register")
        session, csrf, user = repository.create_account(
            email=str(data.email),
            display_name=data.display_name,
            business_name=data.business_name,
            location=data.business_location,
            data_origin=data.data_origin,
            password=data.password,
            hours=config.session_hours,
            google_subject=None,
        )
        set_session(response, session, csrf, config)
        return {"data": principal_data(user)}

    @router.post("/google/start")
    def google_start(
        data: GoogleStart,
        request: Request,
        response: Response,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        origin_guard(request, config)
        throttle(request, "google")
        if not configured(config):
            raise HTTPException(503, "Google sign-in has not been configured")
        session_hash = None
        if data.intent == "link":
            raw_session = request.cookies.get("stockcast_session")
            if not raw_session:
                raise HTTPException(401, "Sign in before connecting Google")
            _user, stored_csrf = repository.authenticate(raw_session)
            cookie = request.cookies.get("stockcast_csrf")
            header = request.headers.get("X-CSRF-Token")
            if (
                not cookie
                or not header
                or not stored_csrf
                or not hmac.compare_digest(cookie, header)
                or not hmac.compare_digest(token_hash(header), stored_csrf)
            ):
                raise HTTPException(403, "CSRF token is missing or invalid")
            session_hash = token_hash(raw_session)
        state, browser, verifier, nonce = new_token(), new_token(), new_token(), new_token()
        repository.create_flow(
            token_hash(state), token_hash(browser), verifier, nonce, data.intent, session_hash
        )
        response.set_cookie(
            "stockcast_google_state",
            browser,
            httponly=True,
            secure=config.app_env == "production",
            samesite="lax",
            max_age=600,
            path="/api/v1/auth/google",
        )
        return {"data": {"url": GoogleClient(config).authorization_url(state, verifier, nonce)}}

    @router.get("/google/callback")
    def google_callback(
        request: Request,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        def redirect(**query):
            response = RedirectResponse(
                config.cors_origin.rstrip("/") + "/?" + urlencode(query), status_code=303
            )
            response.delete_cookie("stockcast_google_state", path="/api/v1/auth/google")
            return response

        state = request.query_params.get("state", "")
        browser = request.cookies.get("stockcast_google_state", "")
        if not state or not browser or len(state) > 512 or len(browser) > 512:
            return redirect(auth_error="google_expired")
        flow = repository.consume_flow(token_hash(state), token_hash(browser))
        if not flow:
            return redirect(auth_error="google_expired")
        # Consume the browser-bound state before any provider/network failure.
        repository.conn.commit()
        if request.query_params.get("error"):
            return redirect(auth_error="google_denied")
        code = request.query_params.get("code", "")
        if not code or len(code) > 4096 or not configured(config):
            return redirect(auth_error="google_failed")
        try:
            identity = GoogleClient(config).exchange(code, flow["verifier"], flow["nonce"])
            if flow["intent"] == "link":
                user = repository.valid_session(flow["session_hash"])
                if not user:
                    return redirect(auth_error="google_link_expired")
                repository.link_identity(identity["subject"], user.user_id)
                # Refresh this authenticated user's session after the cross-site callback.
                session, csrf, user = repository.issue_session(user, config.session_hours)
                response = redirect(auth="google-linked")
                set_session(response, session, csrf, config)
                return response
            user = repository.google_user(identity["subject"])
            if user:
                session, csrf, user = repository.issue_session(user, config.session_hours)
                response = redirect(auth="google")
                set_session(response, session, csrf, config)
                response.delete_cookie("stockcast_google_pending")
                return response
            if repository.email_exists(identity["email"]):
                return redirect(auth_error="google_account_exists")
            pending = new_token()
            repository.create_pending(
                token_hash(pending),
                identity["subject"],
                identity["email"],
                identity["display_name"],
            )
            response = redirect(auth="google-register")
            response.set_cookie(
                "stockcast_google_pending",
                pending,
                httponly=True,
                secure=config.app_env == "production",
                samesite="strict",
                max_age=600,
            )
            return response
        except GoogleAuthError:
            return redirect(auth_error="google_failed")
        except HTTPException:
            return redirect(
                auth_error="google_link_conflict"
                if flow["intent"] == "link"
                else "google_account_exists"
            )

    @router.get("/google/pending")
    def google_pending(
        stockcast_google_pending: str | None = Cookie(default=None),
        repository: AuthRepository = Depends(repo_dependency),
    ):
        pending = (
            repository.pending(token_hash(stockcast_google_pending))
            if stockcast_google_pending
            else None
        )
        return {
            "data": {"email": pending["email"], "displayName": pending["display_name"]}
            if pending
            else None
        }

    @router.post("/google/complete", status_code=201)
    def google_complete(
        data: StoreRegistration,
        request: Request,
        response: Response,
        repository: AuthRepository = Depends(repo_dependency),
        config: Settings = Depends(get_settings),
    ):
        origin_guard(request, config)
        throttle(request, "register")
        pending = request.cookies.get("stockcast_google_pending")
        if not pending:
            raise HTTPException(
                401, "Google registration expired. Please continue with Google again."
            )
        session, csrf, user = repository.complete_pending(
            token_hash(pending),
            data.business_name,
            data.business_location,
            data.data_origin,
            config.session_hours,
        )
        set_session(response, session, csrf, config)
        response.delete_cookie("stockcast_google_pending")
        return {"data": principal_data(user)}

    return router
