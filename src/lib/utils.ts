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

  const normalised = trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed;

  const isoParsed = parseISO(normalised);
  if (isValid(isoParsed)) {
    return isoParsed;
  }

  const jsDate = new Date(trimmed);
  if (!Number.isNaN(jsDate.getTime())) {
    return jsDate;
  }

  const hasTimezone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(normalised);
  if (!hasTimezone) {
    const appendedIso = normalised.endsWith('Z') ? normalised : `${normalised}Z`;
    const appendedParsed = parseISO(appendedIso);
    if (isValid(appendedParsed)) {
      return appendedParsed;
    }
  }

  return null;
}

export function calculateRemainingDays(endDate: string): number {
  const endUTC = parseDateString(endDate);
  if (!endUTC) return 0;

  const diffTime = endUTC.getTime() - Date.now();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}
