/**
 * Browser telemetry — batches UI events and flushes to POST /api/telemetry.
 * Fire-and-forget: never throws, never blocks the caller.
 */

interface TelemetryEvent {
  name: string;
  properties: Record<string, unknown>;
  timestamp: number; // Unix seconds
}

const FLUSH_INTERVAL_MS = 2000;
const MAX_BATCH = 10;

const queue: TelemetryEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function flush(): void {
  if (queue.length === 0) return;
  const batch = queue.splice(0, queue.length);
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  fetch("/api/telemetry", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ events: batch }),
    // keepalive: true so events fire during page unload
    keepalive: true,
  }).catch(() => {
    // Silently discard — telemetry must never impact UX
  });
}

/**
 * Track a UI event. Safe to call from anywhere; never throws.
 * Batches events and flushes every 2 s or when 10 events accumulate.
 */
export function track(
  name: string,
  properties: Record<string, unknown> = {},
): void {
  try {
    queue.push({ name, properties, timestamp: Date.now() / 1000 });
    if (queue.length >= MAX_BATCH) {
      flush();
    } else if (!timer) {
      timer = setTimeout(flush, FLUSH_INTERVAL_MS);
    }
  } catch {
    // Never propagate errors from telemetry
  }
}

/** Flush any queued events immediately (e.g. before page unload). */
export function flushNow(): void {
  try {
    flush();
  } catch {
    // ignore
  }
}
