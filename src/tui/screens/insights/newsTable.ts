/**
 * Alpaca news rows shaped for ink-table (string cells, clipped to terminal width).
 */

import type { NewsItem } from "../../../execution/broker.js";
import { formatInsightLocalShort } from "./insightFormatters.js";
import type { AppTableRow } from "../../components/AppTable.js";

function clipCell(s: string, w: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (w <= 0) return "";
  if (w === 1) return "…";
  if (t.length <= w) return t;
  return `${t.slice(0, w - 1)}…`;
}

export interface NewsTableData {
  rows: AppTableRow[];
  /** Column order for `<AppTable columns={...} />`. */
  columns: string[];
}

/**
 * Build table rows that fit roughly in `width` monospace columns (headline column absorbs slack).
 */
export function buildNewsTableData(items: NewsItem[], width: number): NewsTableData {
  const w = Math.max(48, width);
  const nW = 4;
  const dateW = 20;
  const srcW = Math.min(14, Math.max(7, Math.floor(w * 0.14)));
  const symW = Math.min(18, Math.max(6, Math.floor(w * 0.14)));
  const overhead = nW + dateW + srcW + symW + 16;
  const titleW = Math.max(16, w - overhead);

  const columns = ["#", "Published (local)", "Source", "Symbols", "Headline"];

  const rows: AppTableRow[] = items.map((it, i) => {
    const sym = (it.symbols ?? []).length > 0 ? it.symbols!.join(",") : "—";
    return {
      "#": String(i + 1),
      "Published (local)": clipCell(formatInsightLocalShort(it.publishedAt), dateW),
      Source: clipCell(it.source, srcW),
      Symbols: clipCell(sym, symW),
      Headline: clipCell(it.title, titleW),
    };
  });

  return { rows, columns };
}
