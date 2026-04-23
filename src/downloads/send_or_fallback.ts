import type { DaemonClient, SendResult } from "../daemon/client";
import type { CapturedDownload } from "../types";

export type SendOrFallbackResult =
  | { kind: "sent" }
  | { kind: "fallback"; reason: string };

interface Opts {
  onFallback?: (info: { reason: string }) => void | Promise<void>;
}

export async function sendOrFallback(
  client: DaemonClient,
  msg: CapturedDownload,
  opts: Opts
): Promise<SendOrFallbackResult> {
  if (client.state !== "OPEN") {
    const reason = mapStateToReason(client.state);
    if (opts.onFallback) await opts.onFallback({ reason });
    return { kind: "fallback", reason };
  }
  const r: SendResult = client.send(msg);
  if (r.ok) return { kind: "sent" };
  if (opts.onFallback) await opts.onFallback({ reason: r.reason });
  return { kind: "fallback", reason: r.reason };
}

function mapStateToReason(state: string): string {
  switch (state) {
    case "IDLE": return "idle";
    case "CONNECTING": return "connecting";
    case "RECONNECTING": return "reconnecting";
    case "DISABLED": return "disabled";
    default: return "unknown";
  }
}
