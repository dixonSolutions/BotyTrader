/**
 * Locks the Ink root to the real terminal size so layout height stays ≤ stdout.rows.
 * When output height exceeds rows, Ink clears the whole screen each frame (heavy flicker).
 */

import React from "react";
import { Box, useStdout } from "ink";

export function ViewportRoot({ children }: { children: React.ReactNode }): React.ReactElement {
  const { stdout } = useStdout();
  const w = Math.max(20, stdout.columns ?? 80);
  const h = Math.max(8, stdout.rows ?? 24);
  return (
    <Box flexDirection="column" width={w} height={h} overflow="hidden">
      <Box flexDirection="column" flexGrow={1} minHeight={0} minWidth={0}>
        {children}
      </Box>
    </Box>
  );
}
