import type { DaemonCookie } from "../types";

export function toDaemonCookie(c: chrome.cookies.Cookie): DaemonCookie {
  const out: DaemonCookie = {
    Name: c.name,
    Value: c.value,
    Domain: c.domain,
    Path: c.path,
    HttpOnly: c.httpOnly,
    Secure: c.secure,
  };
  if (c.expirationDate !== undefined) {
    out.Expires = new Date(c.expirationDate * 1000).toISOString();
  }
  switch (c.sameSite) {
    case "lax": out.SameSite = 1; break;
    case "strict": out.SameSite = 2; break;
    case "no_restriction": out.SameSite = 3; break;
    // "unspecified" or undefined → omit
  }
  return out;
}
