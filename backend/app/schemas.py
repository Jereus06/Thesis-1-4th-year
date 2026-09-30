from datetime import date
from decimal import Decimal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=lambda value: "".join(
            [value.split("_")[0], *[part.title() for part in value.split("_")[1:]]]
        ),
        populate_by_name=True,
    )


class SignIn(ApiModel):
    business_id: UUID
    email: EmailStr
    password: str = Field(min_length=1, max_length=1024)


class ProductCreate(ApiModel):
    sku: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    category: str = Field(min_length=1, max_length=100)
    unit: str = Field(min_length=1, max_length=50)
    current_stock: Decimal = Field(ge=0, decimal_places=3)
    lead_time_days: int = Field(ge=0)
    safety_stock: Decimal = Field(ge=0, decimal_places=3)
    unit_cost: Decimal = Field(ge=0, decimal_places=4)


class ProductUpdate(ApiModel):
    sku: str | None = Field(default=None, min_length=1, max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, min_length=1, max_length=100)
    unit: str | None = Field(default=None, min_length=1, max_length=50)
    lead_time_days: int | None = Field(default=None, ge=0)
    safety_stock: Decimal | None = Field(default=None, ge=0, decimal_places=3)
    unit_cost: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    is_active: bool | None = None


class SaleCreate(ApiModel):
    product_id: UUID
    sale_date: date
    quantity: Decimal = Field(gt=0, decimal_places=3)


class MovementCreate(ApiModel):
    product_id: UUID
    movement_date: date
    movement_type: str
    quantity_delta: Decimal = Field(decimal_places=3)
    note: str | None = Field(default=None, max_length=500)


class SettingsUpdate(ApiModel):
    moving_average_window: int = Field(gt=0)
    forecast_horizon_days: int = Field(gt=0)
    target_cover_days: int = Field(ge=0)
    minimum_history_weeks: int = Field(gt=0)
    minimum_nonzero_days: int = Field(gt=0)
    top_n_products: int = Field(gt=0)
    cv_folds: int = Field(ge=2)
    timezone: str = Field(min_length=1)
