"""Synthetic photos only: decoding, authorization and durable PostgreSQL storage."""

from io import BytesIO
from types import SimpleNamespace
from uuid import uuid4

import psycopg
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient
from PIL import Image

from app.product_photos import MAX_UPLOAD_BYTES, normalize_photo
from app.security import Principal, token_hash
from test_postgres_integration import fresh_auth_limiter, pg_client  # noqa: F401


def photo(fmt="PNG", size=(40, 20), color="green", **options):
    output = BytesIO()
    Image.new("RGB", size, color).save(output, format=fmt, **options)
    return output.getvalue()


@pytest.mark.parametrize("fmt", ["JPEG", "PNG", "WEBP"])
def test_normalize_photo_resizes_and_encodes_supported_formats(fmt):
    result = normalize_photo(photo(fmt, (1920, 960)))
    with Image.open(BytesIO(result)) as image:
        assert image.format == "WEBP"
        assert image.size == (960, 480)
        image.load()
    assert 0 < len(result) <= 1024 * 1024


def test_normalize_photo_applies_orientation_and_strips_metadata():
    exif = Image.Exif()
    exif[274] = 6
    exif[270] = "Synthetic private metadata"
    result = normalize_photo(photo("JPEG", exif=exif))
    with Image.open(BytesIO(result)) as image:
        assert image.size == (20, 40)
        assert not image.getexif()
        assert "icc_profile" not in image.info
    assert b"Synthetic private metadata" not in result


@pytest.mark.parametrize("data", [b"", b"<svg><script/></svg>", b"not an image", b"\x89PNG\r\n\x1a\n", photo("GIF")])
def test_normalize_photo_rejects_corrupt_or_unsupported_content(data):
    with pytest.raises(HTTPException) as exc:
        normalize_photo(data)
    assert exc.value.status_code == 422


def test_normalize_photo_rejects_oversize_upload_and_pixels(monkeypatch):
    with pytest.raises(HTTPException) as exc:
        normalize_photo(b"x" * (MAX_UPLOAD_BYTES + 1))
    assert exc.value.status_code == 413
    monkeypatch.setattr("app.product_photos.MAX_PIXELS", 100)
    with pytest.raises(HTTPException) as exc:
        normalize_photo(photo())
    assert exc.value.status_code == 422


def test_normalize_photo_rejects_animation():
    output = BytesIO()
    Image.new("RGB", (10, 10), "red").save(
        output, format="WEBP", save_all=True,
        append_images=[Image.new("RGB", (10, 10), "blue")], duration=100, loop=0,
    )
    with pytest.raises(HTTPException) as exc:
        normalize_photo(output.getvalue())
    assert exc.value.status_code == 422


@pytest.fixture()
def photo_api(monkeypatch):
    from app.main import app, current_session, repo
    from app import product_photos

    class Photos:
        def __init__(self, _conn):
            pass

        def list(self, business):
            return [{"productId": str(product), "updatedAt": "2026-11-13T00:00:00+00:00"}]

        def get(self, business, product_id):
            if product_id not in saved:
                raise HTTPException(404, "Product photo not found")
            return saved[product_id], "image/webp"

        def save(self, business, product_id, image):
            saved[product_id] = image
            return self.list(business)[0]

        def delete(self, business, product_id):
            return {"deleted": saved.pop(product_id, None) is not None}

    saved = {}
    product = uuid4()
    user = Principal("owner", "photo-store", "owner@example.test", "Synthetic owner", "owner")
    csrf = "synthetic-photo-csrf"
    previous = dict(app.dependency_overrides)
    monkeypatch.setattr(product_photos, "PhotoRepository", Photos)
    app.dependency_overrides[repo] = lambda: SimpleNamespace(conn=None)
    app.dependency_overrides[current_session] = lambda: (user, token_hash(csrf))
    client = TestClient(app, cookies={"stockcast_csrf": csrf}, headers={"X-CSRF-Token": csrf})
    try:
        yield client, user, f"/api/v1/businesses/photo-store/products/{product}/photo", saved
    finally:
        client.close()
        app.dependency_overrides.clear()
        app.dependency_overrides.update(previous)


