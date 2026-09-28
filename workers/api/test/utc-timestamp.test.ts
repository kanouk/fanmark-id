import { describe, expect, it } from "vitest";
import { toUtcMicrosecondTimestamp } from "../src/utc-timestamp";

describe("shared D1 timestamp format", () => {
  it("pads the JavaScript millisecond clock to the fixed-width UTC representation", () => {
    expect(toUtcMicrosecondTimestamp(new Date("2026-09-28T12:34:56.123Z")))
      .toBe("2026-09-28T12:34:56.123000Z");
    expect(toUtcMicrosecondTimestamp(new Date("0001-01-01T00:00:00.001Z")))
      .toBe("0001-01-01T00:00:00.001000Z");
  });

  it("rejects an invalid clock instead of producing a noncanonical value", () => {
    expect(() => toUtcMicrosecondTimestamp(new Date(Number.NaN))).toThrow(RangeError);
  });
});
