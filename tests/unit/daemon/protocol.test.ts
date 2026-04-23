import { describe, it, expect } from "vitest";
import { encodeCapturedDownload, encodePing } from "../../../src/daemon/protocol";

describe("encodeCapturedDownload", () => {
  it("produces JSON with url, headers, cookies", () => {
    const msg = encodeCapturedDownload({
      url: "https://a.com/file.zip",
      headers: [{ key: "User-Agent", value: "Mozilla" }],
      cookies: [],
    });
    expect(JSON.parse(msg)).toEqual({
      url: "https://a.com/file.zip",
      headers: [{ key: "User-Agent", value: "Mozilla" }],
      cookies: [],
    });
  });

  it("preserves cookie field casing (PascalCase for Go http.Cookie)", () => {
    const msg = encodeCapturedDownload({
      url: "https://a.com",
      headers: [],
      cookies: [{ Name: "s", Value: "v", Domain: ".a.com", Path: "/", HttpOnly: true, Secure: false }],
    });
    const parsed = JSON.parse(msg);
    expect(parsed.cookies[0].Name).toBe("s");
    expect(parsed.cookies[0].HttpOnly).toBe(true);
  });

  it("empty arrays serialize as []", () => {
    const msg = encodeCapturedDownload({ url: "https://a.com", headers: [], cookies: [] });
    expect(msg).toContain('"headers":[]');
    expect(msg).toContain('"cookies":[]');
  });
});

describe("encodePing", () => {
  it("produces minimal ping frame", () => {
    expect(encodePing()).toBe('{"type":"ping"}');
  });

  it("is stable across calls", () => {
    expect(encodePing()).toBe(encodePing());
  });
});
