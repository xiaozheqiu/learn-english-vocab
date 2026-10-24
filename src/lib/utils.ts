import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 数字转百分比文案 */
export function percent(value: number, digits = 0): string {
  if (!Number.isFinite(value)) return "0%";
  return `${(value * 100).toFixed(digits)}%`;
}