def test_photo_routes_validate_bytes_and_enforce_scope_owner_csrf(photo_api):
    client, user, path, saved = photo_api
    assert client.put(path, content=b"spoof", headers={"Content-Type": "image/png"}).status_code == 422
    assert client.put(path, content=b"x" * (MAX_UPLOAD_BYTES + 1)).status_code == 413
    assert not saved
    response = client.put(path, content=photo())
    assert response.status_code == 200, response.text
    assert len(saved) == 1
    result = client.get(path)
    assert result.status_code == 200
    assert result.headers["content-type"] == "image/webp"
    assert result.headers["cache-control"] == "private, no-store"
    assert result.headers["x-content-type-options"] == "nosniff"
    assert result.content == next(iter(saved.values()))
    assert client.get("/api/v1/businesses/photo-store/product-photos").status_code == 200
    for method in [client.put, client.delete]:
        assert method(path, headers={"X-CSRF-Token": "wrong"}).status_code == 403
        assert method(path.replace("photo-store", "other-store")).status_code == 403
    assert client.get(path.replace("photo-store", "other-store")).status_code == 403
    object.__setattr__(user, "role", "staff")
    assert client.get(path).status_code == 200
    assert client.get("/api/v1/businesses/photo-store/product-photos").status_code == 200
    assert client.put(path, content=photo()).status_code == 403
    assert client.delete(path).status_code == 403
    object.__setattr__(user, "role", "owner")
    assert client.delete(path).json() == {"data": {"deleted": True}}
    assert client.delete(path).json() == {"data": {"deleted": False}}
    assert client.get(path).status_code == 404


def insert_product(conn, business):
    return conn.execute(
        """INSERT INTO products(business_id,sku,name,category,unit)
           VALUES(%s,'PHOTO','Synthetic photo product','Test','piece') RETURNING id,updated_at""",
        (business,),
    ).fetchone()


def test_photo_postgres_replace_reload_remove_without_touching_product(pg_client):
    client, business, dsn = pg_client
    with psycopg.connect(dsn) as conn:
        product, revision = insert_product(conn, business)
    base = f"/api/v1/businesses/{business}"
    path = base + f"/products/{product}/photo"
    assert client.get(base + "/product-photos").json() == {"data": []}
    first = client.put(path, content=photo()).json()["data"]
    assert first["productId"] == str(product)
    assert client.get(path).content == normalize_photo(photo())
    second = client.put(path, content=photo(color="blue")).json()["data"]
    assert second["updatedAt"] > first["updatedAt"]
    assert client.get(base + "/product-photos").json() == {"data": [second]}
    with psycopg.connect(dsn) as conn:
        stored, count = conn.execute(
            "SELECT image_bytes,(SELECT count(*) FROM product_photos) FROM product_photos"
        ).fetchone()
        assert count == 1
        assert bytes(stored) == normalize_photo(photo(color="blue"))
        assert conn.execute("SELECT updated_at FROM products WHERE id=%s", (product,)).fetchone()[0] == revision
        assert conn.execute("SELECT count(*) FROM inventory_movements").fetchone()[0] == 0
        assert conn.execute("SELECT count(*) FROM forecast_runs").fetchone()[0] == 0
    assert client.delete(path).json()["data"]["deleted"] is True
    assert client.delete(path).json()["data"]["deleted"] is False
    assert client.get(path).status_code == 404
    assert client.put(path.replace(str(product), str(uuid4())), content=photo()).status_code == 404


def test_photo_postgres_constraints_tenant_and_cascade(pg_client):
    client, business, dsn = pg_client
    with psycopg.connect(dsn) as conn:
        product, _revision = insert_product(conn, business)
        other = conn.execute("INSERT INTO businesses(name,data_origin) VALUES('Other synthetic','demo') RETURNING id").fetchone()[0]
    path = f"/api/v1/businesses/{business}/products/{product}/photo"
    assert client.put(path, content=photo()).status_code == 200
    assert client.get(path.replace(business, str(other))).status_code == 403
    assert client.put(path.replace(business, str(other)), content=photo()).status_code == 403
    with psycopg.connect(dsn) as conn:
        for invalid in [b"", b"x" * (1024 * 1024 + 1)]:
            with pytest.raises(psycopg.errors.CheckViolation), conn.transaction():
                conn.execute("UPDATE product_photos SET image_bytes=%s", (invalid,))
        with pytest.raises(psycopg.errors.ForeignKeyViolation), conn.transaction():
            conn.execute("INSERT INTO product_photos(business_id,product_id,image_bytes) VALUES(%s,%s,%s)", (other, product, b"x"))
        conn.execute("DELETE FROM products WHERE id=%s", (product,))
        assert conn.execute("SELECT count(*) FROM product_photos").fetchone()[0] == 0

