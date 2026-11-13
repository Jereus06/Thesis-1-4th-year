# Product photos

The owner approved this design on 13 November 2026: one optional photo per product,
stored in PostgreSQL. Owners upload, replace or remove it; authenticated members of
the same store can view it. The existing product JSON contract is unchanged.

## Storage and API

Migration `011_product_photos` adds `product_photos`, keyed by `(business_id, product_id)`.
The composite foreign key prevents cross-store references and deletes a photo when its
product is deleted. Earlier migrations are unchanged. Normal PostgreSQL dumps include
the bytes; no separate filesystem or public object bucket is required.

| Method and path under `/api/v1/businesses/{business_id}` | Behavior                                                                                                |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /product-photos`                                    | Store members read photo metadata: `productId`, `updatedAt`.                                            |
| `GET /products/{product_id}/photo`                       | Store members read private WebP bytes; missing photos return 404.                                       |
| `PUT /products/{product_id}/photo`                       | Owner uploads raw image bytes with the existing CSRF cookie/header. Replaces the single existing photo. |
| `DELETE /products/{product_id}/photo`                    | Owner removes the photo with CSRF protection; repeating removal returns `deleted: false`.               |

JSON responses use the existing `{ "data": ... }` envelope. Reads enforce business
membership; writes additionally enforce the owner role. Photo responses use
`Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
Writes lock the business before the product, matching existing catalog operations.
They change neither product revisions nor inventory, sales, forecast inputs or saved results.

## Image handling

Uploads accept still JPEG, PNG and WebP images up to 5 MiB and 25 million pixels.
The server decodes the actual bytes, verifies the image, applies EXIF orientation,
resizes within 960 × 960 pixels, and stores newly encoded WebP pixels up to 1 MiB.
Original filenames, EXIF/location metadata and color profiles are not stored.
Unsupported/corrupt/animated images return 422; oversized uploads return 413.
Pillow is declared in the backend package and pinned in the requirements lock file.
Implementation follows Pillow's [image API](https://pillow.readthedocs.io/en/stable/reference/Image.html)
and [security guidance](https://pillow.readthedocs.io/en/stable/handbook/security.html).

## Browser behavior

In Inventory → Products, create or import a product first, then open its category
and choose **Add photo**. The dialog provides a file picker, preview, **Take photo**,
replacement and removal. **Choose photo** opens the file picker. **Take photo** requests
a live camera preview through `getUserMedia`, with no microphone access. It prefers a
rear camera on phones and accepts an available desktop webcam. A camera selector appears
when the browser exposes multiple video devices. The inline, muted video supports mobile
playback; **Capture photo** creates a JPEG within 960 pixels for preview and the existing
explicit Save photo flow. Starting a camera never silently opens a file picker.

Camera tracks stop after capture/cancel, dialog closure, account changes, switching cameras,
choosing a file or leaving the visible page. Late permission responses are immediately stopped.
Permission denial, missing/busy hardware, unsupported browsers and insecure addresses show
actionable messages while keeping file upload available. Supported file formats remain explicit.
Failed saves keep the selected file for retry. Account changes invalidate an open editor.
Metadata reloads on mount and every 30 seconds; late responses cannot overwrite a newer
local photo save or another account's visible state.

Live camera access requires a secure browser context and user permission. Desktop `localhost`
is supported; a phone opening the PC's plain-HTTP local-network address must instead use a
trusted HTTPS address. Existing [hosting instructions](../../docs/SETUP_AND_OPERATIONS.md#configuration-and-hosting)
describe the Caddy/domain configuration. The implementation follows the
[getUserMedia contract](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
and WebKit's [inline muted video guidance](https://webkit.org/blog/6784/new-video-policies-for-ios/).
The former file-input `capture` hint could open desktop File Manager, as documented in the
[capture reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/capture).
Physical camera/browser testing remains separate from automated fake-device checks.

The optional browser demonstration stores resized photos in a separate local-storage
key. It does not send them to PostgreSQL. Explicit Reset demo clears those demo photos;
ordinary startup and code updates do not reset them. Browser storage quota errors remain
visible instead of being reported as successful saves.

Apply migration 011 and rebuild the API/worker images with the updated lock file before
using photos in an installation. Rebuild the frontend for the new controls. `npm start`
is the normal project startup/rebuild path. No running installation was changed merely
by source verification.
