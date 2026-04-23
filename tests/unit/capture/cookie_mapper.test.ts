import { describe, it, expect } from "vitest";
import { toDaemonCookie } from "../../../src/capture/cookie_mapper";

const base = {
  name: "s",
  value: "v",
  domain: ".a.com",
  path: "/",
  secure: false,
  httpOnly: false,
  hostOnly: false,
  session: false,
  storeId: "0",
};

describe("toDaemonCookie", () => {
  it("maps basic fields with PascalCase field names", () => {
    const out = toDaemonCookie(base as chrome.cookies.Cookie);
    expect(out).toMatchObject({ Name: "s", Value: "v", Domain: ".a.com", Path: "/", Secure: false, HttpOnly: false });
  });

  it("maps expirationDate (seconds) to ISO string", () => {
    const out = toDaemonCookie({ ...base, expirationDate: 1700000000 } as chrome.cookies.Cookie);
    expect(out.Expires).toBe(new Date(1700000000 * 1000).toISOString());
  });

  it("omits Expires when expirationDate is absent", () => {
    const out = toDaemonCookie(base as chrome.cookies.Cookie);
    expect("Expires" in out).toBe(false);
  });

  it.each([
    ["lax", 1],
    ["strict", 2],
    ["no_restriction", 3],
  ])("maps sameSite=%s to %d", (sameSite, expected) => {
    const out = toDaemonCookie({ ...base, sameSite } as chrome.cookies.Cookie);
    expect(out.SameSite).toBe(expected);
  });

  it("omits SameSite when unspecified", () => {
    const out = toDaemonCookie({ ...base, sameSite: "unspecified" } as chrome.cookies.Cookie);
    expect("SameSite" in out).toBe(false);
  });

  it("preserves secure and httpOnly booleans", () => {
    const out = toDaemonCookie({ ...base, secure: true, httpOnly: true } as chrome.cookies.Cookie);
    expect(out.Secure).toBe(true);
    expect(out.HttpOnly).toBe(true);
  });

  it("preserves unicode values round-trip", () => {
    const out = toDaemonCookie({ ...base, value: "café\u{1F4A9}" } as chrome.cookies.Cookie);
    expect(out.Value).toBe("café\u{1F4A9}");
  });

  it("handles empty value string", () => {
    const out = toDaemonCookie({ ...base, value: "" } as chrome.cookies.Cookie);
    expect(out.Value).toBe("");
  });
});
