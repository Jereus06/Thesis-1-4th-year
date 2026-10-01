import csv
import io
from contextlib import asynccontextmanager
from uuid import UUID

from fastapi import Cookie, Depends, FastAPI, Header, HTTPException, Query, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from psycopg import Connection
from psycopg.errors import CheckViolation, UniqueViolation

from .config import Settings, get_settings
from .db import close_pool, connection, database_ready, open_pool
from .repository import Repository
from .schemas import (
    BusinessUpdate,
    ForecastRunCreate,
    InventoryImportCreate,
    MovementCreate,
    ProductCreate,
    ProductUpdate,
    RecommendationGenerate,
    SaleCreate,
    SalesImportCreate,
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
app = FastAPI(title="StockCast API", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.cors_origin],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
)


@app.exception_handler(UniqueViolation)
def duplicate_record(_request, _error):
    return JSONResponse(
        status_code=409, content={"detail": "A record with this SKU or import key already exists"}
    )


@app.exception_handler(CheckViolation)
def invalid_record(_request, _error):
    return JSONResponse(
        status_code=422, content={"detail": "A value violates a database validation rule"}
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


def write_once(
    repository: Repository, user: Principal, key: str | None, operation: str, data, callback
):
    if not key:
        return callback()
    return repository.idempotent(user, operation, key, data.model_dump(mode="json"), callback)


def principal_data(user: Principal) -> dict[str, str]:
    return {
        "userId": user.user_id,
        "businessId": user.business_id,
        "email": user.email,
        "displayName": user.display_name,
        "role": user.role,
    }


def csv_response(filename: str, columns: list[str], rows) -> Response:
    output = io.StringIO()
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow([row[column] if row[column] is not None else "" for column in columns])
    return Response(
        output.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


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


@app.get("/api/v1/businesses/{business_id}")
def get_business(
    business_id: str, repository: Repository = Depends(repo), user: Principal = Depends(principal)
):
    business_user(business_id, user)
    return {"data": repository.get_business(business_id)}


@app.patch("/api/v1/businesses/{business_id}")
def update_business(
    business_id: str,
    data: BusinessUpdate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {"data": repository.update_business(business_id, data)}


@app.get("/api/v1/businesses/{business_id}/products")
def products(
    business_id: str, repository: Repository = Depends(repo), user: Principal = Depends(principal)
):
    business_user(business_id, user)
    return {"data": repository.list_products(business_id)}


@app.get("/api/v1/businesses/{business_id}/products/{product_id}")
def product(
    business_id: str,
    product_id: UUID,
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    matches = [
        item for item in repository.list_products(business_id) if item["id"] == str(product_id)
    ]
    if not matches:
        raise HTTPException(404, "Product not found")
    return {"data": matches[0]}


@app.post("/api/v1/businesses/{business_id}/products", status_code=201)
def create_product(
    business_id: str,
    data: ProductCreate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {
        "data": write_once(
            repository,
            user,
            idempotency_key,
            "create_product",
            data,
            lambda: repository.create_product(user, data),
        )
    }


@app.patch("/api/v1/businesses/{business_id}/products/{product_id}")
def update_product(
    business_id: str,
    product_id: UUID,
    data: ProductUpdate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {"data": repository.update_product(user, product_id, data)}


@app.post("/api/v1/businesses/{business_id}/inventory-imports", status_code=201)
def import_inventory(
    business_id: str,
    data: InventoryImportCreate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {
        "data": write_once(
            repository,
            user,
            idempotency_key,
            "import_inventory",
            data,
            lambda: repository.import_inventory(user, data),
        )
    }


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
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    business_user(business_id, user)
    return {
        "data": write_once(
            repository,
            user,
            idempotency_key,
            "record_sale",
            data,
            lambda: repository.record_sale(user, data),
        )
    }


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


@app.get("/api/v1/businesses/{business_id}/exports/sales.csv")
def export_sales(
    business_id: str, repository: Repository = Depends(repo), user: Principal = Depends(principal)
):
    business_user(business_id, user)
    columns = ["id", "sku", "sale_date", "quantity", "source", "data_origin"]
    return csv_response("stockcast-sales.csv", columns, repository.export_sales(business_id))


@app.get("/api/v1/businesses/{business_id}/exports/inventory-movements.csv")
def export_movements(
    business_id: str, repository: Repository = Depends(repo), user: Principal = Depends(principal)
):
    business_user(business_id, user)
    columns = [
        "id",
        "sku",
        "movement_date",
        "movement_type",
        "quantity_delta",
        "balance_after",
        "data_origin",
        "note",
    ]
    return csv_response(
        "stockcast-inventory-movements.csv", columns, repository.export_movements(business_id)
    )


@app.post("/api/v1/businesses/{business_id}/inventory-movements", status_code=201)
def record_movement(
    business_id: str,
    data: MovementCreate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
):
    business_user(business_id, user)
    if data.movement_type in {"adjustment", "write_off"} and user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {
        "data": write_once(
            repository,
            user,
            idempotency_key,
            "record_movement",
            data,
            lambda: repository.record_movement(user, data),
        )
    }


@app.get("/api/v1/businesses/{business_id}/data-imports")
def data_imports(
    business_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    return {"data": repository.list_data_imports(business_id, limit, offset)}


@app.post("/api/v1/businesses/{business_id}/data-imports", status_code=201)
def create_data_import(
    business_id: str,
    data: SalesImportCreate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {"data": repository.create_sales_import(user, data)}


@app.get("/api/v1/businesses/{business_id}/data-imports/{import_id}")
def data_import(
    business_id: str,
    import_id: UUID,
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    return {"data": repository.get_data_import(business_id, import_id)}


@app.get("/api/v1/businesses/{business_id}/forecast-runs")
def forecast_runs(
    business_id: str,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    return {"data": repository.list_forecast_runs(business_id, limit, offset)}


@app.post("/api/v1/businesses/{business_id}/forecast-runs", status_code=202)
def create_forecast_run(
    business_id: str,
    data: ForecastRunCreate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {"data": repository.create_forecast_run(user, data)}


@app.get("/api/v1/businesses/{business_id}/forecast-runs/{run_id}")
def forecast_run(
    business_id: str,
    run_id: UUID,
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    return {"data": repository.get_forecast_run(business_id, run_id)}


@app.post("/api/v1/businesses/{business_id}/forecast-refresh", status_code=202)
def refresh_forecast(
    business_id: str,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {"data": repository.refresh_forecast(user)}


@app.get("/api/v1/businesses/{business_id}/forecast-dashboard")
def forecast_dashboard(
    business_id: str,
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    from .dashboard import dashboard

    return {"data": dashboard(repository, business_id)}


@app.get("/api/v1/businesses/{business_id}/forecast-runs/{run_id}/predictions")
def predictions(
    business_id: str,
    run_id: UUID,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    return {"data": repository.list_predictions(business_id, run_id, limit, offset)}


@app.get("/api/v1/businesses/{business_id}/forecast-runs/{run_id}/metrics")
def metrics(
    business_id: str,
    run_id: UUID,
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    return {"data": repository.list_metrics(business_id, run_id)}


@app.get("/api/v1/businesses/{business_id}/reorder-recommendations")
def recommendations(
    business_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    repository: Repository = Depends(repo),
    user: Principal = Depends(principal),
):
    business_user(business_id, user)
    return {"data": repository.list_recommendations(business_id, limit, offset)}


@app.post("/api/v1/businesses/{business_id}/reorder-recommendations/generate", status_code=201)
def generate_recommendations(
    business_id: str,
    data: RecommendationGenerate,
    repository: Repository = Depends(repo),
    user: Principal = Depends(csrf_protected),
):
    business_user(business_id, user)
    if user.role != "owner":
        raise HTTPException(403, "Owner role required")
    return {"data": repository.generate_recommendations(user, data)}
