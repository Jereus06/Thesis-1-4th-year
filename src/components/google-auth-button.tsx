import { Button } from "@/components/ui/button";

export function GoogleAuthButton({
  onClick,
  disabled = false,
  busy = false,
  label = "Continue with Google",
}: {
  onClick: () => void;
  disabled?: boolean;
  busy?: boolean;
  label?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="w-full gap-3"
      disabled={disabled || busy}
      aria-busy={busy}
      onClick={onClick}
    >
      <img
        src="https://developers.google.com/static/identity/images/g-logo.png"
        alt=""
        width={18}
        height={18}
        className="size-[18px]"
        referrerPolicy="no-referrer"
      />
      {busy ? "Opening Google..." : label}
    </Button>
  );
}
