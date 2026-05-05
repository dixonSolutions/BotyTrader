/**
 * Selectable list row: pointer hit area with hover / selection affordances.
 *
 * Avoids wrapping the row in `borderStyle: "round"` — that draws box-drawing
 * characters that intersect wrapped or multiline content (e.g. inline `Select`
 * menus, long labels) and looks like strikethrough / stray brackets. Selection
 * is shown with the `›` prefix + colour only.
 */

import React, { useRef } from "react";
import { Box, type DOMElement, Text } from "ink";

import { usePointerTarget } from "../pointer/usePointerTarget.js";
import { theme } from "../theme.js";

export interface ClickableRowProps {
  /** Primary line. */
  children: React.ReactNode;
  selected: boolean;
  onClick: () => void;
  /** Optional second line (muted), e.g. description. */
  detail?: string;
}

export function ClickableRow({ children, selected, onClick, detail }: ClickableRowProps): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const { hover, ripple } = usePointerTarget(ref, { onPress: () => onClick() });

  const prefixColor = selected
    ? theme.color.accent
    : ripple
      ? theme.color.text
      : hover
        ? theme.color.primary
        : theme.color.muted;

  return (
    <Box ref={ref} flexDirection="column" marginBottom={1}>
      <Box flexDirection="row" alignItems="flex-start">
        <Text color={prefixColor}>{selected ? "› " : "  "}</Text>
        <Box flexDirection="column" flexGrow={1} minWidth={0}>
          {children}
        </Box>
      </Box>
      {detail ? (
        <Box paddingLeft={2}>
          <Text color={theme.color.muted}>{detail}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
