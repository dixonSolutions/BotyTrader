/**
 * Input Component
 *
 * Styled input field with rounded borders matching the design:
 * - Rounded rectangular border (┌─┐ style)
 * - Dark background (#1A1A1A)
 * - White text
 * - Cursor highlighting
 * - Placeholder support
 *
 * Used for all text input throughout the TUI.
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useInput } from "ink";
import chalk from "chalk";

export interface InputProps {
  /** Current value */
  value: string;
  /** Change handler */
  onChange: (value: string) => void;
  /** Submit handler (called on Enter) */
  onSubmit?: (value: string) => void;
  /** Placeholder text shown when empty */
  placeholder?: string;
  /** Whether input has focus */
  focus?: boolean;
  /** Character to mask input (for passwords) */
  mask?: string;
  /** Width in characters (default: 30) */
  width?: number;
  /** Input is disabled */
  disabled?: boolean;
  /** Optional prefix (e.g., "$" for currency) */
  prefix?: string;
  /** Optional suffix (e.g., "%" for percentages) */
  suffix?: string;
}

/**
 * Styled input field with rounded borders.
 *
 * Visual design:
 *   ┌──────────────────────────────┐
 *   │ $ 100.00              %      │
 *   └──────────────────────────────┘
 *
 * Focus state shows cursor:
 *   ┌──────────────────────────────┐
 *   │ $ 1▋00.00             %      │
 *   └──────────────────────────────┘
 */
export function Input({
  value: originalValue,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
  mask,
  width = 30,
  disabled = false,
  prefix,
  suffix,
}: InputProps): React.ReactElement {
  const [cursorOffset, setCursorOffset] = useState(originalValue.length);

  // Sync cursor when value changes externally
  useEffect(() => {
    if (!focus) return;
    setCursorOffset((prev) => {
      if (prev > originalValue.length) {
        return originalValue.length;
      }
      return prev;
    });
  }, [originalValue, focus]);

  useInput(
    (input, key) => {
      if (!focus || disabled) return;

      if (key.return) {
        onSubmit?.(originalValue);
        return;
      }

      let nextCursorOffset = cursorOffset;
      let nextValue = originalValue;

      if (key.leftArrow) {
        nextCursorOffset = Math.max(0, cursorOffset - 1);
      } else if (key.rightArrow) {
        nextCursorOffset = Math.min(originalValue.length, cursorOffset + 1);
      } else if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
          nextValue =
            originalValue.slice(0, cursorOffset - 1) +
            originalValue.slice(cursorOffset);
          nextCursorOffset--;
        }
      } else if (input && !key.ctrl && !key.meta) {
        // Filter out terminal escape sequences
        if (input.includes("\x1b") || input.startsWith("[")) {
          return;
        }
        nextValue =
          originalValue.slice(0, cursorOffset) +
          input +
          originalValue.slice(cursorOffset);
        nextCursorOffset += input.length;
      }

      setCursorOffset(nextCursorOffset);
      if (nextValue !== originalValue) {
        onChange(nextValue);
      }
    },
    { isActive: focus && !disabled },
  );

  // Render the value with cursor
  const renderContent = (): string => {
    const displayValue = mask
      ? mask.repeat(originalValue.length)
      : originalValue;

    if (!focus || disabled) {
      return displayValue || placeholder;
    }

    // Show placeholder with inverted first char when empty
    if (!displayValue && placeholder) {
      return chalk.inverse(placeholder[0]) + chalk.gray(placeholder.slice(1));
    }

    // Insert cursor at position
    if (cursorOffset >= displayValue.length) {
      return displayValue + chalk.inverse(" ");
    }

    let result = "";
    let i = 0;
    for (const char of displayValue) {
      if (i === cursorOffset) {
        result += chalk.inverse(char);
      } else {
        result += char;
      }
      i++;
    }
    return result;
  };

  const content = renderContent();
  const contentWidth = mask
    ? originalValue.length
    : originalValue.length || placeholder.length;

  // Calculate padding to fill the box
  const prefixWidth = prefix ? prefix.length + 1 : 0;
  const suffixWidth = suffix ? suffix.length + 1 : 0;
  const availableWidth = width - prefixWidth - suffixWidth - 2; // -2 for borders
  const padding = Math.max(0, availableWidth - contentWidth);

  // Build the horizontal line
  const horizontalLine = "─".repeat(width - 2);

  return (
    <Box flexDirection="column">
      {/* Top border */}
      <Text color={focus ? "#FF6B00" : "gray"}>{`┌${horizontalLine}┐`}</Text>

      {/* Content row */}
      <Box flexDirection="row">
        <Text color={focus ? "#FF6B00" : "gray"}>│</Text>
        {prefix ? (
          <Text color="gray">{`${prefix} `}</Text>
        ) : null}
        <Text
          color={disabled ? "gray" : originalValue ? "white" : "gray"}
          dimColor={!originalValue && !!placeholder}
        >
          {content}
        </Text>
        {padding > 0 ? (
          <Text>{" ".repeat(padding)}</Text>
        ) : null}
        {suffix ? (
          <Text color="gray">{` ${suffix}`}</Text>
        ) : null}
        <Text color={focus ? "#FF6B00" : "gray"}>│</Text>
      </Box>

      {/* Bottom border */}
      <Text color={focus ? "#FF6B00" : "gray"}>{`└${horizontalLine}┘`}</Text>
    </Box>
  );
}

