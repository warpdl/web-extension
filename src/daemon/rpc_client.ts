/**
 * Minimal JSON-RPC 2.0 HTTP client for the WarpDL daemon.
 *
 * POSTs to http://{host}/jsonrpc with an optional Bearer token. The daemon's
 * /jsonrpc endpoint is same-origin with the extension's already-configured
 * daemonUrl (e.g. localhost:3850), so no CORS preflight is required for
 * same-origin fetch.
 */

import type { ResolveUrlResult } from "../types";

export interface RpcCallOptions {
  host: string;       // e.g. "localhost:3850"
  secret?: string;    // Bearer token; when set, sent as Authorization: Bearer <secret>
  timeoutMs?: number; // default 60s; the daemon itself applies a per-call cap
}

export class DaemonRpcError extends Error {
  readonly code?: number;
  constructor(message: string, code?: number) {
    super(message);
    this.name = "DaemonRpcError";
    this.code = code;
  }
}

interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

let nextId = 1;

async function rpcCall<T>(method: string, params: unknown, opts: RpcCallOptions): Promise<T> {
  const controller = new AbortController();
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (opts.secret) headers["Authorization"] = `Bearer ${opts.secret}`;

    const res = await fetch(`http://${opts.host}/jsonrpc`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: nextId++,
        method,
        params,
      }),
      signal: controller.signal,
    });

    if (res.status === 401) {
      throw new DaemonRpcError("daemon rejected credentials (401)", 401);
    }
    if (!res.ok) {
      throw new DaemonRpcError(`daemon HTTP ${res.status}`, res.status);
    }

    const body = (await res.json()) as JsonRpcResponse<T>;
    if (body.error) {
      throw new DaemonRpcError(body.error.message, body.error.code);
    }
    if (body.result === undefined) {
      throw new DaemonRpcError("daemon returned neither result nor error");
    }
    return body.result;
  } catch (e) {
    if (e instanceof DaemonRpcError) throw e;
    if ((e as Error).name === "AbortError") {
      throw new DaemonRpcError(`daemon request timed out after ${timeoutMs}ms`);
    }
    throw new DaemonRpcError(`daemon request failed: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Calls the daemon's resolve.url RPC to turn a video-page URL into a list of
 * downloadable format entries. The daemon shells out to yt-dlp server-side.
 *
 * Throws DaemonRpcError on any failure.
 */
export async function resolveUrl(
  pageUrl: string,
  opts: RpcCallOptions,
): Promise<ResolveUrlResult> {
  return rpcCall<ResolveUrlResult>("resolve.url", { url: pageUrl }, opts);
}
