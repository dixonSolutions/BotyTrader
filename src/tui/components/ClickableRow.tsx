/**
 * Selectable list row: pointer hit area with hover / selection affordances.
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
  const borderColor = selected
    ? theme.color.accent
    : ripple
      ? theme.color.text
      : hover
        ? theme.color.primary
        : theme.color.muted;

  return (
    <Box
      ref={ref}
      flexDirection="column"
      borderStyle="round"
      borderColor={borderColor}
      paddingLeft={0}
      paddingRight={0}
      marginBottom={1}
    >
      <Box>
        {selected ? <Text color={theme.color.accent}>› </Text> : <Text> </Text>}
        {children}
      </Box>
      {detail ? (
        <Box paddingLeft={2}>
          <Text color={theme.color.muted}>{detail}</Text>
        </Box>
      ) : null}
    </Box>
  );
}
