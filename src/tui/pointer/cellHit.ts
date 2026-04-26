/**
 * Map SGR mouse cells to Ink’s layout grid.
 *
 * - **Bounds** use the same cumulative math as `ink/build/render-node-to-output.js`:
 *   walk from `ink-root` to the node, summing `getComputedLeft()` / `getComputedTop()`
 *   (not ad‑hoc layout objects), plus `getComputedWidth()` / `getComputedHeight()` for
 *   the hit box — i.e. where Ink actually paints the element.
 * - **Alternate screen** (`AlternateScreen`) should be active so terminal row 1 lines up
 *   with Ink row 0.
 * - **Origin**: xterm SGR `Px`/`Py` are conventionally **1-based**. Override with
 *   `BOTYTRADER_POINTER_ORIGIN` (`1` default, `0` for 0-based, or `dx,dy` e.g. `1,1`).
 */

import type { DOMElement } from "ink";
import type { RefObject } from "react";

export type CellBounds = { left: number; top: number; width: number; height: number };

export type TerminalViewport = { cols: number; rows: number };

/** Clamp SGR cell indices to the terminal grid Ink lays out against (`stdout.columns` / `rows`). */
export function clampSgrToViewport(
  sgrColumn: number,
  sgrRow: number,
  viewport: TerminalViewport,
): { col: number; row: number } {
  const cols = Math.max(1, Math.floor(viewport.cols));
  const rows = Math.max(1, Math.floor(viewport.rows));
  return {
    col: Math.min(Math.max(sgrColumn, 1), cols),
    row: Math.min(Math.max(sgrRow, 1), rows),
  };
}

function parsePointerOrigin(): { dx: number; dy: number } {
  const raw = process.env.BOTYTRADER_POINTER_ORIGIN?.trim();
  if (raw === "0") return { dx: 0, dy: 0 };
  if (raw && /^\d+,\d+$/.test(raw)) {
    const [a, b] = raw.split(",").map((s) => Number(s));
    return { dx: a, dy: b };
  }
  return { dx: 1, dy: 1 };
}

/**
 * Top-left and size in **the same cell grid Ink uses when painting** (see
 * `render-node-to-output.js`: `offsetX + getComputedLeft()`, etc.).
 */
export function getTerminalCellBounds(ref: RefObject<DOMElement | null>): CellBounds | null {
  const el = ref.current;
  if (!el?.yogaNode) return null;

  const chain: DOMElement[] = [];
  for (let n: DOMElement | undefined = el; n; n = n.parentNode) {
    chain.push(n);
  }
  chain.reverse();

  let left = 0;
  let top = 0;
  for (const n of chain) {
    if (n.nodeName === "ink-root") continue;
    if (!n.yogaNode) continue;
    left += n.yogaNode.getComputedLeft();
    top += n.yogaNode.getComputedTop();
  }

  const yn = el.yogaNode;
  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(yn.getComputedWidth()),
    height: Math.round(yn.getComputedHeight()),
  };
}

/**
 * True if the pointer cell lies inside `box` (Ink’s yoga grid). Optionally clamps
 * SGR coordinates to the live terminal size first so hits stay consistent on resize.
 */
export function cellInsideBounds(
  box: CellBounds,
  sgrColumn: number,
  sgrRow: number,
  viewport?: TerminalViewport,
): boolean {
  const { dx, dy } = parsePointerOrigin();
  const { col, row } = viewport
    ? clampSgrToViewport(sgrColumn, sgrRow, viewport)
    : { col: sgrColumn, row: sgrRow };
  const x = col - dx;
  const y = row - dy;
  return x >= box.left && x < box.left + box.width && y >= box.top && y < box.top + box.height;
}
