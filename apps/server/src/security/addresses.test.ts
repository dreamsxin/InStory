import { describe, expect, it } from "vitest";
import { isLoopbackAddress, readTrustProxy } from "./addresses.js";

describe("readTrustProxy", () => {
  it("trusts nothing when unset or empty", () => {
    expect(readTrustProxy(undefined)).toBe(false);
    expect(readTrustProxy("")).toBe(false);
    expect(readTrustProxy(" , ")).toBe(false);
  });

  it("takes a list of addresses and CIDRs", () => {
    expect(readTrustProxy("172.16.0.0/12")).toEqual(["172.16.0.0/12"]);
    expect(readTrustProxy("10.0.0.1, 192.168.0.0/16 ")).toEqual(["10.0.0.1", "192.168.0.0/16"]);
  });

  it("refuses a hop count instead of pretending to honour it", () => {
    const warnings: string[] = [];
    const warn = (message: string): void => void warnings.push(message);

    // fastify 5.12 dropped hop-count trust, so a number would look configured and do
    // nothing. Falling back to false over-limits rather than believing X-Forwarded-For.
    expect(readTrustProxy("1", warn)).toBe(false);
    expect(readTrustProxy("2", warn)).toBe(false);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("TRUST_PROXY=1");
  });

  it("refuses a list that smuggles a hop count in beside real addresses", () => {
    const warnings: string[] = [];

    expect(readTrustProxy("10.0.0.1,1", (message) => void warnings.push(message))).toBe(false);
    expect(warnings).toHaveLength(1);
  });
});

describe("isLoopbackAddress", () => {
  it("accepts the loopback forms Node actually reports", () => {
    expect(isLoopbackAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackAddress("::1")).toBe(true);
    // Dual-stack sockets report IPv4 clients like this.
    expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
    // The whole /8 is loopback.
    expect(isLoopbackAddress("127.1.2.3")).toBe(true);
  });

  it("rejects everything else, including an absent address", () => {
    expect(isLoopbackAddress(undefined)).toBe(false);
    expect(isLoopbackAddress("")).toBe(false);
    expect(isLoopbackAddress("192.168.1.10")).toBe(false);
    expect(isLoopbackAddress("::ffff:192.168.1.10")).toBe(false);
    // Near misses that a substring check would have let through.
    expect(isLoopbackAddress("127.0.0.1.evil.test")).toBe(false);
    expect(isLoopbackAddress("10.127.0.1")).toBe(false);
    expect(isLoopbackAddress("2127.0.0.1")).toBe(false);
  });
});
