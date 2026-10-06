from datetime import date, timedelta
from decimal import Decimal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    field_validator,
    model_validator,
)


class ApiModel(BaseModel):
    model_config = ConfigDict(
        alias_generator=lambda value: "".join(
            [value.split("_")[0], *[part.title() for part in value.split("_")[1:]]]
        ),
        populate_by_name=True,
    )


class SignIn(ApiModel):
    business_id: UUID | None = None
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
    current_stock: Decimal | None = Field(default=None, ge=0, decimal_places=3)
    sku: str | None = Field(default=None, min_length=1, max_length=100)
    name: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = Field(default=None, min_length=1, max_length=100)
    unit: str | None = Field(default=None, min_length=1, max_length=50)
    lead_time_days: int | None = Field(default=None, ge=0)
    safety_stock: Decimal | None = Field(default=None, ge=0, decimal_places=3)
    unit_cost: Decimal | None = Field(default=None, ge=0, decimal_places=4)
    is_active: bool | None = None


class InventoryImportCreate(ApiModel):
    rows: list[ProductCreate] = Field(min_length=1, max_length=5000)

    @model_validator(mode="after")
    def unique_skus(self):
        skus = [row.sku.strip().lower() for row in self.rows]
        if len(skus) != len(set(skus)):
            raise ValueError("Inventory import contains duplicate SKUs")
        return self


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
    business_name: str | None = Field(default=None, min_length=1, max_length=200)
    business_location: str | None = Field(default=None, max_length=300)
    moving_average_window: int = Field(gt=0)
    forecast_horizon_days: int = Field(gt=0)
    target_cover_days: int = Field(ge=0)
    minimum_history_weeks: int = Field(gt=0)
    minimum_nonzero_days: int = Field(gt=0)
    top_n_products: int = Field(gt=0)
    cv_folds: int = Field(ge=2)
    timezone: str = Field(min_length=1)

    @field_validator("timezone")
    @classmethod
    def valid_timezone(cls, value):
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as error:
            raise ValueError("Use a valid IANA timezone such as Asia/Manila") from error
        return value


class BusinessUpdate(ApiModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    location: str | None = Field(default=None, max_length=300)


class ImportSaleRow(ApiModel):
    sku: str = Field(min_length=1, max_length=100)
    sale_date: date
    quantity: Decimal = Field(gt=0, decimal_places=3)
    source_record_key: str | None = Field(default=None, max_length=200)

    @field_validator("source_record_key", mode="before")
    @classmethod
    def normalize_source_record_key(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


class SalesImportCreate(ApiModel):
    source: str = Field(default="csv", pattern="^(csv|pos_export|spreadsheet|migration)$")
    original_filename: str | None = Field(default=None, max_length=255)
    rows: list[ImportSaleRow] = Field(min_length=1, max_length=100_000)


class ForecastRunCreate(ApiModel):
    training_start: date
    training_end: date
    validation_start: date
    validation_end: date
    final_test_start: date
    final_test_end: date
    forecast_horizon_days: int = Field(gt=0, le=365)
    configuration: dict = Field(default_factory=dict)

    @model_validator(mode="after")
    def ordered_periods(self):
        if not (
            self.training_start
            <= self.training_end
            < self.validation_start
            <= self.validation_end
            < self.final_test_start
            <= self.final_test_end
        ):
            raise ValueError(
                "Training, validation, and final-test periods must be ordered and disjoint"
            )
        if self.validation_start != self.training_end + timedelta(
            days=1
        ) or self.final_test_start != self.validation_end + timedelta(days=1):
            raise ValueError("Chronological periods must be contiguous daily ranges")
        return self


class RecommendationGenerate(ApiModel):
    recommendation_date: date
    lookback_days: int = Field(default=28, ge=7, le=365)


class DataQualityUpsert(ApiModel):
    product_id: UUID | None = None
    classification_date: date
    classification: str = Field(
        pattern="^(confirmed_zero|business_closed|full_stockout|partial_stockout|incomplete)$"
    )
    note: str | None = Field(default=None, max_length=1000)


class DataQualityDelete(ApiModel):
    product_id: UUID | None = None
    classification_date: date
