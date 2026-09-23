import * as React from "react";
import { cn } from "@/lib/utils";

function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-11 w-full rounded-lg border border-border bg-surface px-3 text-sm text-fg",
        "outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export { Select };
