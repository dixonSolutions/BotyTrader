/**
 * Button component — white rounded pill for primary actions, adjustable variants.
 *
 * Design references:
 *   Primary:   white background, black text, generous padding (pill shape).
 *   Secondary: dark (#3A3A3C) background, white text.
 *   Danger:    red background, white text.
 *   Ghost:     no background, white text (border affordance from parent context).
 *   Success:   green background, white text.
 *
 * Props accept `backgroundColor` and `textColor` overrides to allow one-off
 * colour adjustments while keeping the pill geometry consistent (Law of
 * Consistency, Law of Similarity).
 *
 * Variants: primary | secondary | danger | ghost | success
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
  /** Override background colour (hex or chalk name). Bypasses variant bg. */
  backgroundColor?: string;
  /** Override text colour (hex or chalk name). Bypasses variant fg. */
  textColor?: string;
  /** Minimum inner text width in characters (excluding padding). */
  minWidth?: number;
  /** Maximum width — text truncated with ellipsis if longer. */
  maxWidth?: number;
}

interface VariantStyle {
  bg: string;
  bgHover: string;
  bgActive: string;
  fg: string;
}

const VARIANT_STYLES: Record<ButtonVariant, VariantStyle> = {
  primary: {
    bg: theme.ui.buttonPrimaryBg,         // #FFFFFF
    bgHover: "#E5E5E5",
    bgActive: "#CCCCCC",
    fg: theme.ui.buttonPrimaryFg,         // #000000
  },
  secondary: {
    bg: theme.ui.buttonSecondaryBg,       // #3A3A3C
    bgHover: "#48484A",
    bgActive: "#2C2C2E",
    fg: "#FFFFFF",
  },
  danger: {
    bg: theme.ui.buttonDangerBg,          // #DC2626
    bgHover: "#EF4444",
    bgActive: "#B91C1C",
    fg: "#FFFFFF",
  },
  success: {
    bg: theme.ui.buttonSuccessBg,         // #16A34A
    bgHover: "#22C55E",
    bgActive: "#15803D",
    fg: "#FFFFFF",
  },
  ghost: {
    bg: "#00000000",
    bgHover: "#2C2C2E",
    bgActive: "#3A3A3C",
    fg: "#FFFFFF",
  },
};

const DISABLED_BG = "#2C2C2E";
const DISABLED_FG = "#707074";

/**
 * Rounded pill button with consistent styling.
 *
 * Visual design (primary):
 *   ┌──────────────────┐
 *   │  ✓ Save Changes  │  ← white background, black text
 *   └──────────────────┘
 */
export function Button({
  label,
  onClick,
  icon,
  disabled = false,
  variant = "primary",
  backgroundColor,
  textColor,
  minWidth = 0,
  maxWidth,
}: ButtonProps): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const { hover, ripple } = usePointerTarget(ref, {
    disabled,
    onPress: () => onClick(),
  });

  const style = VARIANT_STYLES[variant];

  const bgColor = (() => {
    if (disabled) return DISABLED_BG;
    if (backgroundColor) return ripple ? style.bgActive : hover ? style.bgHover : backgroundColor;
    if (ripple) return style.bgActive;
    if (hover) return style.bgHover;
    return style.bg;
  })();

  const fgColor = disabled ? DISABLED_FG : (textColor ?? (variant === "primary" ? style.fg : style.fg));

  // Build label with optional icon prefix
  let displayLabel = icon ? `${icon} ${label}` : label;

  // Apply min width padding (centre the text)
  if (minWidth > 0 && displayLabel.length < minWidth) {
    const totalPad = minWidth - displayLabel.length;
    const leftPad = Math.floor(totalPad / 2);
    const rightPad = totalPad - leftPad;
    displayLabel = " ".repeat(leftPad) + displayLabel + " ".repeat(rightPad);
  }

  // Apply max width truncation
  if (maxWidth && displayLabel.length > maxWidth) {
    displayLabel = displayLabel.slice(0, maxWidth - 1) + "…";
  }

  // Generous horizontal padding for pill shape
  const paddedLabel = ` ${displayLabel} `;

  // Ghost variant: show text without a filled bg (transparent doesn't render in Ink)
  const isGhost = variant === "ghost" && !backgroundColor;

  return (
    <Box ref={ref} flexShrink={0}>
      {isGhost && !hover && !ripple ? (
        <Text bold={variant === "primary"} color={disabled ? DISABLED_FG : fgColor} dimColor={disabled}>
          {paddedLabel}
        </Text>
      ) : (
        <Text
          bold={variant === "primary"}
          backgroundColor={bgColor}
          color={fgColor}
          dimColor={disabled}
        >
          {paddedLabel}
        </Text>
      )}
    </Box>
  );
}

/**
 * Button group for related actions.
 * Renders buttons with consistent spacing (Law of Proximity).
 */
export function ButtonGroup({
  children,
}: {
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box flexDirection="row" gap={1}>
      {children}
    </Box>
  );
}

/**
 * Confirm button that requires two clicks (Goal-Gradient Effect).
 * First click shows "Confirm?", second click executes.
 */
export function ConfirmButton({
  label,
  confirmLabel = "Confirm?",
  onClick,
  variant = "danger",
  ...props
}: Omit<ButtonProps, "onClick" | "label"> & {
  label: string;
  confirmLabel?: string;
  onClick: () => void;
}): React.ReactElement {
  const [confirming, setConfirming] = React.useState(false);

  const handleClick = (): void => {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
    } else {
      setConfirming(false);
      onClick();
    }
  };

  return (
    <Button
      {...props}
      label={confirming ? confirmLabel : label}
      onClick={handleClick}
      variant={confirming ? "danger" : variant}
    />
  );
}
