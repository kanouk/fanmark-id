import { describe, expect, it } from "vitest";
import {
  LICENSE_EXPIRY_DAILY_CRON,
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

  it("runs license expiry only on the daily UTC trigger by default", () => {
    expect(selectScheduledJobs(LICENSE_EXPIRY_DAILY_CRON, {})).toEqual(["license-expiry"]);
    expect(selectScheduledJobs(NOTIFICATION_PROCESSOR_CRON, {})).not.toContain("license-expiry");
  });

  it("allows an explicitly selected synthetic test schedule and ignores unrelated triggers", () => {
    expect(selectScheduledJobs(NOTIFICATION_PROCESSOR_CRON, {
      LICENSE_EXPIRY_CRON: NOTIFICATION_PROCESSOR_CRON,
    })).toEqual(["license-expiry", "notification-events", "stripe-webhook-dispatch"]);
    expect(selectScheduledJobs("15 * * * *", {})).toEqual([]);
  });
});
