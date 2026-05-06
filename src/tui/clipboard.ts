/**
 * Best-effort clipboard copy for headless TUI (no browser API).
 * Uses OS helpers: pbcopy (macOS), clip (Windows), wl-copy (Wayland), xclip (X11).
 */

import { spawnSync } from "node:child_process";

export interface ClipboardResult {
  ok: boolean;
  /** Short hint for the user if ok is false. */
  detail: string;
}

/**
 * Copy UTF-8 text to the system clipboard. Fails gracefully when no helper exists.
 */
export function copyTextToClipboard(text: string): ClipboardResult {
  const body = text.length === 0 ? "" : text.endsWith("\n") ? text : `${text}\n`;

  const run = (cmd: string, args: string[], input: string | Buffer): boolean => {
    const r = spawnSync(cmd, args, {
      input,
      stdio: ["pipe", "ignore", "ignore"],
    });
    return r.status === 0;
  };

  if (process.platform === "darwin") {
    if (run("pbcopy", [], body)) return { ok: true, detail: "pbcopy" };
    return { ok: false, detail: "pbcopy failed" };
  }

  if (process.platform === "win32") {
    const winBuf = Buffer.from(body.replace(/\n/g, "\r\n"), "utf16le");
    if (run("clip", [], winBuf)) return { ok: true, detail: "clip" };
    return { ok: false, detail: "clip failed" };
  }

  if (run("wl-copy", [], body)) return { ok: true, detail: "wl-copy" };
  if (run("xclip", ["-selection", "clipboard"], body)) return { ok: true, detail: "xclip" };
  if (run("xsel", ["--clipboard", "--input"], body)) return { ok: true, detail: "xsel" };

  return {
    ok: false,
    detail: "install wl-copy, xclip, or xsel (Linux) or use macOS/Windows",
  };
}
