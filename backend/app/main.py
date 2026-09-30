from contextlib import asynccontextmanager

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from psycopg import Connection

from .config import Settings, get_settings
from .db import close_pool, connection, database_ready, open_pool
from .repository import Repository
from .schemas import (
    MovementCreate,
    ProductCreate,
    ProductUpdate,
    SaleCreate,
    SettingsUpdate,
    SignIn,
)
from .security import Principal, token_hash


@asynccontextmanager
async def lifespan(_: FastAPI):
    open_pool()
    yield
    close_pool()


settings = get_settings()
app = FastAPI(title="StockCast API", version="0.2.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
)


def repo(conn: Connection = Depends(connection)) -> Repository:
    return Repository(conn)


def current_session(
    repository: Repository = Depends(repo),
    stockcast_session: str | None = Cookie(default=None),
) -> tuple[Principal, str]:
    if not stockcast_session:
        raise HTTPException(401, "Sign in is required")
    return repository.authenticate(stockcast_session)


def principal(session: tuple[Principal, str] = Depends(current_session)) -> Principal:
    return session[0]


def owner(user: Principal = Depends(principal)) -> Principal:
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return user


def csrf_protected(
    session: tuple[Principal, str] = Depends(current_session),
    csrf_cookie: str | None = Cookie(default=None, alias="stockcast_csrf"),
    csrf_header: str | None = Header(default=None, alias="X-CSRF-Token"),
) -> Principal:
    if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
        raise HTTPException(403, "CSRF token is missing or invalid")
    if token_hash(csrf_header) != session[1]:
        raise HTTPException(403, "CSRF token is missing or invalid")
    return session[0]


def business_user(business_id: str, user: Principal) -> None:
    if user.business_id != business_id:
        raise HTTPException(403, "You do not belong to this business")


def principal_data(user: Principal) -> dict[str, str]:
    return {
        "userId": user.user_id,
        "businessId": user.business_id,
        "email": user.email,
        "displayName": user.display_name,
        "role": user.role,
    }


@app.get("/api/v1/health")
def health():
    ready = database_ready()
    if not ready:
        raise HTTPException(503, "Database unavailable")
    return {"status": "ok", "database": "connected"}


@app.post("/api/v1/auth/sign-in")
def sign_in(
    data: SignIn,
    response: Response,
    repository: Repository = Depends(repo),
    config: Settings = Depends(get_settings),
):
    session, csrf, user = repository.sign_in(
        data.business_id, str(data.email), data.password, config.session_hours
    )
    secure = config.node_env == "production"
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
    return {"data": principal_data(user)}


@app.post("/api/v1/auth/sign-out")
def sign_out(
    response: Response,
    repository: Repository = Depends(repo),
    stockcast_session: str | None = Cookie(default=None),
    _user: Principal = Depends(csrf_protected),
):
    if stockcast_session:
        repository.sign_out(stockcast_session)
    response.delete_cookie("stockcast_session")
    response.delete_cookie("stockcast_csrf")
    return {"data": {"signedOut": True}}


@app.get("/api/v1/auth/me")
def me(user: Principal = Depends(principal)):
    return {"data": principal_data(user)}


@app.get("/api/v1/businesses/{business_id}/products")
def products(
    business_id: str, repository: Repository = Depends(repo), user: Principal = Depends(principal)
):
    business_user(business_id, user)
    return {"data": repository.list_products(business_id)}


@app.post("/api/v1/businesses/{business_id}/products", status_code=201)
def create_product(
    business_id: str,
    data: ProductCreate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {"data": repository.create_product(user, data)}


@app.patch("/api/v1/businesses/{business_id}/products/{product_id}")
def update_product(
    business_id: str,
    product_id: str,
    data: ProductUpdate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {"data": repository.update_product(user, product_id, data)}


@app.get("/api/v1/businesses/{business_id}/settings")
def get_business_settings(
    business_id: str, repository: Repository = Depends(repo), user: Principal = Depends(principal)
):
    business_user(business_id, user)
    return {"data": repository.get_settings(business_id)}


@app.put("/api/v1/businesses/{business_id}/settings")
def put_business_settings(
    business_id: str,
    data: SettingsUpdate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {"data": repository.put_settings(business_id, data)}


@app.get("/api/v1/businesses/{business_id}/sales")
def sales(
    business_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    return {"data": repository.list_sales(business_id, limit, offset)}


@app.post("/api/v1/businesses/{business_id}/sales", status_code=201)
def record_sale(
    business_id: str,
    data: SaleCreate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    return {"data": repository.record_sale(user, data)}


@app.get("/api/v1/businesses/{business_id}/inventory-movements")
def movements(
    business_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    return {"data": repository.list_movements(business_id, limit, offset)}


@app.post("/api/v1/businesses/{business_id}/inventory-movements", status_code=201)
def record_movement(
    business_id: str,
    data: MovementCreate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    if data.movement_type in {"adjustment", "write_off"} and user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {"data": repository.record_movement(user, data)}
