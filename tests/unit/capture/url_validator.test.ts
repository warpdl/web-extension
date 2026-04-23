import { describe, it, expect } from "vitest";
import { validateDaemonUrl } from "../../../src/capture/url_validator";

describe("validateDaemonUrl", () => {
  // Valid inputs
  it.each([
    ["localhost:3850", "localhost", 3850],
    ["127.0.0.1:3850", "127.0.0.1", 3850],
    ["[::1]:3850", "[::1]", 3850],
    ["[fe80::1]:8080", "[fe80::1]", 8080],
    ["my-server.lan:8080", "my-server.lan", 8080],
    ["my.host-name.example:1", "my.host-name.example", 1],
    ["_underscore:65535", "_underscore", 65535],
    ["192.168.1.5:3000", "192.168.1.5", 3000],
  ])("accepts valid input %s", (input, host, port) => {
    const r = validateDaemonUrl(input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.host).toBe(host);
      expect(r.port).toBe(port);
    }
  });

  it("trims surrounding whitespace", () => {
    const r = validateDaemonUrl("  localhost:3850  ");
    expect(r.ok).toBe(true);
  });

  // Error branches
  it("rejects empty string", () => {
    const r = validateDaemonUrl("");
    expect(r).toEqual({ ok: false, error: "empty" });
  });

  it("rejects only whitespace", () => {
    const r = validateDaemonUrl("   ");
    expect(r).toEqual({ ok: false, error: "empty" });
  });

  it("rejects ws:// scheme", () => {
    const r = validateDaemonUrl("ws://host:3850");
    expect(r).toEqual({ ok: false, error: "contains_scheme" });
  });

  it("rejects http:// scheme", () => {
    const r = validateDaemonUrl("http://host:3850");
    expect(r).toEqual({ ok: false, error: "contains_scheme" });
  });

  it("rejects wss:// scheme", () => {
    const r = validateDaemonUrl("wss://host:3850");
    expect(r).toEqual({ ok: false, error: "contains_scheme" });
  });

  it("rejects paths", () => {
    expect(validateDaemonUrl("host:3850/")).toEqual({ ok: false, error: "contains_path" });
    expect(validateDaemonUrl("host:3850/foo")).toEqual({ ok: false, error: "contains_path" });
  });

  it("rejects missing port — bare host", () => {
    expect(validateDaemonUrl("localhost")).toEqual({ ok: false, error: "missing_port" });
  });

  it("rejects trailing colon no port", () => {
    expect(validateDaemonUrl("host:")).toEqual({ ok: false, error: "missing_port" });
  });

  it("rejects port 0", () => {
    expect(validateDaemonUrl("host:0")).toEqual({ ok: false, error: "port_out_of_range" });
  });

  it("rejects port 65536", () => {
    expect(validateDaemonUrl("host:65536")).toEqual({ ok: false, error: "port_out_of_range" });
  });

  it("rejects non-numeric port", () => {
    expect(validateDaemonUrl("host:abc")).toEqual({ ok: false, error: "port_out_of_range" });
  });

  it("rejects port with extra chars", () => {
    expect(validateDaemonUrl("host:3850abc")).toEqual({ ok: false, error: "port_out_of_range" });
  });

  it("rejects invalid host chars (space)", () => {
    expect(validateDaemonUrl("ho st:3850")).toEqual({ ok: false, error: "invalid_host_chars" });
  });

  it("rejects invalid host chars (pipe)", () => {
    expect(validateDaemonUrl("a|b:3850")).toEqual({ ok: false, error: "invalid_host_chars" });
  });

  it("rejects IPv6 without brackets", () => {
    expect(validateDaemonUrl("fe80::1:3850")).toEqual({ ok: false, error: "invalid_host_chars" });
  });

  it("rejects over-long input (length overflow)", () => {
    const r = validateDaemonUrl("a".repeat(254) + ":80");
    expect(r).toEqual({ ok: false, error: "too_long" });
  });

  it("completes quickly on 10000-char input (no ReDoS)", () => {
    const start = Date.now();
    validateDaemonUrl("a".repeat(10_000));
    expect(Date.now() - start).toBeLessThan(50);
  });

  it("rejects missing host — starts with colon", () => {
    expect(validateDaemonUrl(":3850")).toEqual({ ok: false, error: "malformed" });
  });

  it("rejects IPv6 with unmatched bracket", () => {
    expect(validateDaemonUrl("[fe80::1:3850")).toEqual({ ok: false, error: "malformed" });
  });

  it("rejects IPv6 with port but malformed brackets", () => {
    expect(validateDaemonUrl("[fe80::1]")).toEqual({ ok: false, error: "missing_port" });
  });

  it("rejects control characters in host", () => {
    expect(validateDaemonUrl("host\n:3850")).toEqual({ ok: false, error: "invalid_host_chars" });
  });

  it("rejects multiple colons in IPv4-style input", () => {
    expect(validateDaemonUrl("a:b:3850")).toEqual({ ok: false, error: "invalid_host_chars" });
  });
});
