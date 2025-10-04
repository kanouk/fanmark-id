import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { isValid, parseISO } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function parseDateString(value?: string | null): Date | null {
  if (!value) return null;

  const trimmed = value.trim();
  if (!trimmed) return null;

  const normalised = trimmed.includes(" ") ? trimmed.replace(" ", "T") : trimmed;
  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalised);
  const ensureUtc = hasTimezone ? normalised : `${normalised.endsWith("Z") ? normalised : `${normalised}Z`}`;

  const parsed = parseISO(ensureUtc);
  if (isValid(parsed)) {
    return parsed;
  }

  const jsDate = new Date(ensureUtc);
  return Number.isNaN(jsDate.getTime()) ? null : jsDate;
}

export function calculateRemainingDays(endDate: string): number {
  const endUTC = parseDateString(endDate);
  if (!endUTC) return 0;

  const diffTime = endUTC.getTime() - Date.now();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}
