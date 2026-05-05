/**
 * Technical Indicators Configuration — 10 professional indicators
 *
 * - Checkboxes for enable/disable (full-row `Toggle`)
 * - Click the teal weight %: popover renders **above that row** (attached in layout),
 *   opaque bubble + ▼ tail, with bordered `Input` + Save/Cancel
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text, type DOMElement } from "ink";
import { Button } from "../../components/Button.js";
import { Toggle } from "../../components/Toggle.js";
import { EditDialog, ConfirmDialog } from "../../components/EditDialog.js";
import { Panel } from "../../components/Layout.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import { usePointerTarget } from "../../pointer/usePointerTarget.js";
import type { Orchestrator } from "../../../orchestrator.js";
import type { Config } from "../../../config.js";
import { TECHNICAL_INDICATORS_METADATA } from "../../../signal/types.js";

/** Left indent so the popover sits over the weight column (Panel pad + row pad + cols before weight, minus half popover width). */
const WEIGHT_POPOVER_WIDTH = 46;
const WEIGHT_POPOVER_INDENT = Math.max(
  0,
  theme.padding + 1 + 4 + 26 + 4 - Math.floor(WEIGHT_POPOVER_WIDTH / 2),
);

interface Props {
  orchestrator: Orchestrator;
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
}

type IndicatorId = keyof Config["indicators"];

function IndicatorWeightCell({
  index,
  weightLabel,
  fgColor,
  onSelectRow,
  onOpenWeightEditor,
}: {
  index: number;
  weightLabel: string;
  fgColor: string;
  onSelectRow: (i: number) => void;
  onOpenWeightEditor: (i: number) => void;
}): React.ReactElement {
  const ref = useRef<DOMElement>(null);
  const { hover } = usePointerTarget(ref, {
    onPress: () => {
      onSelectRow(index);
      onOpenWeightEditor(index);
    },
  });

  return (
    <Box ref={ref} width={8}>
      <Text color={fgColor} bold={hover} underline={hover}>
        {weightLabel}
      </Text>
    </Box>
  );
}

