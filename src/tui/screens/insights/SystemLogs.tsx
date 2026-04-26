/**
 * System logs panel — virtual viewport over the log buffer (newest at top).
 * Only renders `viewportLines` rows; parent owns scroll offset and keybindings.
 */

import React from "react";
import { Box, Text } from "ink";

import { Panel } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import type { LogEntry } from "../../../orchestrator.js";

interface Props {
  logs: LogEntry[];
  /** First row index into `logs` (0 = newest). */
  scrollOffset: number;
  /** Max lines to paint (terminal performance). */
  viewportLines?: number;
  /** Optional pager / actions rendered under the panel title. */
  toolbar?: React.ReactNode;
}

export function SystemLogs({ logs, scrollOffset, viewportLines = 14, toolbar }: Props): React.ReactElement {
  const vp = Math.max(1, viewportLines);
  const maxOffset = Math.max(0, logs.length - vp);
  const off = Math.min(Math.max(0, scrollOffset), maxOffset);
  const visible = logs.slice(off, off + vp);
  const hi = logs.length === 0 ? 0 : Math.min(off + visible.length, logs.length);

  return (
    <Panel title={`System logs ${logs.length ? `${off + 1}–${hi}` : "0"} of ${logs.length}`}>
      {toolbar ? (
        <Box marginBottom={1} flexDirection="row" flexWrap="wrap">
          {toolbar}
        </Box>
      ) : null}
      {visible.length === 0 ? (
        <Text color={theme.color.muted}>No log entries yet.</Text>
      ) : (
        visible.map((entry, i) => (
          <Box key={`${off + i}-${entry.ts}`}>
            <Text color={theme.color.muted}>{entry.ts.slice(11, 23)} </Text>
            <Text color={theme.level[entry.level]}>{entry.level.padEnd(5)} </Text>
            <Text>{entry.message}</Text>
          </Box>
        ))
      )}
    </Panel>
  );
}
