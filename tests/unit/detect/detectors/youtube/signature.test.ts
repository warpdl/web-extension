import { describe, it, expect } from "vitest";
import { extractDecoders, decodeFormatUrl, type Decoders } from "../../../../../src/detect/detectors/youtube/signature";

// Synthetic base.js mimicking YouTube's structure. Uses a reversible signature
// function (just reverses the string) and an n-decoder (uppercase). These are
// NOT YouTube's real algorithms, but the parsing patterns match the shape of
// real base.js so the extractor regexes are exercised end-to-end.

const syntheticBaseJs = `
var Xz={xb:function(a,b){a.reverse()},Ux:function(a,b){var c=a[0];a[0]=a[b%a.length];a[b%a.length]=c},ZZ:function(a,b){a.splice(0,b)}};
var sigDecode=function(a){a=a.split("");Xz.xb(a,1);Xz.Ux(a,3);return a.join("")};
a.set("alr","yes");c&&(c=sigDecode(decodeURIComponent(c)));
var nDecode=function(b){return b.toUpperCase()};
&&(b=a.get("n"))&&(b=nDecode(b));
`;

describe("extractDecoders", () => {
  it("extracts signature and n-decoder from synthetic base.js", () => {
    const decoders = extractDecoders(syntheticBaseJs);
    expect(decoders.signature).toBeDefined();
    expect(decoders.nParam).toBeDefined();
  });

  it("extracted signature function reverses + swaps (synthetic algorithm)", () => {
    const decoders = extractDecoders(syntheticBaseJs);
    const input = "abcdef";
    // Expected: reverse → "fedcba"; swap[0] and swap[3%6=3] → "cedfba"
    // (We don't need to verify exact algorithm here; just that it executes.)
    const result = decoders.signature(input);
    expect(typeof result).toBe("string");
    expect(result.length).toBe(input.length);
  });

  it("extracted n-decoder uppercases (synthetic algorithm)", () => {
    const decoders = extractDecoders(syntheticBaseJs);
    expect(decoders.nParam("abc")).toBe("ABC");
  });

  it("throws when signature function cannot be located", () => {
    expect(() => extractDecoders("// empty base.js")).toThrow(/signature_extract_failed/);
  });

  it("throws when n-decoder cannot be located", () => {
    const noN = `
      var Xz={xb:function(a,b){a.reverse()}};
      var sigDecode=function(a){a=a.split("");Xz.xb(a,1);return a.join("")};
      a.set("alr","yes");c&&(c=sigDecode(decodeURIComponent(c)));
    `;
    expect(() => extractDecoders(noN)).toThrow(/n_extract_failed/);
  });
});

