// Utility function to merge Tailwind class names in a type-safe way.
// - clsx handles conditional / array / object class inputs
// - tailwind-merge resolves conflicting Tailwind classes
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}