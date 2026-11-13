import * as React from "react";
import { cn } from "@/lib/utils";

function Select({ className, children, style, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      className={cn(
        "flex h-11 min-w-0 w-full cursor-pointer appearance-none rounded-xl border border-border bg-surface py-2 pr-10 pl-3 text-sm text-fg shadow-[inset_0_1px_2px_rgba(29,46,37,0.025)]",
        "bg-[length:1rem_1rem] bg-[position:right_0.875rem_center] bg-no-repeat outline-none transition-colors",
        "hover:border-primary/30 focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-ring/15",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%235f756b' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")",
        ...style,
      }}
      {...props}
    >
      {children}
    </select>
  );
}

export { Select };
