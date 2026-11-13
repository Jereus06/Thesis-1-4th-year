import { useEffect, useRef, useState } from "react";
import { Camera, Upload } from "lucide-react";
import { Button } from "./ui/button";
import { useAppStore } from "@/lib/store";
import { validatePhotoFile, type ProductPhoto } from "@/lib/product-photos";
import { ProductCamera } from "./product-camera";
import type { Product } from "@/lib/types";

export function ProductPhotoForm({
  product,
  photo,
  save,
  remove,
  onDone,
  onPendingChange,
}: {
  product: Product;
  photo?: ProductPhoto;
  save: (id: string, file: File) => Promise<void>;
  remove: (id: string) => Promise<void>;
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const session = useAppStore((state) => state.session);
  const mode = useAppStore((state) => state.dataMode);
  const original = useRef({ session, mode });
  const upload = useRef<HTMLInputElement>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const submitting = useRef(false);
  const [file, setFile] = useState<File | null>(null),
    [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const changed = session !== original.current.session || mode !== original.current.mode;
  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function choose(selected?: File) {
    if (!selected || busy || changed) return;
    try {
      validatePhotoFile(selected);
      setCameraOpen(false);
      setFile(selected);
      setError(null);
    } catch (failure) {
      setFile(null);
      setError((failure as Error).message);
    }
  }
  async function submit(deleting = false) {
    if (submitting.current || changed || (!deleting && !file)) return;
    submitting.current = true;
    setBusy(true);
    onPendingChange(true);
    setError(null);
    try {
      if (deleting) await remove(product.id);
      else await save(product.id, file!);
      onDone();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "The photo could not be saved.");
    } finally {
      submitting.current = false;
      setBusy(false);
      onPendingChange(false);
    }
  }
  return (
    <div className="grid gap-4">
      <p className="text-sm font-medium">
        {product.name} · {product.sku}
      </p>
      {cameraOpen && !changed ? (
        <ProductCamera onCapture={choose} onClose={() => setCameraOpen(false)} />
      ) : preview || photo ? (
        <img
          src={preview ?? photo!.src}
          alt={`Photo of ${product.name}`}
          className="h-56 w-full rounded-xl bg-surface-2 object-contain"
        />
      ) : (
        <div className="flex h-40 items-center justify-center rounded-xl bg-surface-2 text-sm text-muted">
          No photo yet
        </div>
      )}
      <p className="text-xs text-muted">
        One JPEG, PNG or WebP photo, up to 5 MB. Photos are resized automatically. Take photo opens
        a live camera preview. Allow camera access when asked.
      </p>
      <input
        ref={upload}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        aria-label="Choose product photo"
        disabled={busy || changed}
        onChange={(event) => {
          choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={busy || changed}
          onClick={() => {
            setCameraOpen(false);
            upload.current?.click();
          }}
        >
          <Upload />
          Choose photo
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy || changed || cameraOpen}
          onClick={() => {
            setError(null);
            setCameraOpen(true);
          }}
        >
          <Camera />
          Take photo
        </Button>
      </div>
      {file && <p className="break-all text-xs text-muted">Selected: {file.name}</p>}
      {(error || changed) && (
        <p role="alert" className="text-sm text-danger">
          {changed ? "Your account changed. Close this window and open the photo again." : error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={!file || busy || changed || cameraOpen}
          onClick={() => void submit()}
        >
          {busy ? "Saving…" : "Save photo"}
        </Button>
        {photo && (
          <Button
            type="button"
            variant="outline"
            disabled={busy || changed || cameraOpen}
            onClick={() => void submit(true)}
          >
            Remove photo
          </Button>
        )}
        <Button type="button" variant="outline" disabled={busy} onClick={onDone}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
