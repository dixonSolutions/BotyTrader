/**
 * ASCII table for Ink. Replaces `ink-table` (CJS + require("ink")) which breaks
 * Node when Ink/yoga-layout ship as ESM with top-level await.
 */

import React from "react";
import { Box, Text } from "ink";

import { theme } from "../theme.js";

export type AppTableRow = Record<string, string | number | boolean | null | undefined>;

export type AppTableProps = {
  data: AppTableRow[];
  columns?: string[];
  padding?: number;
};

type ColW = { column: string; width: number; key: string };

function collectColumns(data: AppTableRow[]): string[] {
  const keys = new Set<string>();
  for (const row of data) {
    for (const k of Object.keys(row)) {
      keys.add(k);
    }
  }
  return Array.from(keys);
}

function columnWidths(data: AppTableRow[], columns: string[], padding: number): ColW[] {
  return columns.map((key) => {
    const headerLen = key.length;
    const cellLens = data.map((row) => {
      const v = row[key];
      if (v === undefined || v === null) return 0;
      return String(v).length;
    });
    const width = Math.max(headerLen, ...cellLens, 0) + padding * 2;
    return { column: key, width, key };
  });
}

function edgeRow(
  cols: ColW[],
  left: string,
  mid: string,
  right: string,
  fill: string,
  rowKey: string,
): React.ReactElement {
  const parts: React.ReactNode[] = [];
  for (let i = 0; i < cols.length; i++) {
    if (i > 0) {
      parts.push(
        <Text key={`${rowKey}-m-${i}`} bold color={theme.color.muted}>
          {mid}
        </Text>,
      );
    }
    const c = cols[i]!;
    parts.push(
      <Text key={`${rowKey}-c-${c.key}`} bold color={theme.color.muted}>
        {fill.repeat(c.width)}
      </Text>,
    );
  }
  return (
    <Box flexDirection="row" key={rowKey}>
      <Text bold color={theme.color.muted}>
        {left}
      </Text>
      {parts}
      <Text bold color={theme.color.muted}>
        {right}
      </Text>
    </Box>
  );
}

function textRow(
  cols: ColW[],
  rowKey: string,
  getCell: (col: ColW) => { text: string; bold?: boolean; color?: string },
): React.ReactElement {
  const parts: React.ReactNode[] = [];
  for (let i = 0; i < cols.length; i++) {
    if (i > 0) {
      parts.push(
        <Text key={`${rowKey}-v-${i}`} bold color={theme.color.muted}>
          │
        </Text>,
      );
    }
    const c = cols[i]!;
    const { text, bold, color } = getCell(c);
    parts.push(
      <Text key={`${rowKey}-t-${c.key}`} bold={bold} color={color ?? theme.color.text}>
        {text}
      </Text>,
    );
  }
  return (
    <Box flexDirection="row" key={rowKey}>
      <Text bold color={theme.color.muted}>
        │
      </Text>
      {parts}
      <Text bold color={theme.color.muted}>
        │
      </Text>
    </Box>
  );
}

export function AppTable({ padding = 1, data, columns: columnsProp }: AppTableProps): React.ReactElement {
  const columns = columnsProp?.length ? columnsProp : collectColumns(data);
  const cols = columnWidths(data, columns, padding);

  const blocks: React.ReactNode[] = [
    edgeRow(cols, "┌", "┬", "┐", "─", "top"),
    textRow(cols, "head", (col) => {
      const v = col.column;
      const mr = col.width - v.length - padding;
      return {
        text: `${" ".repeat(padding)}${v}${" ".repeat(Math.max(0, mr))}`,
        bold: true,
        color: theme.color.primary,
      };
    }),
  ];

  for (let i = 0; i < data.length; i++) {
    const row = data[i]!;
    blocks.push(edgeRow(cols, "├", "┼", "┤", "─", `sep-${i}`));
    blocks.push(
      textRow(cols, `row-${i}`, (col) => {
        const raw = row[col.column];
        const v = raw === undefined || raw === null ? "" : String(raw);
        const mr = col.width - v.length - padding;
        return {
          text: `${" ".repeat(padding)}${v}${" ".repeat(Math.max(0, mr))}`,
        };
      }),
    );
  }

  blocks.push(edgeRow(cols, "└", "┴", "┘", "─", "bot"));

  return <Box flexDirection="column">{blocks}</Box>;
}
