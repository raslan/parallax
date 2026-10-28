import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Teach twMerge the custom micro font sizes from tailwind.config.ts so
// `cn("text-xs", "text-3xs")` resolves to the last one like any other size.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": [{ text: ["2xs", "3xs"] }] } },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
