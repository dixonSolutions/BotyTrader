/**
 * ModelDetails — read-only inspector for the currently focused model.
 *
 * Surfaces the same fields a user might check before deleting (size, path,
 * mtime, active flag) so they don't have to guess. Pure presentation —
 * mutation lives in `ModelList` to keep responsibilities single.
 */

import React from "react";
import { Box, Text } from "ink";

import { Panel, StatRow } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import { formatBytes, type InstalledModel } from "../../../llm/model_manager.js";

interface Props {
  model: InstalledModel | null;
  activeId: string;
}

export function ModelDetails({ model, activeId }: Props): React.ReactElement {
  if (!model) {
    return (
      <Panel>
        <Text color={theme.color.muted}>
          No model selected. Switch to the Installed tab and pick one to inspect.
        </Text>
      </Panel>
    );
  }
  const isActive = model.id === activeId;
  return (
    <Panel title={model.id}>
      <Box flexDirection="column">
        <StatRow label="Status" value={isActive ? "active (powering agent)" : "installed"} valueColor={isActive ? theme.color.success : theme.color.text} />
        <StatRow label="On disk" value={formatBytes(model.sizeBytes)} />
        <StatRow label="Modified" value={model.modifiedAt.replace("T", " ").slice(0, 19)} />
        <StatRow label="Path" value={model.path} />
      </Box>
    </Panel>
  );
}
