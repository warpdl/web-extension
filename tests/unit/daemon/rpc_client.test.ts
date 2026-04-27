import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { resolveUrl, youtubeDownload, DaemonRpcError } from "../../../src/daemon/rpc_client";
import type { ResolveUrlResult, YouTubeDownloadResult } from "../../../src/types";

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

describe("youtubeDownload", () => {
  it("POSTs youtube.download with the params", async () => {
    const expected: YouTubeDownloadResult = { gid: "abc", muxed: false, fileName: "video.mp4" };
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { jsonrpc: "2.0", id: 1, result: expected }));

    const res = await youtubeDownload(
      { videoId: "vid", videoFormatId: "22" },
      { host: "localhost:3850" },
    );
    expect(res).toEqual(expected);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("http://localhost:3850/jsonrpc");
    const body = JSON.parse(init.body as string);
    expect(body.method).toBe("youtube.download");
    expect(body.params).toEqual({ videoId: "vid", videoFormatId: "22" });
  });

  it("forwards adaptive params (audioFormatId, fileName)", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        jsonrpc: "2.0", id: 1,
        result: { gid: "x", muxed: true, fileName: "out.mp4" },
      }),
    );
    await youtubeDownload(
      { videoId: "v", videoFormatId: "137", audioFormatId: "140", fileName: "myclip" },
      { host: "localhost:3850" },
    );
    const [, init] = fetchSpy.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.params).toEqual({
      videoId: "v",
      videoFormatId: "137",
      audioFormatId: "140",
      fileName: "myclip",
    });
  });

  it("propagates -32105 muxer_unavailable error", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        jsonrpc: "2.0", id: 1,
        error: { code: -32105, message: "ffmpeg not found on PATH" },
      }),
    );
    await expect(
      youtubeDownload({ videoId: "x", videoFormatId: "137", audioFormatId: "140" }, { host: "localhost:3850" }),
    ).rejects.toMatchObject({ code: -32105, message: expect.stringContaining("ffmpeg") });
  });

  it("propagates -32106 format_not_found", async () => {
    fetchSpy.mockResolvedValueOnce(
      jsonResponse(200, {
        jsonrpc: "2.0", id: 1,
        error: { code: -32106, message: "format id not found: 9999" },
      }),
    );
    await expect(
      youtubeDownload({ videoId: "x", videoFormatId: "9999" }, { host: "localhost:3850" }),
    ).rejects.toMatchObject({ code: -32106 });
  });
});
