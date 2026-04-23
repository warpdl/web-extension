import { describe, it, expect, vi, beforeEach } from "vitest";
import { Logger, redactUrl, redactContext } from "../../../src/core/logger";
import { EventBus } from "../../../src/core/events";

describe("redactUrl", () => {
  it("strips query strings", () => {
    expect(redactUrl("https://a.com/b?c=1")).toBe("https://a.com/b?…");
  });
  it("leaves clean URLs alone", () => {
    expect(redactUrl("https://a.com/b")).toBe("https://a.com/b");
  });
  it("handles invalid URLs gracefully", () => {
    expect(redactUrl("not a url")).toBe("not a url");
  });
  it("handles empty string", () => {
    expect(redactUrl("")).toBe("");
  });
});

describe("redactContext", () => {
  it("replaces cookie values with [redacted]", () => {
    const out = redactContext({ cookies: [{ Name: "x", Value: "secret" }] });
    expect(out).toEqual({ cookies: "[redacted]" });
  });
  it("redacts Authorization key", () => {
    expect(redactContext({ Authorization: "Bearer xyz" })).toEqual({ Authorization: "[redacted]" });
  });
  it("redacts Cookie header value", () => {
    expect(redactContext({ Cookie: "session=abc" })).toEqual({ Cookie: "[redacted]" });
  });
  it("is case-insensitive on sensitive keys", () => {
    expect(redactContext({ cookie: "x" })).toEqual({ cookie: "[redacted]" });
    expect(redactContext({ COOKIE: "x" })).toEqual({ COOKIE: "[redacted]" });
  });
  it("redacts urls recursively", () => {
    expect(redactContext({ url: "https://a.com/b?tok=xyz" })).toEqual({ url: "https://a.com/b?…" });
  });
  it("leaves non-sensitive values intact", () => {
    expect(redactContext({ count: 5, name: "hello" })).toEqual({ count: 5, name: "hello" });
  });
  it("handles undefined/null context", () => {
    expect(redactContext(undefined)).toBeUndefined();
  });
});

describe("Logger", () => {
  let bus: EventBus;
  let sink: string[];

  beforeEach(() => {
    bus = new EventBus();
    sink = [];
  });

  it("emits log:entry to bus for each level", () => {
    const entries: any[] = [];
    bus.on("log:entry", (e) => entries.push(e));
    const log = new Logger({ bus, writer: (line) => sink.push(line) });
    log.info("hello", { a: 1 });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: "info", scope: "root", msg: "hello" });
  });

  it("writes one line per call with scope prefix", () => {
    const log = new Logger({ bus, writer: (line) => sink.push(line), clock: () => 1234 });
    log.info("hello");
    expect(sink[0]).toContain("[root] INFO  hello");
  });

  it("child loggers inherit writer but have their own scope", () => {
    const log = new Logger({ bus, writer: (line) => sink.push(line) });
    const child = log.child("daemon");
    child.warn("x");
    expect(sink[0]).toContain("[daemon] WARN  x");
  });

  it("redacts context by default", () => {
    const log = new Logger({ bus, writer: (line) => sink.push(line) });
    log.info("test", { Cookie: "secret" });
    expect(sink[0]).toContain("[redacted]");
    expect(sink[0]).not.toContain("secret");
  });

  it("debug flag disables redaction", () => {
    const log = new Logger({ bus, writer: (line) => sink.push(line), debug: () => true });
    log.info("test", { Cookie: "secret" });
    expect(sink[0]).toContain("secret");
  });

  it("records warn+error into ring buffer", () => {
    const log = new Logger({ bus, writer: () => {}, ringSize: 3 });
    log.info("ignored");       // info does NOT go to ring
    log.warn("w1");
    log.error("e1");
    log.warn("w2");
    log.warn("w3");             // evicts w1
    const ring = log.ringBuffer();
    expect(ring.map((e) => e.msg)).toEqual(["e1", "w2", "w3"]);
  });

  it("ring buffer respects size cap", () => {
    const log = new Logger({ bus, writer: () => {}, ringSize: 2 });
    log.warn("a");
    log.warn("b");
    log.warn("c");
    expect(log.ringBuffer().map((e) => e.msg)).toEqual(["b", "c"]);
  });

  it("error() includes the error message in the log line", () => {
    const log = new Logger({ bus, writer: (l) => sink.push(l) });
    log.error("failed", {}, new Error("boom"));
    expect(sink[0]).toContain("boom");
  });

  it("handles error() with non-Error cause", () => {
    const log = new Logger({ bus, writer: (l) => sink.push(l) });
    log.error("failed", {}, "string-cause");
    expect(sink[0]).toContain("string-cause");
  });
});
