import * as React from "react";
import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-11 min-w-0 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg shadow-[inset_0_1px_2px_rgba(29,46,37,0.025)]",
        "placeholder:text-muted/80 outline-none transition-colors hover:border-primary/30",
        "focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/15 aria-invalid:border-danger",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
