/**
 * Models Home Card — download and manage local trading LLMs from HuggingFace.
 * Uses the actual ModelManager for real model downloads.
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text } from "ink";

import { Button } from "../../components/Button.js";
import { Panel, StatRow } from "../../components/Layout.js";
import { ProgressBar } from "../../components/ProgressBar.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import type { Orchestrator } from "../../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
  onSelect: () => void;
}

/** Verified working text-generation models for Transformers.js */
const RECOMMENDED_MODELS = [
  {
    id: "Xenova/distilgpt2",
    name: "DistilGPT2",
    description: "Smallest and fastest — great for simple text generation",
    size: "~90 MB",
    tags: ["fast", "tiny", "gpt2"],
  },
  {
    id: "Xenova/TinyLlama-1.1B-Chat-v1.0",
    name: "TinyLlama 1.1B",
    description: "Efficient 1.1B chat model for trading decisions",
    size: "~600 MB",
    tags: ["efficient", "1.1B", "chat"],
  },
  {
    id: "Xenova/Phi-3-mini-4k-instruct",
    name: "Phi-3-mini",
    description: "Microsoft's powerful reasoning model",
    size: "~2 GB",
    tags: ["reasoning", "3.8B", "microsoft"],
  },
  {
    id: "Xenova/Qwen1.5-0.5B-Chat",
    name: "Qwen1.5-0.5B",
    description: "Chinese-friendly chat model for Asian markets",
    size: "~350 MB",
    tags: ["chinese", "0.5B", "chat"],
  },
];

export function ModelsCard({ orchestrator, onSelect }: Props): React.ReactElement {
  const { models } = orchestrator;
  const [installing, setInstalling] = useState<string | null>(null);
  const [progress, setProgress] = useState({ file: "", loaded: 0, total: 0 });
  const [installedIds, setInstalledIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Load installed models on mount
  useEffect(() => {
    try {
      const installed = models.listInstalled();
      setInstalledIds(installed.map((m) => m.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [models]);

  const activeId = models.activeId;

  const modelsList = useMemo(() => {
    return RECOMMENDED_MODELS.map((m) => ({
      ...m,
      installed: installedIds.includes(m.id),
      active: activeId === m.id,
    }));
  }, [installedIds, activeId]);

  async function installModel(modelId: string): Promise<void> {
    setInstalling(modelId);
    setError(null);
    setProgress({ file: "", loaded: 0, total: 0 });

    try {
      await models.pull(modelId, (p) => {
        setProgress({ file: p.file, loaded: p.loaded, total: p.total });
      });

      setInstalledIds((prev) => [...prev, modelId]);

      // Auto-activate first installed model
      if (!activeId) {
        await models.select(modelId);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("cancelled")) {
        setError("Download cancelled");
      } else {
        setError(msg);
      }
    } finally {
      setInstalling(null);
    }
  }

  function cancelInstall(): void {
    models.cancelPull();
    setInstalling(null);
    setError("Download cancelled");
  }

  async function activateModel(modelId: string): Promise<void> {
    try {
      await models.select(modelId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const showProgress = installing && progress.total > 0;
  const progressPercent = showProgress ? (progress.loaded / progress.total) * 100 : 0;

  return (
    <Panel title="Models" accent={theme.color.accent}>
      <Box flexDirection="column">
        <Text color={theme.color.muted}>
          Download local LLMs for intelligent trading decisions.
        </Text>

        {activeId ? (
          <Box marginTop={1} marginBottom={1}>
            <StatRow
              label="Active"
              value={RECOMMENDED_MODELS.find((m) => m.id === activeId)?.name || activeId}
              valueColor={theme.color.success}
            />
          </Box>
        ) : (
          <Box marginTop={1} marginBottom={1}>
            <Text color={theme.color.warn}>No model active</Text>
          </Box>
        )}

        {error && (
          <Box marginTop={1} marginBottom={1}>
            <Text color={theme.color.danger}>Error: {error}</Text>
          </Box>
        )}

        <Box marginTop={1}>
          {modelsList.slice(0, 2).map((model) => {
            const isInstalling = installing === model.id;

            return (
              <Box key={model.id} marginBottom={1} flexDirection="column">
                <Box flexDirection="row" justifyContent="space-between">
                  <Text bold color={model.active ? theme.color.success : theme.color.text}>
                    {model.name}
                  </Text>
                  <Text color={theme.color.muted}>{model.size}</Text>
                </Box>

                <Text color={theme.color.muted}>{model.description}</Text>

                <Box flexDirection="row" flexWrap="wrap">
                  {model.tags.map((tag) => (
                    <Text key={tag} color={theme.color.accent}>
                      [{tag}]{" "}
                    </Text>
                  ))}
                </Box>

                {isInstalling ? (
                  <Box marginTop={1} flexDirection="column">
                    <Text color={theme.color.muted}>
                      {progress.file || "Downloading..."}
                    </Text>
                    <ProgressBar percent={progressPercent} width={25} />
                    <Box marginTop={1}>
                      <Button
                        label="Cancel"
                        onClick={cancelInstall}
                        variant="danger"
                        minWidth={12}
                      />
                    </Box>
                  </Box>
                ) : model.installed ? (
                  <Box marginTop={1} flexDirection="row">
                    <Button
                      label={model.active ? "Active ✓" : "Activate"}
                      onClick={() => void activateModel(model.id)}
                      variant={model.active ? "success" : "primary"}
                      minWidth={12}
                    />
                    <Text color={theme.color.success}> {icons.check} Installed</Text>
                  </Box>
                ) : (
                  <Box marginTop={1}>
                    <Button
                      label="Download"
                      icon={icons.download}
                      onClick={() => void installModel(model.id)}
                      disabled={!!installing}
                      variant="secondary"
                      minWidth={14}
                    />
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>

        <Box marginTop={1}>
          <Button
            label="Open Model Manager →"
            onClick={onSelect}
            variant="primary"
            minWidth={25}
          />
        </Box>
      </Box>
    </Panel>
  );
}
