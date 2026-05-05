/**
 * Checkbox control (boolean toggle) — full-row hit target, dark-surface styling.
 *
 * The box is a fixed-size rounded square (borderStyle: "round");
 * only the interior (empty vs ✓) and fill colour change between states —
 * no layout shift, same footprint on/off (Law of Consistency).
 *
 * Design:
 *   Off: thin gray border, hollow dark interior  ╭───╮
 *                                                │   │
 *                                                ╰───╯
 *   On:  white fill + black checkmark            ╭───╮
 *                                                │ ✓ │
 *                                                ╰───╯
 *
 * Ink note: Box `height={3}` with `borderStyle="round"` gives 1 content row.
 * Use a single-line Text (not multiline "\n...") to avoid overflow. The
 * Box's alignItems + justifyContent centre the mark in that single row.
 */

import React, { useRef, type ReactNode } from "react";
import { Box, type DOMElement, Text } from "ink";
import { usePointerTarget } from "../pointer/usePointerTarget.js";
import { theme } from "../theme.js";

const C = theme.ui.checkbox;

// Single-row strings — ✓ padded to fill the 3-char inner width of the frame.
const MARK_ON = " ✓ ";
const MARK_OFF = "   ";

export interface ToggleProps {
  /** Checked (on) state */
  enabled: boolean;
  /** Invoked once per successful press anywhere in the control bounds */
  onToggle: () => void;
  /** Label after the box (same hit area) */
  label?: string;
  disabled?: boolean;
  /**
   * @deprecated Checkbox is a fixed size; kept for call-site compatibility.
   */
  width?: number;
  /** Content before the box (muted captions, etc.) — included in the click target */
  leading?: ReactNode;
  /** Content after the label — included in the click target */
  trailing?: ReactNode;
}

/**
 * Presentational checkbox (no pointer). Use inside `ClickableRow` or tables
 * where the parent owns the hit area.
 */
export function CheckboxGlyph({
  enabled,
  disabled = false,
  hover = false,
}: {
  enabled: boolean;
  disabled?: boolean;
  hover?: boolean;
}): React.ReactElement {
  const borderTone = hover && !disabled ? C.borderHover : C.border;
  // Checked: white fill (#fff). Unchecked: surface colour so it looks hollow.
  const fillBg = enabled ? C.checkedBg : C.surface;
  const markFg = enabled ? C.checkmark : C.surface; // invisible mark when off

  return (
    <Box
      width={C.frameWidth}
      height={C.frameHeight}
      borderStyle="round"
      borderColor={borderTone}
      borderDimColor={disabled}
      alignItems="center"
      justifyContent="center"
    >
      <Text backgroundColor={fillBg} color={markFg} dimColor={disabled}>
        {enabled ? MARK_ON : MARK_OFF}
      </Text>
    </Box>
  );
}

function CheckboxRow({
  enabled,
  onToggle,
  label,
  disabled = false,
  leading,
  trailing,
  showOnOff = false,
}: ToggleProps & { showOnOff?: boolean }): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const { hover } = usePointerTarget(ref, {
    disabled,
    onPress: () => onToggle(),
  });

  const labelColor = disabled
    ? theme.color.muted
    : hover
      ? theme.color.primary
      : theme.color.text;

  return (
    <Box ref={ref} flexDirection="row" gap={1} alignItems="center">
      {leading}
      <CheckboxGlyph enabled={enabled} disabled={disabled} hover={hover} />
      {label ? (
        <Text color={labelColor} dimColor={disabled}>
          {label}
        </Text>
      ) : null}
      {showOnOff ? (
        <Text color={enabled ? theme.color.success : theme.color.muted} bold dimColor={disabled}>
          {enabled ? "ON" : "OFF"}
        </Text>
      ) : null}
      {trailing}
    </Box>
  );
}

/** Fully clickable checkbox + optional label / leading / trailing (shared hit box). */
export function Toggle(props: ToggleProps): React.ReactElement {
  return <CheckboxRow {...props} />;
}

/** Compact checkbox (same as `Toggle`; width prop ignored). */
export function CompactToggle(props: Omit<ToggleProps, "label" | "width">): React.ReactElement {
  return <CheckboxRow {...props} />;
}

/** Checkbox with ON/OFF hint after the label. */
export function LabeledToggle(props: ToggleProps): React.ReactElement {
  return <CheckboxRow {...props} showOnOff />;
}
