"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/** Lightweight native checkbox styled with the design tokens (no radix dependency). */
export const Checkbox = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    type="checkbox"
    ref={ref}
    className={cn(
      "h-4 w-4 shrink-0 cursor-pointer rounded border-input accent-primary",
      "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
      className,
    )}
    {...props}
  />
));
Checkbox.displayName = "Checkbox";
