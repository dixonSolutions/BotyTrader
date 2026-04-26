/**
 * Shared Insights time and copy — all wall times use the process local timezone
 * (`Date` + `toLocaleString` with default time zone).
 */

/** Full local timestamp for tables and agent UI. */
export function formatInsightLocal(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

/** Shorter local time (same zone) for tight columns. */
export function formatInsightLocalShort(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function formatRelativeUntil(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return "";
  if (ms <= 0) return "due now";
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `in ${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${m % 60}m`;
}
