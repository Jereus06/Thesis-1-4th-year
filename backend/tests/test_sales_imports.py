"""Sales import identity and retry checks without a PostgreSQL connection."""

import hashlib
import json
from contextlib import contextmanager
from datetime import UTC, datetime
from uuid import UUID

import pytest
from fastapi import HTTPException

from app.repository import Repository
from app.schemas import ImportSaleRow, SalesImportCreate
from app.security import Principal


PRODUCT_ID = UUID("00000000-0000-4000-8000-000000000001")
OTHER_PRODUCT_ID = UUID("00000000-0000-4000-8000-000000000002")


def owner(business="store-1"):
    return Principal("owner", business, "owner@example.com", "Owner", "owner")


def row(key=None, **changes):
    return {
        "sku": "TEST-1", "saleDate": "2026-01-01", "quantity": "2",
        "sourceRecordKey": key, **changes,
    }


def payload(rows, source="csv"):
    return SalesImportCreate(source=source, rows=rows)


class Result:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class ImportConnection:
    def __init__(self):
        self.products = [
            {"business_id": "store-1", "id": PRODUCT_ID, "sku": "test-1"},
            {"business_id": "store-2", "id": OTHER_PRODUCT_ID, "sku": "test-1"},
        ]
        self.sales = []
        self.batches = []
        self.in_transaction = False
        self.locked_business = None
        self.key_reads = 0

    @contextmanager
    def transaction(self):
        assert not self.in_transaction
        self.in_transaction = True
        try:
            yield
        finally:
            self.in_transaction = False
            self.locked_business = None

    def execute(self, query, params):
        # Reads must be protected by the transaction/business lock, not just writes.
        assert self.in_transaction
        if "FOR NO KEY UPDATE" in query:
            self.locked_business = params[0]
            return Result([{"id": params[0]}])
        if "FROM data_imports" in query:
            assert self.locked_business == params[0]
            matches = [batch for batch in self.batches if (
                batch["business_id"] == params[0] and batch["content_sha256"] in params[1]
            )]
            return Result(sorted(matches, key=lambda batch: (batch["rejected_rows"], batch["id"])))
        if "FROM products" in query:
            assert self.locked_business == params[0]
            return Result([product for product in self.products if product["business_id"] == params[0]])
        if "FROM sales" in query:
            assert self.locked_business == params[0]
            self.key_reads += 1
            return Result([sale for sale in self.sales if (
                sale["business_id"] == params[0] and sale["source_record_key"] is not None
            )])
        if "INSERT INTO data_imports" in query:
            business, source, filename, digest, total, _user, _business = params
            batch = {
                "id": f"batch-{len(self.batches) + 1}", "business_id": business,
                "source": source, "data_origin": "demo", "original_filename": filename,
                "content_sha256": digest, "status": "processing", "total_rows": total,
                "accepted_rows": 0, "rejected_rows": 0, "error_summary": [],
                "created_at": datetime.now(UTC),
            }
            self.batches.append(batch)
            return Result([batch])
        if "INSERT INTO sales" in query:
            business, product, day, quantity, source, batch, number, key, _user, _business = params
            self.sales.append({
                "business_id": business, "product_id": product, "sale_date": day,
                "quantity": quantity, "source": source, "import_id": batch,
                "source_row_number": number, "source_record_key": key,
            })
            return Result()
        if "UPDATE data_imports" in query:
            accepted, rejected, errors, batch_id = params
            batch = next(batch for batch in self.batches if batch["id"] == batch_id)
            batch.update({
                "status": "completed", "accepted_rows": accepted, "rejected_rows": rejected,
                "error_summary": errors.obj,
            })
            return Result([batch])
        raise AssertionError(f"Unexpected sales import query (including any stock write): {query}")


@pytest.fixture()
def repository():
    return Repository(ImportConnection())


@pytest.mark.parametrize(
    ("key", "expected"), [(None, None), ("", None), (" \t\n", None), (" record-1 \t", "record-1")]
)
def test_source_record_key_normalizes_surrounding_whitespace(key, expected):
    assert ImportSaleRow(**row(key)).source_record_key == expected


def test_overlapping_batches_deduplicate_keys_across_source_formats(repository):
    repository.create_sales_import(owner(), payload([
        row("record-1"), row("record-2", saleDate="2026-01-02", quantity="3"),
    ]))
    result = repository.create_sales_import(owner(), payload([
        row(" record-2 ", sku=" test-1 ", saleDate="2026-01-02", quantity="3.000"),
        row("record-1", quantity="2.0"),
        row("record-3", saleDate="2026-01-03"),
    ], source="pos_export"))
    assert (result["acceptedRows"], result["rejectedRows"]) == (1, 2)
    assert result["errors"] == [
        {"row": 1, "code": "duplicate_source_record_key"},
        {"row": 2, "code": "duplicate_source_record_key"},
    ]
    assert [sale["source_record_key"] for sale in repository.conn.sales] == [
        "record-1", "record-2", "record-3",
    ]
    assert repository.conn.key_reads == 2


