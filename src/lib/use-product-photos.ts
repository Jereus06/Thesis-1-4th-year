import { useEffect, useRef, useState } from "react";
import { api, type SessionUser } from "./api";
import { demoPhoto, readDemoPhotos, writeDemoPhotos, type ProductPhotos } from "./product-photos";
import { useAppStore } from "./store";

type Snapshot = {
  session: SessionUser | null;
  mode: string;
  photos: ProductPhotos;
  error?: string;
};
export function useProductPhotos() {
  const session = useAppStore((state) => state.session);
  const mode = useAppStore((state) => state.dataMode);
  const [snapshot, setSnapshot] = useState<Snapshot>(() => ({
    session,
    mode,
    photos: mode === "browser-demo" ? readDemoPhotos() : {},
  }));
  const sequence = useRef(0);
  const current = () =>
    useAppStore.getState().session === session && useAppStore.getState().dataMode === mode;
  const photos = snapshot.session === session && snapshot.mode === mode ? snapshot.photos : {};
  useEffect(() => {
    if (mode === "browser-demo") {
      const reset = () => setSnapshot({ session, mode, photos: readDemoPhotos() });
      reset();
      window.addEventListener("stockcast-demo-photos-reset", reset);
      return () => window.removeEventListener("stockcast-demo-photos-reset", reset);
    }
    if (mode !== "api" || !session) return;
    let cancelled = false;
    const load = async () => {
      const version = ++sequence.current;
      try {
        const rows = await api.productPhotos(session.businessId);
        if (
          !cancelled &&
          version === sequence.current &&
          useAppStore.getState().session === session
        )
          setSnapshot({
            session,
            mode,
            photos: Object.fromEntries(
              rows.map((row) => [
                row.productId,
                {
                  src: api.productPhotoUrl(session.businessId, row.productId, row.updatedAt),
                  updatedAt: row.updatedAt,
                },
              ]),
            ),
          });
      } catch {
        if (
          !cancelled &&
          version === sequence.current &&
          useAppStore.getState().session === session
        )
          setSnapshot((previous) => ({
            session,
            mode,
            photos: previous.session === session ? previous.photos : {},
            error: "Product photos could not be loaded. The API may need the photo update.",
          }));
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [mode, session]);
  async function save(productId: string, file: File) {
    if (!current()) throw new Error("Your account changed. Open the photo again.");
    sequence.current++;
    let photo;
    if (mode === "browser-demo") {
      photo = { src: await demoPhoto(file), updatedAt: new Date().toISOString() };
      writeDemoPhotos({ ...readDemoPhotos(), [productId]: photo });
    } else {
      if (!session || session.role !== "owner")
        throw new Error("Only an owner can change product photos.");
      const row = await api.saveProductPhoto(session.businessId, productId, file);
      photo = {
        src: api.productPhotoUrl(session.businessId, productId, row.updatedAt),
        updatedAt: row.updatedAt,
      };
    }
    if (!current()) throw new Error("Your account changed. Reload the product photos.");
    sequence.current++;
    setSnapshot((previous) => ({
      session,
      mode,
      photos: { ...(previous.session === session ? previous.photos : {}), [productId]: photo },
    }));
  }
  async function remove(productId: string) {
    if (!current()) throw new Error("Your account changed. Open the photo again.");
    sequence.current++;
    if (mode === "browser-demo") {
      const saved = readDemoPhotos();
      delete saved[productId];
      writeDemoPhotos(saved);
    } else {
      if (!session || session.role !== "owner")
        throw new Error("Only an owner can change product photos.");
      await api.deleteProductPhoto(session.businessId, productId);
    }
    if (!current()) throw new Error("Your account changed. Reload the product photos.");
    sequence.current++;
    setSnapshot((previous) => {
      const next = { ...(previous.session === session ? previous.photos : {}) };
      delete next[productId];
      return { session, mode, photos: next };
    });
  }
  return { photos, error: snapshot.session === session ? snapshot.error : undefined, save, remove };
}
