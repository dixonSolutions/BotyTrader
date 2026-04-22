/**
 * ModelList — installed models with select / delete actions.
 *
 * Two-step delete (press `d`, then `Enter` to confirm) avoids accidental
 * destruction of multi-GB downloads — security boundary by friction
 * (Goal-Gradient Effect: small barrier, large saved cost).
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

import { Panel } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import {
  formatBytes,
  type InstalledModel,
} from "../../../llm/model_manager.js";

interface Props {
  installed: InstalledModel[];
  activeId: string;
  selectedIdx: number;
  onSelectedIdxChange: (idx: number) => void;
  onMakeActive: (id: string) => Promise<void> | void;
  onDelete: (id: string) => Promise<void> | void;
  disabled: boolean;
}

export function ModelList({
  installed,
  activeId,
  selectedIdx,
  onSelectedIdxChange,
  onMakeActive,
  onDelete,
  disabled,
}: Props): React.ReactElement {
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  useInput((input, key) => {
    if (disabled) return;
    if (installed.length === 0) return;
    if (key.upArrow) {
      onSelectedIdxChange(Math.max(0, selectedIdx - 1));
      setPendingDelete(null);
      return;
    }
    if (key.downArrow) {
      onSelectedIdxChange(Math.min(installed.length - 1, selectedIdx + 1));
      setPendingDelete(null);
      return;
    }
    const current = installed[selectedIdx];
    if (!current) return;

    if (input === "d") {
      setPendingDelete(current.id);
      return;
    }
    if (key.escape) {
      setPendingDelete(null);
      return;
    }
    if (key.return) {
      if (pendingDelete && pendingDelete === current.id) {
        setPendingDelete(null);
        void onDelete(current.id);
        return;
      }
      void onMakeActive(current.id);
    }
  });

  if (installed.length === 0) {
    return (
      <Panel>
        <Text color={theme.color.muted}>
          No models installed yet. Press `2` to install one by entering its
          Hugging Face repo id (e.g. `TigerTrading/TradingBot`).
        </Text>
      </Panel>
    );
  }

  return (
    <Panel>
      {installed.map((model, i) => {
        const focused = i === selectedIdx;
        const active = model.id === activeId;
        const danger = pendingDelete === model.id && focused;
        return (
          <Box key={model.id} flexDirection="column" marginBottom={i === installed.length - 1 ? 0 : 1}>
            <Box>
              <Text color={focused ? theme.color.accent : theme.color.text}>
                {focused ? "› " : "  "}
              </Text>
              <Text
                bold={focused}
                color={
                  danger
                    ? theme.color.danger
                    : active
                      ? theme.color.success
                      : focused
                        ? theme.color.accent
                        : theme.color.text
                }
              >
                {model.id}
              </Text>
              <Text color={theme.color.muted}>{"  "}</Text>
              {active ? <Text color={theme.color.success}>active</Text> : null}
            </Box>
            <Box paddingLeft={2}>
              <Text color={theme.color.muted}>
                {formatBytes(model.sizeBytes)} · updated {model.modifiedAt.replace("T", " ").slice(0, 19)}
              </Text>
            </Box>
            {danger ? (
              <Box paddingLeft={2}>
                <Text color={theme.color.danger}>Press Enter again to delete · Esc to cancel</Text>
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Panel>
  );
}
