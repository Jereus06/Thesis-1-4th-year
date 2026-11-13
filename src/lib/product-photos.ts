const KEY = "stockcast-demo-product-photos-v1";
export type ProductPhoto = { src: string; updatedAt: string };
export type ProductPhotos = Record<string, ProductPhoto>;
export function readDemoPhotos(): ProductPhotos {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return {};
    return Object.fromEntries(
      Object.entries(saved).filter((entry): entry is [string, ProductPhoto] => {
        const value = entry[1] as Partial<ProductPhoto> | null;
        return (
          !!value &&
          typeof value.src === "string" &&
          value.src.startsWith("data:image/webp;base64,") &&
          typeof value.updatedAt === "string"
        );
      }),
    );
  } catch {
    return {};
  }
}
export function writeDemoPhotos(photos: ProductPhotos) {
  localStorage.setItem(KEY, JSON.stringify(photos));
}
export function clearDemoPhotos() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* Storage can be unavailable. */
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event("stockcast-demo-photos-reset"));
}
export function validatePhotoFile(file: File) {
  if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("Choose a photo of 5 MB or less.");
  if (file.type && !["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPEG, PNG or WebP photo.");
}
export async function demoPhoto(file: File): Promise<string> {
  validatePhotoFile(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (image.naturalWidth * image.naturalHeight > 25_000_000)
      throw new Error("Choose a photo no larger than 25 megapixels.");
    const scale = Math.min(1, 960 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Photo processing is unavailable in this browser.");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/webp", 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}
