/**
 * Compact icon-only control (back, close, scroll, etc.).
 */

import React, { useRef } from "react";
import { Box, type DOMElement, Text } from "ink";

import { usePointerTarget } from "../pointer/usePointerTarget.js";
import { theme } from "../theme.js";

export interface IconButtonProps {
  icon: string;
  onClick: () => void;
  disabled?: boolean;
  /** Screen-reader / hint text (shown in help rows, not always on the control). */
  label: string;
}

export function IconButton({ icon, onClick, disabled = false, label }: IconButtonProps): React.ReactElement {
  // `label` documents intent for screen readers; Ink has no ARIA, but callers and docs stay aligned.
  void label;
  const ref = useRef<DOMElement>(null);
  const { hover, ripple } = usePointerTarget(ref, {
    disabled,
    onPress: () => onClick(),
  });
  const showHover = hover && !disabled;

  return (
    <Box ref={ref} flexShrink={0}>
      <Text
        bold
        backgroundColor={ripple && !disabled ? "white" : theme.ui.buttonPrimaryBg}
        color={ripple && !disabled ? "black" : "white"}
        dimColor={disabled}
        inverse={!disabled && !ripple && showHover}
      >
        {` ${icon} `}
      </Text>
    </Box>
  );
}