def test_changed_key_content_conflicts_and_does_not_overwrite_original(repository):
    repository.create_sales_import(owner(), payload([row("record-1")]))
    result = repository.create_sales_import(owner(), payload([
        row("record-1", quantity="3"),
        row("record-1", saleDate="2026-01-02"),
        row("record-1", sku="UNKNOWN"),
    ]))
    assert result["acceptedRows"] == 0
    assert result["errors"] == [
        {"row": index, "code": "source_record_key_conflict"} for index in range(1, 4)
    ]
    assert len(repository.conn.sales) == 1
    assert str(repository.conn.sales[0]["quantity"]) == "2"


def test_request_duplicates_reject_reused_keys_and_keep_distinct_identical_sales(repository):
    result = repository.create_sales_import(owner(), payload([
        row(" record-1 "), row("record-1", quantity="2.000"), row("record-1", quantity="3"),
        row("record-2"), row(""), row(None),
    ]))
    assert (result["totalRows"], result["acceptedRows"], result["rejectedRows"]) == (6, 4, 2)
    assert result["errors"] == [
        {"row": 2, "code": "duplicate_source_record_key"},
        {"row": 3, "code": "source_record_key_conflict"},
    ]
    assert [sale["source_record_key"] for sale in repository.conn.sales] == [
        "record-1", "record-2", None, None,
    ]
    assert [sale["source_row_number"] for sale in repository.conn.sales] == [1, 4, 5, 6]


def test_source_record_keys_and_batches_are_scoped_to_business(repository):
    data = payload([row("shared-source-key")])
    first = repository.create_sales_import(owner("store-1"), data)
    second = repository.create_sales_import(owner("store-2"), data)
    assert first["acceptedRows"] == second["acceptedRows"] == 1
    assert [sale["product_id"] for sale in repository.conn.sales] == [PRODUCT_ID, OTHER_PRODUCT_ID]


@pytest.mark.parametrize("keys", [(None, None), ("sale-1", "sale-2")])
def test_batch_retries_ignore_order_sku_whitespace_and_decimal_spelling(repository, keys):
    repository.create_sales_import(owner(), payload([
        row(keys[0]), row(keys[1], saleDate="2026-01-02", quantity="3"),
    ]))
    with pytest.raises(HTTPException) as duplicate:
        repository.create_sales_import(owner(), payload([
            row(keys[1], sku=" TEST-1 ", saleDate="2026-01-02", quantity="3.000"),
            row(keys[0], sku="TEST-1", quantity="2.0"),
        ]))
    assert duplicate.value.status_code == 409
    assert len(repository.conn.sales) == 2
    assert len(repository.conn.batches) == 1


def test_batch_fingerprint_preserves_row_multiplicity(repository):
    single = repository.create_sales_import(owner(), payload([row(None)]))
    double = repository.create_sales_import(owner(), payload([row(None), row(None)]))
    assert single["contentSha256"] != double["contentSha256"]
    assert double["acceptedRows"] == 2
    assert len(repository.conn.sales) == 3


