import { parseDateString } from '@/lib/utils';

const MS_IN_DAY = 24 * 60 * 60 * 1000;

function roundUpToNextUtcMidnight(input: Date): Date {
  const copy = new Date(input);
  const isAtMidnight =
    copy.getUTCHours() === 0 &&
    copy.getUTCMinutes() === 0 &&
    copy.getUTCSeconds() === 0 &&
    copy.getUTCMilliseconds() === 0;

  if (isAtMidnight) {
    return copy;
  }

  copy.setUTCHours(0, 0, 0, 0);
  copy.setUTCDate(copy.getUTCDate() + 1);
  return copy;
}

export type DerivedLicenseStatus =
  | 'active'
  | 'grace'
  | 'grace-return'
  | 'expired';

export interface LicenseTimingInput {
  licenseEnd?: string | null;
  graceExpiresAt?: string | null;
  status?: string | null;
  gracePeriodDays?: number | null;
}

export interface LicenseTimingResult {
  status: DerivedLicenseStatus;
  now: Date;
  licenseEndDate: Date | null;
  graceExpiresDate: Date | null;
  remainingMs: number | null;
  remainingWholeDays: number | null;
}

export function deriveLicenseTiming(input: LicenseTimingInput): LicenseTimingResult {
  const now = new Date();
  const licenseEndDate = parseDateString(input.licenseEnd);
  let graceExpiresDate = parseDateString(input.graceExpiresAt);

  if (!graceExpiresDate && licenseEndDate && input.gracePeriodDays != null) {
    const fallback = new Date(licenseEndDate.getTime() + input.gracePeriodDays * MS_IN_DAY);
    graceExpiresDate = roundUpToNextUtcMidnight(fallback);
  }

  const remainingMs = licenseEndDate ? licenseEndDate.getTime() - now.getTime() : null;
  const remainingWholeDays =
    remainingMs !== null
      ? Math.floor(remainingMs / MS_IN_DAY)
      : null;

  const normalizedStatus = input.status?.toLowerCase() ?? '';
  const licenseEndTime = licenseEndDate?.getTime() ?? null;
  const graceExpiryTime = graceExpiresDate?.getTime() ?? null;
  const nowTime = now.getTime();

  let derived: DerivedLicenseStatus;

  if (normalizedStatus === 'grace') {
    if (licenseEndTime !== null && licenseEndTime > nowTime) {
      derived = 'grace-return';
    } else if (graceExpiryTime !== null && graceExpiryTime > nowTime) {
      derived = 'grace';
    } else {
      derived = 'expired';
    }
  } else if (normalizedStatus === 'active') {
    if (licenseEndTime === null || licenseEndTime > nowTime) {
      derived = 'active';
    } else if (graceExpiryTime !== null && graceExpiryTime > nowTime) {
      derived = 'grace';
    } else {
      derived = 'expired';
    }
  } else if (normalizedStatus === 'expired') {
    derived = 'expired';
  } else {
    if (licenseEndTime !== null && licenseEndTime > nowTime) {
      derived = 'active';
    } else if (graceExpiryTime !== null && graceExpiryTime > nowTime) {
      derived = 'grace';
    } else {
      derived = 'expired';
    }
  }

  return {
    status: derived,
    now,
    licenseEndDate,
    graceExpiresDate,
    remainingMs,
    remainingWholeDays,
  };
}
