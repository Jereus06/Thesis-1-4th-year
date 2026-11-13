import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Button } from "./ui/button";
import { Select } from "./ui/select";

function stopCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

function cameraError(failure: unknown): string {
  const name = failure instanceof Error ? failure.name : "";
  if (name === "NotAllowedError" || name === "PermissionDeniedError" || name === "SecurityError")
    return "Camera access is blocked. Allow camera access in your browser or device settings, then try again. You can also choose a photo.";
  if (name === "NotFoundError" || name === "DevicesNotFoundError")
    return "No camera was found. Connect a webcam or choose a photo.";
  if (name === "NotReadableError" || name === "TrackStartError" || name === "AbortError")
    return "The camera could not start. Close other apps using it, then try again or choose a photo.";
  return "The camera could not open. Try again or choose a photo.";
}

export function ProductCamera({
  onCapture,
  onClose,
}: {
  onCapture: (file: File) => void;
  onClose: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const request = useRef({ version: 0 });
  const [device, setDevice] = useState("");
  const [activeDevice, setActiveDevice] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<"starting" | "ready" | "error">("starting");
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    const lifecycle = request.current;
    const version = ++lifecycle.version;
    const element = video.current;
    let stream: MediaStream | null = null;
    const current = () => lifecycle.version === version;
    setStatus("starting");
    setError(null);
    setCapturing(false);
    const open = async () => {
      if (!window.isSecureContext) {
        setStatus("error");
        setError(
          "Live camera needs a secure HTTPS address on phones. Open StockCast over HTTPS, or choose a photo. Desktop localhost also supports the camera.",
        );
        return;
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error");
        setError(
          "Live camera is unavailable in this browser. Open StockCast in an updated browser or choose a photo.",
        );
        return;
      }
      try {
        const opened = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            ...(device
              ? { deviceId: { exact: device } }
              : { facingMode: { ideal: "environment" } }),
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
        });
        if (!current()) {
          stopCamera(opened);
          return;
        }
        stream = opened;
        if (!element) throw new Error("Camera preview unavailable");
        element.srcObject = opened;
        await element.play();
        if (!current()) return;
        setActiveDevice(opened.getVideoTracks()[0]?.getSettings().deviceId ?? "");
        setStatus("ready");
        opened.getVideoTracks().forEach((track) => {
          track.onended = () => {
            if (!current()) return;
            setStatus("error");
            setError("The camera stopped. Try again or choose a photo.");
          };
        });
        try {
          const available = await navigator.mediaDevices.enumerateDevices();
          if (current())
            setDevices(available.filter((item) => item.kind === "videoinput" && item.deviceId));
        } catch {
          // A working default camera remains usable when device enumeration is unavailable.
        }
      } catch (failure) {
        stopCamera(stream);
        if (!current()) return;
        setStatus("error");
        setError(cameraError(failure));
      }
    };
    const pause = () => {
      if (!document.hidden || !current()) return;
      lifecycle.version++;
      stopCamera(stream);
      setStatus("error");
      setError("The camera paused when you left the page. Try again to reopen it.");
    };
    document.addEventListener("visibilitychange", pause);
    void open();
    return () => {
      lifecycle.version++;
      document.removeEventListener("visibilitychange", pause);
      stopCamera(stream);
      if (element) element.srcObject = null;
    };
  }, [device, attempt]);

  async function capture() {
    const element = video.current;
    if (capturing || status !== "ready" || !element) return;
    const version = request.current.version;
    if (!element.videoWidth || !element.videoHeight || element.readyState < 2) {
      setError("Wait for the camera preview, then capture the photo.");
      return;
    }
    setCapturing(true);
    setError(null);
    try {
      const scale = Math.min(1, 960 / Math.max(element.videoWidth, element.videoHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(element.videoWidth * scale));
      canvas.height = Math.max(1, Math.round(element.videoHeight * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Camera capture unavailable");
      context.drawImage(element, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.85),
      );
      if (request.current.version !== version) return;
      if (!blob) throw new Error("Camera capture unavailable");
      onCapture(new File([blob], "product-photo.jpg", { type: "image/jpeg" }));
    } catch {
      if (request.current.version !== version) return;
      setError("The photo could not be captured. Try again or choose a photo.");
      setCapturing(false);
    }
  }

  return (
    <section className="grid gap-3" aria-label="Product camera">
      <video
        ref={video}
        autoPlay
        muted
        playsInline
        aria-label="Live camera preview"
        className="h-56 w-full rounded-xl bg-ink object-contain"
      />
      {status === "starting" && (
        <p className="text-sm text-muted" role="status">
          Opening camera… Allow camera access when your browser asks.
        </p>
      )}
      {status === "ready" && devices.length > 1 && (
        <label className="grid gap-1 text-sm">
          Camera
          <Select
            aria-label="Camera device"
            value={device || activeDevice}
            disabled={capturing}
            onChange={(event) => setDevice(event.target.value)}
          >
            {devices.map((item, index) => (
              <option key={item.deviceId} value={item.deviceId}>
                {item.label || `Camera ${index + 1}`}
              </option>
            ))}
          </Select>
        </label>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          disabled={status !== "ready" || capturing}
          onClick={() => void capture()}
        >
          <Camera />
          {capturing ? "Capturing…" : "Capture photo"}
        </Button>
        {status === "error" && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setDevice("");
              setAttempt((value) => value + 1);
            }}
          >
            Try camera again
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel camera
        </Button>
      </div>
    </section>
  );
}
