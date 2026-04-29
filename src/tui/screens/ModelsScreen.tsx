/**
 * Models Screen — full-screen model manager for local LLMs.
 * Uses real ModelManager for downloads from HuggingFace.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import { Button } from "../components/Button.js";
import { Footer, Header, ScreenFrame } from "../components/Layout.js";
import { ProgressBar } from "../components/ProgressBar.js";
import TextInput from "../components/SafeTextInput.js";
import { icons } from "../components/icons.js";
import { theme } from "../theme.js";
import type { InstalledModel } from "../../llm/model_manager.js";
import type { Orchestrator } from "../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
  onBack: () => void;
}

type Tab = "browse" | "installed";

/** Verified working text-generation models for Transformers.js */
const PRESET_MODELS = [
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

/** Format bytes for display */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i] ?? "B"}`;
}

export function ModelsScreen({ orchestrator, onBack }: Props): React.ReactElement {
  const { models } = orchestrator;

  const [tab, setTab] = useState<Tab>("browse");
  const [installed, setInstalled] = useState<InstalledModel[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState({
    file: "",
    loaded: 0,
    total: 0,
  });
  const [error, setError] = useState<string | null>(null);
  const [customId, setCustomId] = useState("");

  // Refresh installed list
  const refreshInstalled = useCallback(() => {
    try {
      setInstalled(models.listInstalled());
      setActiveId(models.activeId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [models]);

  // Initial load
  useEffect(() => {
    refreshInstalled();
  }, [refreshInstalled]);

  const items = useMemo(() => {
    if (tab === "installed") {
      return installed.map((inst) => {
        const preset = PRESET_MODELS.find((p) => p.id === inst.id);
        return {
          id: inst.id,
          name: preset?.name || inst.id,
          description: preset?.description || `Custom model`,
          size: formatBytes(inst.sizeBytes),
          installed: true,
          active: activeId === inst.id,
          tags: preset?.tags || ["custom"],
        };
      });
    }
    return PRESET_MODELS.map((preset) => ({
      ...preset,
      installed: installed.some((i) => i.id === preset.id),
      active: activeId === preset.id,
    }));
  }, [tab, installed, activeId]);

  // Keyboard navigation
  useInput((input, key) => {
    if (key.tab) {
      setTab((t) => (t === "browse" ? "installed" : "browse"));
      setSelectedIndex(0);
      setError(null);
      return;
    }

    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
      return;
    }

    if (input === " " || input === "d") {
      const item = items[selectedIndex];
      if (item && !item.installed && !downloadingId) {
        void download(item.id);
      }
      return;
    }

    if (input === "c" && downloadingId) {
      cancelDownload();
      return;
    }

    if (input === "a" || input === "enter") {
      const item = items[selectedIndex];
      if (item && item.installed) {
        void activate(item.id);
      }
      return;
    }

    if (input === "r") {
      const item = items[selectedIndex];
      if (item && item.installed) {
        void remove(item.id);
      }
      return;
    }

    if (key.escape) {
      onBack();
      return;
    }
  });

  async function download(id: string): Promise<void> {
    setDownloadingId(id);
    setError(null);
    setDownloadProgress({ file: "", loaded: 0, total: 0 });

    try {
      await models.pull(id, (p) => {
        setDownloadProgress(p);
      });

      // Auto-activate if first model
      if (!activeId) {
        await models.select(id);
        setActiveId(id);
      }

      refreshInstalled();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes("cancelled")) {
        setError("Download cancelled");
      } else {
        setError(msg);
      }
    } finally {
      setDownloadingId(null);
    }
  }

  function cancelDownload(): void {
    models.cancelPull();
    setDownloadingId(null);
    setError("Download cancelled");
  }

  async function activate(id: string): Promise<void> {
    try {
      await models.select(id);
      setActiveId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await models.delete(id);
      refreshInstalled();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function downloadCustom(): Promise<void> {
    const id = customId.trim();
    if (!id) return;

    // Check if already installed
    if (installed.some((i) => i.id === id)) {
      setError(`Model ${id} is already installed`);
      return;
    }

    await download(id);
    setCustomId("");
  }

  const progressPercent =
    downloadProgress.total > 0
      ? (downloadProgress.loaded / downloadProgress.total) * 100
      : 0;

  return (
    <Box flexDirection="column" flexGrow={1}>
      <Box flexShrink={0}>
        <Header
          breadcrumb={["BotyTrader", "Models"]}
          onBack={onBack}
        />
      </Box>
      <Box flexGrow={1}>
        <ScreenFrame
          title="Model Manager"
          subtitle="Download and manage local LLMs from HuggingFace"
        >
          <Box flexDirection="column" minHeight={20}>
            {/* Tabs */}
            <Box flexDirection="row" marginBottom={1}>
              <Box paddingX={2}>
                <Text
                  bold={tab === "browse"}
                  backgroundColor={tab === "browse" ? theme.color.accent : undefined}
                  color={tab === "browse" ? "black" : theme.color.muted}
                >
                  Browse Models
                </Text>
              </Box>
              <Box paddingX={2}>
                <Text
                  bold={tab === "installed"}
                  backgroundColor={tab === "installed" ? theme.color.accent : undefined}
                  color={tab === "installed" ? "black" : theme.color.muted}
                >
                  Installed ({installed.length})
                </Text>
              </Box>
            </Box>

            {/* Error display */}
            {error && (
              <Box marginBottom={1} paddingX={1} borderStyle="single">
                <Text color={theme.color.danger}>Error: {error}</Text>
              </Box>
            )}

            {/* Info box */}
            <Box marginBottom={1} paddingX={1}>
              <Text color={theme.color.muted}>
                Download ONNX quantized models from HuggingFace. Models are cached locally and run via
                Transformers.js. Using verified Xenova models compatible with transformers.js.
              </Text>
            </Box>

            {/* Model cards */}
            <Box flexDirection="row" flexWrap="wrap">
              {items.map((item, index) => {
                const isSelected = index === selectedIndex;
                const isDownloading = downloadingId === item.id;

                return (
                  <Box
                    key={item.id}
                    width={50}
                    marginRight={2}
                    marginBottom={1}
                    borderStyle={isSelected ? "bold" : "single"}
                    borderColor={isSelected ? theme.color.accent : theme.color.muted}
                    paddingX={1}
                    paddingY={1}
                  >
                    <Box flexDirection="column">
                      <Box flexDirection="row" justifyContent="space-between">
                        <Text
                          bold
                          color={
                            item.active ? theme.color.success : isSelected ? theme.color.accent : theme.color.text
                          }
                        >
                          {item.name}
                        </Text>
                        <Text color={theme.color.muted}>{item.size}</Text>
                      </Box>

                      <Text color={theme.color.muted}>{item.description}</Text>

                      <Box flexDirection="row" flexWrap="wrap" marginTop={1}>
                        {item.tags.map((tag) => (
                          <Text key={tag} color={theme.color.accent}>
                            [{tag}]{" "}
                          </Text>
                        ))}
                      </Box>

                      {/* Actions */}
                      <Box marginTop={1} flexDirection="row">
                        {isDownloading ? (
                          <Box flexDirection="column">
                            <Text color={theme.color.muted}>
                              {downloadProgress.file || "Downloading..."}
                            </Text>
                            <ProgressBar percent={progressPercent} width={25} />
                            <Box marginTop={1}>
                              <Button
                                label="Cancel Download"
                                onClick={cancelDownload}
                                variant="danger"
                                minWidth={16}
                              />
                            </Box>
                          </Box>
                        ) : item.installed ? (
                          <>
                            <Button
                              label={item.active ? "Active ✓" : "Activate"}
                              onClick={() => void activate(item.id)}
                              variant={item.active ? "success" : "primary"}
                              minWidth={14}
                            />
                            <Box marginLeft={2}>
                              <Button
                                label="Remove"
                                onClick={() => void remove(item.id)}
                                variant="danger"
                                minWidth={10}
                              />
                            </Box>
                          </>
                        ) : (
                          <Button
                            label={`${icons.download} Download`}
                            onClick={() => void download(item.id)}
                            disabled={!!downloadingId}
                            variant="secondary"
                            minWidth={14}
                          />
                        )}
                      </Box>
                    </Box>
                  </Box>
                );
              })}
            </Box>

            {/* Custom model section */}
            <Box marginTop={2} marginBottom={1} flexDirection="column">
              <Text color={theme.color.accent} bold>
                Custom Model
              </Text>
              <Text color={theme.color.muted}>
                Enter any HuggingFace text-generation model ID (e.g., Xenova/model-name)
              </Text>
              <Box marginTop={1} flexDirection="row">
                <TextInput
                  placeholder="Model ID..."
                  value={customId}
                  onChange={setCustomId}
                  onSubmit={() => void downloadCustom()}
                />
                <Box marginLeft={1}>
                  <Button
                    label="Download"
                    onClick={() => void downloadCustom()}
                    disabled={!customId.trim() || !!downloadingId}
                    variant="secondary"
                    minWidth={14}
                  />
                </Box>
              </Box>
            </Box>

            {/* Status */}
            <Box marginTop={1}>
              <Text color={theme.color.muted}>
                Models run locally via Transformers.js. These Xenova models are pre-converted for compatibility.{"  "}
                {downloadingId && (
                  <Text color={theme.color.accent}>Downloading {downloadingId}...</Text>
                )}
              </Text>
            </Box>
          </Box>
        </ScreenFrame>
      </Box>
      <Box flexShrink={0}>
        <Footer
          hints={[
            "Tab: switch | ↑↓: navigate | D: download | A: activate | R: remove | C: cancel | Esc: back",
          ]}
        />
      </Box>
    </Box>
  );
}
