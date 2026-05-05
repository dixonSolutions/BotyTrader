/**
 * Select — terminal-native dropdown for enum / discrete-value fields.
 *
 * Design (matches dark PrimeNG-style reference):
 *
 *   Closed:
 *     ╭──────────────────────╮
 *     │ paper             ▾  │
 *     ╰──────────────────────╯
 *
 *   Open (list appended below trigger):
 *     ╭──────────────────────╮
 *     │ paper             ▴  │
 *     ├──────────────────────┤
 *     │   live               │
 *     │ ✓ paper              │  ← currently selected
 *     ╰──────────────────────╯
 *
 * Interaction:
 *   - Single click on trigger toggles the list.
 *   - Single click on an option selects it and closes the list.
 *   - Clicking the trigger again while open closes without changing value.
 *
 * Terminal constraints:
 *   - No absolute positioning; the option list is rendered inline (pushes
 *     content below it down while open). This is the most reliable approach
 *     in Ink since `position: absolute` isn't fully supported.
 *   - Hit testing uses `usePointerTarget` to stay consistent with the rest
 *     of the pointer model (AlternateScreen + @zenobius/ink-mouse).
 */

import React, { useRef, useState } from "react";
import { Box, type DOMElement, Text } from "ink";

import { usePointerTarget } from "../pointer/usePointerTarget.js";
import { theme } from "../theme.js";

const S = theme.ui.select;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SelectProps<T extends string> {
  /** All available options. */
  options: readonly T[];
  /** Currently selected value. */
  value: T;
  /** Called when user picks a new option. */
  onChange: (value: T) => void;
  /** Human-readable labels for each option (defaults to the value itself). */
  optionLabels?: Partial<Record<T, string>>;
  /** Trigger width in terminal columns (default 22). */
  width?: number;
  disabled?: boolean;
  /** Muted label rendered above the trigger, e.g. "Platform". */
  label?: string;
}

// ---------------------------------------------------------------------------
// Option row (each item in the open list)
// ---------------------------------------------------------------------------

function OptionRow<T extends string>({
  option,
  label,
  selected,
  onSelect,
  width,
}: {
  option: T;
  label: string;
  selected: boolean;
  onSelect: (v: T) => void;
  width: number;
}): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const { hover, ripple } = usePointerTarget(ref, {
    onPress: () => onSelect(option),
  });

  const bg = ripple ? "#3A3A3C" : hover ? S.optionHoverBg : S.bg;
  const fg = selected ? S.optionActiveFg : hover ? "#FFFFFF" : S.muted;

  // Pad label so each row fills the full trigger width
  const innerWidth = width - 4; // 2 for border chars + 2 for padding
  const mark = selected ? "✓ " : "  ";
  const paddedLabel = (mark + label).padEnd(innerWidth);

  return (
    <Box ref={ref} paddingX={1}>
      <Text backgroundColor={bg} color={fg} bold={selected}>
        {` ${paddedLabel} `}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Select component
// ---------------------------------------------------------------------------

export function Select<T extends string>({
  options,
  value,
  onChange,
  optionLabels,
  width = 22,
  disabled = false,
  label,
}: SelectProps<T>): React.ReactElement {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<DOMElement>(null);

  const { hover, ripple } = usePointerTarget(triggerRef, {
    disabled,
    onPress: () => setOpen((o) => !o),
  });

  const handleSelect = (v: T): void => {
    onChange(v);
    setOpen(false);
  };

  const displayValue = optionLabels?.[value] ?? value;

  // Trigger border colour: cyan when open, lighter grey on hover, default grey
  const borderColor = open
    ? "cyan"
    : ripple
      ? "#8E8E93"
      : hover
        ? S.borderFocus
        : S.border;

  /** One logical line inside the trigger (avoids split `Text` rows fighting flex width). */
  const innerCols = Math.max(3, width - 2);
  const chevron = open ? "▴" : "▾";
  const valW = Math.max(1, innerCols - 2);
  let valStr = displayValue;
  if (valStr.length > valW) valStr = valStr.slice(0, Math.max(0, valW - 1)) + "…";
  const valuePadded = valStr.padEnd(valW);

  return (
    <Box flexDirection="column">
      {label ? (
        <Text color={S.muted}>{label}</Text>
      ) : null}

      {/* Trigger row */}
      <Box ref={triggerRef} borderStyle="round" borderColor={borderColor} width={width}>
        <Text dimColor={disabled}>
          <Text color={disabled ? S.muted : S.fg}>{` ${valuePadded}`}</Text>
          <Text color={open ? S.fg : S.muted}>{chevron}</Text>
        </Text>
      </Box>

      {/* Options list (inline, opens below trigger) */}
      {open && (
        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={S.border}
          width={width}
        >
          {options.map((opt) => (
            <OptionRow
              key={opt}
              option={opt}
              label={optionLabels?.[opt] ?? opt}
              selected={opt === value}
              onSelect={handleSelect}
              width={width}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
