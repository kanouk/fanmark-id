import { describe, expect, it } from "vitest";
import {
  LICENSE_EXPIRY_DAILY_CRON,
  NOTIFICATION_ARCHIVE_DAILY_CRON,
  NOTIFICATION_PROCESSOR_CRON,
  selectScheduledJobs,
} from "../src/scheduled-dispatch";

describe("scheduled Worker job routing", () => {
  it("keeps notification and Stripe dispatch on the every-minute trigger", () => {
    expect(selectScheduledJobs(NOTIFICATION_PROCESSOR_CRON, {})).toEqual([
      "notification-events",
      "stripe-webhook-dispatch",
    ]);
  });

  it("does not select notification polling when the durable alarm backend is enabled", () => {
    expect(selectScheduledJobs(NOTIFICATION_PROCESSOR_CRON, { NOTIFICATION_WAKE_BACKEND: "durable-object" }))
      .toEqual(["stripe-webhook-dispatch"]);
  });

  it("runs license expiry only on the daily UTC trigger by default", () => {
    expect(selectScheduledJobs(LICENSE_EXPIRY_DAILY_CRON, {})).toEqual(["license-expiry"]);
    expect(selectScheduledJobs(NOTIFICATION_PROCESSOR_CRON, {})).not.toContain("license-expiry");
  });

  it("keeps notification archival disabled until the D1 backend is explicitly selected", () => {
    expect(selectScheduledJobs(NOTIFICATION_ARCHIVE_DAILY_CRON, {})).not.toContain("notification-archive");
    expect(selectScheduledJobs(NOTIFICATION_ARCHIVE_DAILY_CRON, {
      NOTIFICATION_ARCHIVE_BACKEND: "supabase",
    })).not.toContain("notification-archive");
    expect(selectScheduledJobs(NOTIFICATION_ARCHIVE_DAILY_CRON, {
      NOTIFICATION_ARCHIVE_BACKEND: "d1",
    })).toContain("notification-archive");
  });

  it("allows an explicitly selected synthetic test schedule and ignores unrelated triggers", () => {
    expect(selectScheduledJobs(NOTIFICATION_PROCESSOR_CRON, {
      LICENSE_EXPIRY_CRON: NOTIFICATION_PROCESSOR_CRON,
    })).toEqual(["license-expiry", "notification-events", "stripe-webhook-dispatch"]);
    expect(selectScheduledJobs("15 * * * *", {})).toEqual([]);
  });

  it("selects broadcast snapshots only when both D1 delivery selectors are explicit", () => {
    expect(selectScheduledJobs(NOTIFICATION_PROCESSOR_CRON, {
      BROADCAST_EMAIL_BACKEND: "d1",
    })).not.toContain("broadcast-email-delivery");
    expect(selectScheduledJobs(NOTIFICATION_PROCESSOR_CRON, {
      BROADCAST_SEND_BACKEND: "d1",
    })).not.toContain("broadcast-email-delivery");
    expect(selectScheduledJobs(NOTIFICATION_PROCESSOR_CRON, {
      BROADCAST_EMAIL_BACKEND: "d1",
      BROADCAST_SEND_BACKEND: "d1",
    })).toContain("broadcast-email-delivery");
  });
});
