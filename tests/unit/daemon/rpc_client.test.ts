import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveUrl, DaemonRpcError } from "../../../src/daemon/rpc_client";
import type { ResolveUrlResult } from "../../../src/types";

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  (globalThis as any).fetch = fetchSpy;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as any).fetch;
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  } as Response;
}

describe("resolveUrl", () => {
  it("POSTs to /jsonrpc with the right shape", async () => {
    const expected: ResolveUrlResult = { title: "T", formats: [] };
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { jsonrpc: "2.0", id: 1, result: expected }),
    );

    const res = await resolveUrl("https://youtube.com/watch?v=abc", {
      host: "localhost:3850",
    });

    expect(res).toEqual(expected);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://localhost:3850/jsonrpc");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(init.headers["Authorization"]).toBeUndefined();
    const body = JSON.parse(init.body as string);
    expect(body.method).toBe("resolve.url");
    expect(body.params).toEqual({ url: "https://youtube.com/watch?v=abc" });
    expect(body.jsonrpc).toBe("2.0");
    expect(typeof body.id).toBe("number");
  });

  it("includes Authorization header when secret is provided", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, { jsonrpc: "2.0", id: 1, result: { title: "", formats: [] } }),
    );

    await resolveUrl("https://x/y", { host: "localhost:3850", secret: "secret-123" });

    const [, init] = fetchSpy.mock.calls[0];
    expect(init.headers["Authorization"]).toBe("Bearer secret-123");
  });

  it("throws DaemonRpcError with code 401 on Unauthorized", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(401, {}));

    await expect(
      resolveUrl("https://x/y", { host: "localhost:3850" }),
    ).rejects.toMatchObject({
      name: "DaemonRpcError",
      code: 401,
    });
  });

  it("propagates JSON-RPC error with code", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        jsonrpc: "2.0",
        id: 1,
        error: { code: -32101, message: "yt-dlp not found on PATH" },
      }),
    );

    await expect(
      resolveUrl("https://x/y", { host: "localhost:3850" }),
    ).rejects.toMatchObject({
      name: "DaemonRpcError",
      code: -32101,
      message: "yt-dlp not found on PATH",
    });
  });

  it("throws when response has neither result nor error", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { jsonrpc: "2.0", id: 1 }));

    await expect(
      resolveUrl("https://x/y", { host: "localhost:3850" }),
    ).rejects.toThrow(DaemonRpcError);
  });

  it("surfaces non-OK HTTP status", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(500, {}));

    await expect(
      resolveUrl("https://x/y", { host: "localhost:3850" }),
    ).rejects.toMatchObject({
      name: "DaemonRpcError",
      code: 500,
    });
  });

  it("surfaces fetch rejection (network failure)", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    await expect(
      resolveUrl("https://x/y", { host: "localhost:3850" }),
    ).rejects.toMatchObject({
      name: "DaemonRpcError",
      message: expect.stringContaining("ECONNREFUSED"),
    });
  });

  it("aborts and throws on timeout", async () => {
    // Simulate a hanging fetch that respects the abort signal.
    fetchSpy.mockImplementationOnce((_: string, init?: RequestInit) => {
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const e = new Error("aborted");
          e.name = "AbortError";
          reject(e);
        });
      });
    });

    await expect(
      resolveUrl("https://x/y", { host: "localhost:3850", timeoutMs: 10 }),
    ).rejects.toMatchObject({
      name: "DaemonRpcError",
      message: expect.stringContaining("timed out"),
    });
  });
});
