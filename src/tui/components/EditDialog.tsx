/**
 * Edit Dialog — opaque popover-style panel (solid fill, not see-through).
 *
 * Ink cannot do real CSS shadows or GPU opacity stacks; we avoid translucent
 * overlays and paint every line with a solid background so the panel reads as
 * a proper bubble. Optional ▼ caret suggests anchor to the control below.
 */

import React, { useState, useEffect } from "react";
import { Box, Text } from "ink";
import { Button } from "./Button.js";
import TextInput from "./SafeTextInput.js";
import { icons } from "./icons.js";
import { theme } from "../theme.js";

const P = theme.ui.popover;

export interface EditDialogProps {
  isOpen: boolean;
  title: string;
  value: string;
  placeholder?: string;
  onSave: (value: string) => void;
  onCancel: () => void;
  icon?: string;
  message?: string;
  validate?: (value: string) => { valid: boolean; error?: string };
  width?: number;
  valueType?: string;
  originalValue?: string;
  /**
   * When set, the popover is left-indented so it sits above a trigger (e.g. weight %)
   * instead of centered in the full screen width.
   */
  anchorMarginLeft?: number;
}

/** Pad inner content to fixed width so the surface reads as a solid block. */
function fillLine(inner: string, innerCols: number): string {
  const t = inner.trimEnd();
  if (t.length >= innerCols) return t.slice(0, innerCols);
  return t + " ".repeat(innerCols - t.length);
}

function centerGlyph(glyph: string, innerCols: number): string {
  if (innerCols <= glyph.length) return glyph.slice(0, innerCols);
  const pad = Math.floor((innerCols - glyph.length) / 2);
  return " ".repeat(pad) + glyph + " ".repeat(innerCols - pad - glyph.length);
}

export function EditDialog({
  isOpen,
  title,
  value,
  placeholder = "",
  onSave,
  onCancel,
  icon = icons.edit,
  message,
  validate,
  width = 50,
  valueType,
  originalValue,
  anchorMarginLeft,
}: EditDialogProps): React.ReactElement | null {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setDraft(value);
      setError(null);
    }
  }, [isOpen, value]);

  if (!isOpen) return null;

  const handleSave = (): void => {
    if (validate) {
      const result = validate(draft);
      if (!result.valid) {
        setError(result.error ?? "Invalid value");
        return;
      }
    }
    if (!draft.trim()) {
      setError("Value cannot be empty");
      return;
    }
    onSave(draft.trim());
  };

  const handleCancel = (): void => {
    setDraft(value);
    setError(null);
    onCancel();
  };

  const innerCols = Math.max(20, width - 4);
  const titlePrefix = `${icon}  `;
  const titleLine =
    title.length + titlePrefix.length > innerCols
      ? titlePrefix + title.slice(0, Math.max(1, innerCols - titlePrefix.length - 1)) + "…"
      : titlePrefix + title;

  const line = (s: string, opts?: { bold?: boolean; color?: string; dim?: boolean }) => (
    <Text
      backgroundColor={P.surface}
      color={opts?.color ?? P.bodyFg}
      bold={opts?.bold}
      dimColor={opts?.dim}
    >
      {` ${fillLine(s, innerCols)} `}
    </Text>
  );

  const anchored = anchorMarginLeft !== undefined;

  const bubble = (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={P.border}
      width={width}
      paddingX={0}
      paddingY={0}
    >
      {line(titleLine, { bold: true, color: P.titleFg })}
      {line("─".repeat(Math.min(innerCols, 24)), { color: P.border, dim: true })}
      {message ? line(message, { dim: true }) : null}
      {line("Edit value · Esc cancel · Enter save", { dim: true, color: P.mutedFg })}

      <Box paddingX={1} paddingY={0} flexDirection="column">
        <Box marginTop={0}>
          <TextInput
            value={draft}
            onChange={setDraft}
            onSubmit={handleSave}
            onEscape={handleCancel}
            placeholder={placeholder}
            focus
          />
        </Box>
      </Box>

      {error ? (
        <Text backgroundColor={P.surface} color="red">
          {` ${fillLine(`⚠ ${error}`, innerCols)} `}
        </Text>
      ) : null}

      {originalValue !== undefined && originalValue !== draft ? (
        line(`Original: ${originalValue}`, { dim: true, color: P.mutedFg })
      ) : null}

      {valueType ? line(`Type: ${valueType}`, { dim: true, color: P.mutedFg }) : null}

      <Box flexDirection="row" gap={2} paddingBottom={1} paddingTop={1} paddingX={1} justifyContent="center">
        <Button label="Cancel" onClick={handleCancel} variant="secondary" minWidth={12} />
        <Button label="Save" icon={icons.check} onClick={handleSave} variant="primary" minWidth={12} />
      </Box>
    </Box>
  );

  const tail = (
    <Text backgroundColor={P.surface} color={P.caret}>
      {` ${fillLine(centerGlyph("▼", innerCols), innerCols)} `}
    </Text>
  );

  if (anchored) {
    return (
      <Box flexDirection="column" alignItems="flex-start" marginBottom={0} marginTop={0} marginLeft={anchorMarginLeft}>
        {bubble}
        {tail}
      </Box>
    );
  }

  return (
    <Box flexDirection="column" alignItems="center" marginY={1}>
      {bubble}
      {tail}
    </Box>
  );
}

export function ConfirmDialog({
  isOpen,
  title,
  message,
  onConfirm,
  onCancel,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "danger",
  icon = "⚠",
}: {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "primary";
  icon?: string;
}): React.ReactElement | null {
  if (!isOpen) return null;

  const w = 46;
  const innerCols = w - 4;

  const line = (s: string, opts?: { bold?: boolean; color?: string; dim?: boolean }) => (
    <Text
      backgroundColor={P.surface}
      color={opts?.color ?? P.bodyFg}
      bold={opts?.bold}
      dimColor={opts?.dim}
    >
      {` ${s.length > innerCols ? s.slice(0, innerCols - 1) + "…" : s + " ".repeat(Math.max(0, innerCols - s.length))} `}
    </Text>
  );

  return (
    <Box flexDirection="column" alignItems="center" marginY={1}>
      <Box flexDirection="column" borderStyle="round" borderColor={P.border} width={w}>
        {line(title, { bold: true, color: P.titleFg })}
        {line("─".repeat(Math.min(20, innerCols)), { color: P.border, dim: true })}
        <Box paddingX={1} paddingY={1} flexDirection="column" alignItems="center">
          <Text color={variant === "danger" ? "red" : "#FF6B00"} bold backgroundColor={P.surface}>
            {` ${icon} `}
          </Text>
          <Box marginTop={1}>
            <Text backgroundColor={P.surface} color={P.bodyFg} wrap="truncate-end">
              {message.length > innerCols * 3 ? message.slice(0, innerCols * 3 - 1) + "…" : message}
            </Text>
          </Box>
        </Box>
        <Box flexDirection="row" gap={2} paddingBottom={1} paddingX={1} justifyContent="center">
          <Button label={cancelLabel} onClick={onCancel} variant="secondary" minWidth={12} />
          <Button label={confirmLabel} onClick={onConfirm} variant={variant} minWidth={12} />
        </Box>
      </Box>
    </Box>
  );
}