/**
 * Compact inline input without borders.
 * Good for inline editing within tables.
 */
export function InlineInput({
  value: originalValue,
  onChange,
  onSubmit,
  placeholder = "",
  focus = true,
  mask,
  width = 20,
  disabled = false,
}: InputProps): React.ReactElement {
  const [cursorOffset, setCursorOffset] = useState(originalValue.length);

  useEffect(() => {
    if (!focus) return;
    setCursorOffset((prev) => {
      if (prev > originalValue.length) {
        return originalValue.length;
      }
      return prev;
    });
  }, [originalValue, focus]);

  useInput(
    (input, key) => {
      if (!focus || disabled) return;

      if (key.return) {
        onSubmit?.(originalValue);
        return;
      }

      let nextCursorOffset = cursorOffset;
      let nextValue = originalValue;

      if (key.leftArrow) {
        nextCursorOffset = Math.max(0, cursorOffset - 1);
      } else if (key.rightArrow) {
        nextCursorOffset = Math.min(originalValue.length, cursorOffset + 1);
      } else if (key.backspace || key.delete) {
        if (cursorOffset > 0) {
          nextValue =
            originalValue.slice(0, cursorOffset - 1) +
            originalValue.slice(cursorOffset);
          nextCursorOffset--;
        }
      } else if (input && !key.ctrl && !key.meta) {
        if (input.includes("\x1b") || input.startsWith("[")) {
          return;
        }
        nextValue =
          originalValue.slice(0, cursorOffset) +
          input +
          originalValue.slice(cursorOffset);
        nextCursorOffset += input.length;
      }

      setCursorOffset(nextCursorOffset);
      if (nextValue !== originalValue) {
        onChange(nextValue);
      }
    },
    { isActive: focus && !disabled },
  );

  const displayValue = mask ? mask.repeat(originalValue.length) : originalValue;

  let renderedValue = displayValue;
  if (!displayValue && placeholder) {
    renderedValue = chalk.inverse(placeholder[0]) + chalk.gray(placeholder.slice(1));
  } else if (focus && !disabled) {
    if (cursorOffset >= displayValue.length) {
      renderedValue = displayValue + chalk.inverse(" ");
    } else {
      let result = "";
      let i = 0;
      for (const char of displayValue) {
        if (i === cursorOffset) {
          result += chalk.inverse(char);
        } else {
          result += char;
        }
        i++;
      }
      renderedValue = result;
    }
  }

  const contentWidth = displayValue.length || placeholder.length;
  const padding = Math.max(0, width - contentWidth);

  return (
    <Text
      backgroundColor={focus ? "#333333" : undefined}
      color={disabled ? "gray" : originalValue ? "white" : "gray"}
    >
      {` ${renderedValue}${" ".repeat(padding)} `}
    </Text>
  );
}