export function IndicatorsEditor({
  orchestrator,
  active,
  focusRowId,
  onFocusRowConsumed,
}: Props): React.ReactElement {
  const { config } = orchestrator;
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [weightEditIndex, setWeightEditIndex] = useState<number | null>(null);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [editingWeight, setEditingWeight] = useState(false);
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;
  void active;

  useEffect(() => {
    if (focusRowId == null) return;
    const idx = TECHNICAL_INDICATORS_METADATA.findIndex((ind) => ind.id === focusRowId);
    if (idx >= 0) setSelectedIndex(idx);
    consumeRef.current?.();
  }, [focusRowId]);

  const totalWeight = Object.values(config.indicators).reduce(
    (sum, ind) => sum + (ind.enabled ? ind.weight : 0),
    0,
  );
  const weightStatus = totalWeight === 1 ? "balanced" : totalWeight > 1 ? "overweight" : "underweight";

  const selectedIndicator = TECHNICAL_INDICATORS_METADATA[selectedIndex];
  const selectedConfig = selectedIndicator
    ? config.indicators[selectedIndicator.id as IndicatorId]
    : null;

  const editMeta =
    editingWeight && weightEditIndex !== null ? TECHNICAL_INDICATORS_METADATA[weightEditIndex] : null;
  const editConfig = editMeta ? config.indicators[editMeta.id as IndicatorId] : null;

  const handleToggle = (index: number): void => {
    const indicatorId = TECHNICAL_INDICATORS_METADATA[index]?.id as IndicatorId;
    if (!indicatorId) return;
    orchestrator.setIndicatorEnabled(indicatorId, !config.indicators[indicatorId]?.enabled);
  };

  const openWeightEditor = (index: number): void => {
    setSelectedIndex(index);
    setWeightEditIndex(index);
    setEditingWeight(true);
  };

  const closeWeightEditor = (): void => {
    setEditingWeight(false);
    setWeightEditIndex(null);
  };

  const handleWeightSave = (value: string): void => {
    if (weightEditIndex === null) return;
    const meta = TECHNICAL_INDICATORS_METADATA[weightEditIndex];
    if (!meta) return;

    const numValue = parseFloat(value);
    if (!Number.isFinite(numValue) || numValue < 0 || numValue > 100) {
      return;
    }

    orchestrator.setIndicatorWeight(meta.id as IndicatorId, numValue / 100);
    closeWeightEditor();
  };

  const handleReset = (): void => {
    if (!showResetConfirm) {
      setShowResetConfirm(true);
      return;
    }
    orchestrator.resetIndicatorWeights();
    setShowResetConfirm(false);
  };

  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={theme.color.border} paddingX={1} marginBottom={1} flexDirection="column">
        <Text bold>Technical Indicators — 10 Professional Signals</Text>
        <Text color={theme.color.muted}>
          Total weight:{" "}
          <Text color={weightStatus === "balanced" ? theme.color.success : theme.color.warn}>
            {(totalWeight * 100).toFixed(0)}%
          </Text>
          {weightStatus === "balanced" ? " (balanced)" : weightStatus === "overweight" ? " (reduce weights)" : " (can add more)"}
        </Text>
        <Text color={theme.color.muted}>
          Click the checkbox to enable/disable. Click the teal weight % to edit (popover opens above that row).
        </Text>
      </Box>

      <Panel>
        <Box flexDirection="column" gap={1}>
          {TECHNICAL_INDICATORS_METADATA.map((ind, index) => {
            const configIndicator = config.indicators[ind.id as IndicatorId];
            const weight = configIndicator?.weight ?? ind.defaultWeight;
            const enabled = configIndicator?.enabled ?? true;
            const isSelected = index === selectedIndex;
            const weightLabel = `${(weight * 100).toFixed(0)}%`;

            return (
              <Box key={ind.id} flexDirection="column" gap={0}>
                {editingWeight && weightEditIndex === index && editMeta && editConfig ? (
                  <EditDialog
                    isOpen
                    title={`${editMeta.name} — weight`}
                    value={(editConfig.weight * 100).toFixed(0)}
                    placeholder="15"
                    onSave={handleWeightSave}
                    onCancel={closeWeightEditor}
                    message={`Current: ${(editConfig.weight * 100).toFixed(0)}%`}
                    valueType="Percentage (0-100)"
                    originalValue={(editConfig.weight * 100).toFixed(0) + "%"}
                    width={WEIGHT_POPOVER_WIDTH}
                    anchorMarginLeft={WEIGHT_POPOVER_INDENT}
                    validate={(v) => {
                      const num = parseFloat(v);
                      if (!Number.isFinite(num)) return { valid: false, error: "Must be a number" };
                      if (num < 0 || num > 100) return { valid: false, error: "Must be 0-100" };
                      return { valid: true };
                    }}
                  />
                ) : null}

                <Box flexDirection="row" alignItems="center" paddingX={1} paddingY={0}>
                  <Box width={4}>
                    <Text color={isSelected ? theme.color.accent : theme.color.text}>
                      {index + 1}.
                    </Text>
                  </Box>
                  <Box width={26}>
                    <Text color={enabled ? theme.color.text : theme.color.muted}>
                      {ind.name.length > 24 ? ind.name.slice(0, 22) + "…" : ind.name}
                    </Text>
                  </Box>

                  <IndicatorWeightCell
                    index={index}
                    weightLabel={weightLabel}
                    fgColor={enabled ? theme.color.primary : theme.color.muted}
                    onSelectRow={setSelectedIndex}
                    onOpenWeightEditor={openWeightEditor}
                  />

                  <Box width={12}>
                    <Text color={theme.color.muted}>{ind.category}</Text>
                  </Box>

                  <Box width={12} marginLeft={1}>
                    <Toggle enabled={enabled} onToggle={() => handleToggle(index)} />
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>

        <ConfirmDialog
          isOpen={showResetConfirm}
          title="Reset Weights?"
          message="This will reset all indicator weights to their default values."
          onConfirm={() => {
            orchestrator.resetIndicatorWeights();
            setShowResetConfirm(false);
          }}
          onCancel={() => setShowResetConfirm(false)}
          confirmLabel="Reset"
          cancelLabel="Cancel"
          variant="danger"
          icon={icons.reset}
        />

        {selectedIndicator && selectedConfig && (
          <Box
            flexDirection="column"
            borderStyle="single"
            borderColor={theme.color.accent}
            paddingX={2}
            paddingY={1}
            marginTop={1}
          >
            <Text bold color={theme.color.primary}>
              {selectedIndicator.name} ({selectedIndicator.category})
            </Text>
            <Text color={theme.color.muted}>{selectedIndicator.description}</Text>
            <Box marginTop={1} flexDirection="row">
              <Text color={theme.color.muted}>Buy logic: </Text>
              <Text>{selectedIndicator.buyLogic}</Text>
            </Box>
            <Box flexDirection="row">
              <Text color={theme.color.muted}>Formula: </Text>
              <Text>{selectedIndicator.formulaSource}</Text>
            </Box>

            <Box marginTop={1} flexDirection="row" gap={2}>
              <Button
                label={selectedConfig.enabled ? "Disable" : "Enable"}
                icon={selectedConfig.enabled ? icons.close : icons.check}
                onClick={() =>
                  orchestrator.setIndicatorEnabled(
                    selectedIndicator.id as IndicatorId,
                    !selectedConfig.enabled,
                  )
                }
                variant={selectedConfig.enabled ? "secondary" : "success"}
                minWidth={12}
              />
            </Box>
          </Box>
        )}

        <Box marginTop={2} flexDirection="row" gap={2}>
          <Button
            label="Reset to Defaults"
            icon={icons.reset}
            onClick={handleReset}
            variant="secondary"
            minWidth={20}
          />
        </Box>
      </Panel>
    </Box>
  );
}
