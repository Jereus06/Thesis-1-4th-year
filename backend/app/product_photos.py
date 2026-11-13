"""One private, normalized product photo per business/product, approved by the owner."""

from io import BytesIO
import warnings
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from PIL import Image, ImageOps, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from .security import Principal

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
MAX_STORED_BYTES = 1024 * 1024
MAX_PIXELS = 25_000_000


def normalize_photo(data: bytes) -> bytes:
    if not data:
        raise HTTPException(422, "Choose a JPEG, PNG or WebP photo.")
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Choose a photo of 5 MB or less.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(data), formats=["JPEG", "PNG", "WEBP"]) as image:
                if image.width * image.height > MAX_PIXELS or getattr(image, "n_frames", 1) != 1:
                    raise HTTPException(422, "Choose a still photo no larger than 25 megapixels.")
                image.verify()
            with Image.open(BytesIO(data), formats=["JPEG", "PNG", "WEBP"]) as image:
                oriented = ImageOps.exif_transpose(image)
                oriented.thumbnail((960, 960), Image.Resampling.LANCZOS)
                rgba = oriented.convert("RGBA")
                # Fresh pixels omit original EXIF, location, profiles and filename metadata.
                clean = Image.frombytes("RGBA", rgba.size, rgba.tobytes())
                output = BytesIO()
                clean.save(output, format="WEBP", quality=82, method=4, exif=b"")
                result = output.getvalue()
                if len(result) > MAX_STORED_BYTES:
                    raise HTTPException(422, "This photo is too large after resizing. Choose a smaller photo.")
                return result
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "This file is not a readable JPEG, PNG or WebP photo.") from None


class PhotoRepository:
    def __init__(self, conn):
        self.conn = conn

    def list(self, business_id):
        rows = self.conn.execute(
            "SELECT product_id,updated_at FROM product_photos WHERE business_id=%s ORDER BY product_id",
            (business_id,),
        ).fetchall()
        return [{"productId": str(row["product_id"]), "updatedAt": row["updated_at"].isoformat()} for row in rows]

    def get(self, business_id, product_id):
        row = self.conn.execute(
            "SELECT image_bytes,content_type FROM product_photos WHERE business_id=%s AND product_id=%s",
            (business_id, product_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Product photo not found")
        return bytes(row["image_bytes"]), row["content_type"]

    def _lock_product(self, business_id, product_id):
        # Match product/import/deletion lock order; a deleted product cannot gain an orphan photo.
        self.conn.execute("SELECT id FROM businesses WHERE id=%s FOR UPDATE", (business_id,))
        product = self.conn.execute(
            "SELECT id FROM products WHERE business_id=%s AND id=%s FOR UPDATE",
            (business_id, product_id),
        ).fetchone()
        if not product:
            raise HTTPException(404, "Product not found")

    def save(self, business_id, product_id, image):
        with self.conn.transaction():
            self._lock_product(business_id, product_id)
            row = self.conn.execute(
                """INSERT INTO product_photos(business_id,product_id,image_bytes)
                   VALUES(%s,%s,%s) ON CONFLICT(business_id,product_id)
                   DO UPDATE SET image_bytes=EXCLUDED.image_bytes,updated_at=clock_timestamp()
                   RETURNING updated_at""",
                (business_id, product_id, image),
            ).fetchone()
        return {"productId": str(product_id), "updatedAt": row["updated_at"].isoformat()}

    def delete(self, business_id, product_id):
        with self.conn.transaction():
            self._lock_product(business_id, product_id)
            row = self.conn.execute(
                "DELETE FROM product_photos WHERE business_id=%s AND product_id=%s RETURNING product_id",
                (business_id, product_id),
            ).fetchone()
        return {"deleted": row is not None}


def create_product_photo_router(repo_dependency, principal_dependency, csrf_dependency):
    router = APIRouter(prefix="/api/v1")

    def scope(business_id, user, write=False):
        if user.business_id != business_id:
            raise HTTPException(403, "You do not belong to this business")
        if write and user.role != "owner":
            raise HTTPException(403, "Owner role required")

    @router.get("/businesses/{business_id}/product-photos")
    def list_photos(business_id: str, repository=Depends(repo_dependency), user: Principal=Depends(principal_dependency)):
        scope(business_id, user)
        return {"data": PhotoRepository(repository.conn).list(business_id)}

    @router.get("/businesses/{business_id}/products/{product_id}/photo")
    def get_photo(business_id: str, product_id: UUID, repository=Depends(repo_dependency), user: Principal=Depends(principal_dependency)):
        scope(business_id, user)
        image, content_type = PhotoRepository(repository.conn).get(business_id, product_id)
        return Response(image, media_type=content_type, headers={"Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff"})

    @router.put("/businesses/{business_id}/products/{product_id}/photo")
    async def put_photo(business_id: str, product_id: UUID, request: Request, repository=Depends(repo_dependency), user: Principal=Depends(csrf_dependency)):
        scope(business_id, user, write=True)
        data = bytearray()
        async for chunk in request.stream():
            data.extend(chunk)
            if len(data) > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Choose a photo of 5 MB or less.")
        image = await run_in_threadpool(normalize_photo, bytes(data))
        result = await run_in_threadpool(PhotoRepository(repository.conn).save, business_id, product_id, image)
        return {"data": result}

    @router.delete("/businesses/{business_id}/products/{product_id}/photo")
    def delete_photo(business_id: str, product_id: UUID, repository=Depends(repo_dependency), user: Principal=Depends(csrf_dependency)):
        scope(business_id, user, write=True)
        return {"data": PhotoRepository(repository.conn).delete(business_id, product_id)}

    return router
