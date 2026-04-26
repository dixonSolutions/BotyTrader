/**
 * Filled, pill-style action control (inspired by libadwaita primary buttons).
 * Pointer hit-testing via `usePointerTarget` (SGR coords aligned to Ink layout).
 */

import React, { useRef } from "react";
import { Box, type DOMElement, Text } from "ink";

import { usePointerTarget } from "../pointer/usePointerTarget.js";
import { theme } from "../theme.js";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost" | "success";

export interface ButtonProps {
  label: string;
  onClick: () => void;
  /** Shown before the label (e.g. an icon from `icons`). */
  icon?: string;
  disabled?: boolean;
  variant?: ButtonVariant;
  /** Minimum inner text width in characters (excluding outer padding). */
  minWidth?: number;
}

const variantBg: Record<ButtonVariant, string> = {
  primary: theme.ui.buttonPrimaryBg,
  secondary: theme.ui.buttonSecondaryBg,
  danger: theme.ui.buttonDangerBg,
  ghost: theme.ui.buttonGhostBg,
  success: theme.ui.buttonSuccessBg,
};

export function Button({
  label,
  onClick,
  icon,
  disabled = false,
  variant = "primary",
  minWidth = 0,
}: ButtonProps): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const { hover, ripple } = usePointerTarget(ref, {
    disabled,
    onPress: () => onClick(),
  });
  const baseBg = disabled ? "gray" : variantBg[variant];

  const inner = `${icon ? `${icon} ` : ""}${label}`;
  const padded = minWidth > 0 ? inner.padEnd(minWidth, " ") : inner;
  // Pill: padded block with background (reads as a rounded bar in most terminals).
  const labelCell = ` ${padded} `;
  const showHover = hover && !disabled;
  const hoverUnderline = !disabled && !ripple && showHover && variant !== "ghost";

  return (
    <Box ref={ref} flexShrink={0}>
      <Text
        bold
        backgroundColor={ripple && !disabled ? "white" : baseBg}
        color={ripple && !disabled ? "black" : "white"}
        dimColor={disabled}
        inverse={!disabled && !ripple && showHover && variant === "ghost"}
        underline={hoverUnderline}
      >
        {labelCell}
      </Text>
    </Box>
  );
}
