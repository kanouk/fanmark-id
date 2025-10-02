import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function calculateRemainingDays(endDate: string): number {
  // Parse endDate as UTC by appending 'Z' if not already present
  const endDateStr = endDate.endsWith('Z') ? endDate : endDate + 'Z';
  const endUTC = new Date(endDateStr);
  const nowUTC = new Date(); // Current time in UTC
  const diffTime = endUTC.getTime() - nowUTC.getTime();
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return Math.max(0, diffDays);
}