def test_legacy_exact_batch_digest_still_rejects_retry(repository):
    data = payload([row(None)])
    legacy_digest = hashlib.sha256(json.dumps(
        {"source": data.source, "rows": [item.model_dump(mode="json") for item in data.rows]},
        sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    repository.conn.batches.append({
        "id": "legacy-batch", "business_id": "store-1", "content_sha256": legacy_digest,
        "rejected_rows": 0,
    })
    with pytest.raises(HTTPException) as duplicate:
        repository.create_sales_import(owner(), data)
    assert duplicate.value.status_code == 409
    assert "legacy-batch" in duplicate.value.detail
    assert not repository.conn.sales


def test_legacy_key_whitespace_is_normalized_without_rewriting_saved_sales(repository):
    repository.create_sales_import(owner(), payload([row("record-1")]))
    repository.conn.sales[0]["source_record_key"] = " \t record-1 \n"
    result = repository.create_sales_import(owner(), payload([
        row("record-1"), row("record-2"),
    ]))
    assert result["acceptedRows"] == result["rejectedRows"] == 1
    assert repository.conn.sales[0]["source_record_key"] == " \t record-1 \n"


def test_keyed_partial_retry_accepts_corrected_unknown_sku_and_skips_prior_success(repository):
    data = payload([row("record-1"), row("record-2", sku="LATER")])
    first = repository.create_sales_import(owner(), data)
    assert first["errors"] == [{"row": 2, "code": "unknown_sku", "sku": "LATER"}]
    repository.conn.products.append({"business_id": "store-1", "id": OTHER_PRODUCT_ID, "sku": "later"})
    retried = repository.create_sales_import(owner(), data)
    assert (retried["acceptedRows"], retried["rejectedRows"]) == (1, 1)
    assert retried["errors"] == [{"row": 1, "code": "duplicate_source_record_key"}]
    assert [sale["source_record_key"] for sale in repository.conn.sales] == ["record-1", "record-2"]


def test_unkeyed_partial_retry_keeps_batch_guard(repository):
    data = payload([row(None), row("record-2", sku="LATER")])
    repository.create_sales_import(owner(), data)
    with pytest.raises(HTTPException) as duplicate:
        repository.create_sales_import(owner(), data)
    assert duplicate.value.status_code == 409
    assert len(repository.conn.sales) == 1



def test_fully_accepted_keyed_retry_restores_batch_guard_after_initial_all_rejection(repository):
    data = payload([row("record-1", sku="LATER")])
    first = repository.create_sales_import(owner(), data)
    assert (first["acceptedRows"], first["rejectedRows"]) == (0, 1)
    repository.conn.products.append({"business_id": "store-1", "id": OTHER_PRODUCT_ID, "sku": "later"})
    corrected = repository.create_sales_import(owner(), data)
    assert (corrected["acceptedRows"], corrected["rejectedRows"]) == (1, 0)
    with pytest.raises(HTTPException) as duplicate:
        repository.create_sales_import(owner(), data)
    assert duplicate.value.status_code == 409
    assert len(repository.conn.sales) == 1



def add_case_distinct_products(repository):
    repository.conn.products[0]["sku"] = "Widget"
    repository.conn.products.append({
        "business_id": "store-1", "id": OTHER_PRODUCT_ID, "sku": "WIDGET",
    })


def test_case_distinct_exact_skus_import_into_their_own_products(repository):
    add_case_distinct_products(repository)
    result = repository.create_sales_import(owner(), payload([
        row("sale-1", sku=" Widget "), row("sale-2", sku="WIDGET"),
        row("sale-3", sku="widget"),
    ]))
    assert (result["acceptedRows"], result["rejectedRows"]) == (2, 1)
    assert result["errors"] == [{"row": 3, "code": "ambiguous_sku", "sku": "widget"}]
    assert [sale["product_id"] for sale in repository.conn.sales] == [PRODUCT_ID, OTHER_PRODUCT_ID]


def test_case_distinct_exact_skus_do_not_collide_in_whole_batch_fingerprints(repository):
    add_case_distinct_products(repository)
    first = repository.create_sales_import(owner(), payload([row(None, sku="Widget")]))
    second = repository.create_sales_import(owner(), payload([row(None, sku="WIDGET")]))
    assert first["acceptedRows"] == second["acceptedRows"] == 1
    assert first["contentSha256"] != second["contentSha256"]
    assert [sale["product_id"] for sale in repository.conn.sales] == [PRODUCT_ID, OTHER_PRODUCT_ID]
    with pytest.raises(HTTPException) as duplicate:
        repository.create_sales_import(owner(), payload([row(None, sku=" Widget ", quantity="2.000")]))
    assert duplicate.value.status_code == 409


def test_source_record_key_cannot_move_between_case_distinct_products(repository):
    add_case_distinct_products(repository)
    repository.create_sales_import(owner(), payload([row("sale-1", sku="Widget")]))
    result = repository.create_sales_import(owner(), payload([row("sale-1", sku="WIDGET")]))
    assert (result["acceptedRows"], result["rejectedRows"]) == (0, 1)
    assert result["errors"] == [{"row": 1, "code": "source_record_key_conflict"}]
    assert repository.conn.sales[0]["product_id"] == PRODUCT_ID



def test_fingerprint_does_not_change_identity_when_case_distinct_product_is_added(repository):
    repository.conn.products[0]["sku"] = "ABC"
    first = repository.create_sales_import(owner(), payload([row(None, sku="ABC")]))
    repository.conn.products.append({
        "business_id": "store-1", "id": OTHER_PRODUCT_ID, "sku": "abc",
    })
    second = repository.create_sales_import(owner(), payload([row(None, sku="abc")]))
    assert first["acceptedRows"] == second["acceptedRows"] == 1
    assert first["contentSha256"] != second["contentSha256"]
    assert [sale["product_id"] for sale in repository.conn.sales] == [PRODUCT_ID, OTHER_PRODUCT_ID]
