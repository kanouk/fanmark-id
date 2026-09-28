import { describe, expect, it } from "vitest";
import { assertUtcMicrosecondTimestamp, toUtcMicrosecondTimestamp } from "../src/utc-timestamp";

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

  it("validates exact UTC microsecond text without changing its bytes", () => {
    for (const value of [
      "2026-09-23T01:02:03.123456Z",
      "2026-09-23T01:02:03.123456+00:00",
      "0001-01-01T00:00:00.000001Z",
    ]) {
      expect(assertUtcMicrosecondTimestamp(value)).toBe(value);
    }
  });

  it("rejects rounded, impossible, zero-year, and non-UTC timestamps", () => {
    for (const value of [
      "2026-09-23T01:02:03.123Z",
      "2025-02-29T01:02:03.123456Z",
      "0000-01-01T00:00:00.000000Z",
      "2026-09-23T01:02:03.123456+01:00",
    ]) {
      expect(() => assertUtcMicrosecondTimestamp(value)).toThrow(RangeError);
    }
  });
});