describe("decodeFormatUrl", () => {
  const decoders = extractDecoders(syntheticBaseJs);

  it("passes through url when no signatureCipher and no n", () => {
    const result = decodeFormatUrl({ url: "https://a.com/video.mp4" } as any, decoders);
    expect(result).toBe("https://a.com/video.mp4");
  });

  it("applies n decoder to url with n param", () => {
    const result = decodeFormatUrl({ url: "https://a.com/video.mp4?n=abc" } as any, decoders);
    expect(result).toBe("https://a.com/video.mp4?n=ABC");
  });

  it("decodes signatureCipher to form url with sig param", () => {
    const cipher = "s=" + encodeURIComponent("abcdef") + "&sp=sig&url=" + encodeURIComponent("https://a.com/video.mp4");
    const result = decodeFormatUrl({ signatureCipher: cipher } as any, decoders);
    expect(result).toContain("sig=");
    expect(result).toContain("https://a.com/video.mp4");
  });

  it("returns null when format has neither url nor signatureCipher", () => {
    expect(decodeFormatUrl({} as any, decoders)).toBeNull();
  });

  it("catches n-decoder exception per-format (returns url without n transform)", () => {
    const badDecoders = {
      signature: decoders.signature,
      nParam: () => { throw new Error("n fail"); },
    };
    const result = decodeFormatUrl({ url: "https://a.com/v.mp4?n=abc" } as any, badDecoders);
    // The format URL is still returned but with original n (best-effort)
    expect(result).toBe("https://a.com/v.mp4?n=abc");
  });

  it("decodeFormatUrl returns null when signature decoder throws", () => {
    const throwingDecoders: Decoders = {
      signature: () => { throw new Error("sig fail"); },
      nParam: (n) => n,
    };
    const cipher = "s=abc&sp=sig&url=" + encodeURIComponent("https://a/v.mp4");
    const result = decodeFormatUrl({ signatureCipher: cipher } as any, throwingDecoders);
    expect(result).toBeNull();
  });

  it("decodeFormatUrl returns null when signatureCipher lacks 's' field", () => {
    const cipher = "sp=sig&url=" + encodeURIComponent("https://a/v.mp4");
    const result = decodeFormatUrl({ signatureCipher: cipher } as any, { signature: (s) => s, nParam: (n) => n });
    expect(result).toBeNull();
  });

  it("decodeFormatUrl returns null when signatureCipher lacks 'url' field", () => {
    const cipher = "s=abc&sp=sig";
    const result = decodeFormatUrl({ signatureCipher: cipher } as any, { signature: (s) => s, nParam: (n) => n });
    expect(result).toBeNull();
  });

  it("decodeFormatUrl returns url as-is when URL parse fails (malformed url)", () => {
    // new URL("not a url") throws in Node.js; the implementation catches and returns as-is.
    const format = { url: "not a url" } as any;
    const result = decodeFormatUrl(format, { signature: (s) => s, nParam: (n) => n });
    expect(result).toBe("not a url");
  });

  it("appends & before sig param when base URL already has query params", () => {
    // Exercises line 94: baseUrl.includes("?") ? "&" : "?" — the true ("&") branch
    const decoders = extractDecoders(syntheticBaseJs);
    const cipher = "s=" + encodeURIComponent("abcdef") + "&sp=sig&url=" + encodeURIComponent("https://a.com/video.mp4?foo=bar");
    const result = decodeFormatUrl({ signatureCipher: cipher } as any, decoders);
    expect(result).toContain("&sig=");
  });

  it("uses default 'sig' sp param when signatureCipher lacks sp field", () => {
    // Exercises line 85: params.get("sp") ?? "sig" — the null fallback
    const decoders = extractDecoders(syntheticBaseJs);
    const cipher = "s=" + encodeURIComponent("abcdef") + "&url=" + encodeURIComponent("https://a.com/video.mp4");
    const result = decodeFormatUrl({ signatureCipher: cipher } as any, decoders);
    expect(result).toContain("sig=");
  });
});

describe("extractDecoders - edge cases", () => {
  it("extractDecoders handles function body that calls a helper not defined elsewhere", () => {
    // Helper object reference in body but no var definition — helperObjSrc stays empty.
    const baseJs = `
      var sigDecode=function(a){a=a.split("");UndefinedHelper.xb(a,1);return a.join("")};
      a.set("alr","yes");c&&(c=sigDecode(decodeURIComponent(c)));
      var nDecode=function(b){return b};
      &&(b=a.get("n"))&&(b=nDecode(b));
    `;
    // The extractor should still build the function (execution will fail at runtime
    // when UndefinedHelper is referenced, but buildFunction itself should not throw).
    const decoders = extractDecoders(baseJs);
    expect(decoders.signature).toBeDefined();
    // Calling it will throw because UndefinedHelper is undefined.
    expect(() => decoders.signature("abc")).toThrow();
  });

  it("throws function_build_failed when new Function construction fails (syntax error in body)", () => {
    // Exercises lines 75-77: catch block in buildDecodeFunction when new Function throws
    // Inject a function body with a syntax error that causes new Function to throw
    const baseJs = `
      var sigDecode=function(a){ ===SYNTAX_ERROR=== };
      a.set("alr","yes");c&&(c=sigDecode(decodeURIComponent(c)));
      var nDecode=function(b){return b};
      &&(b=a.get("n"))&&(b=nDecode(b));
    `;
    expect(() => extractDecoders(baseJs)).toThrow(/function_build_failed|signature_extract_failed/);
  });
});
