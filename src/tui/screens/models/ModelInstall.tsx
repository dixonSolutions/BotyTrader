/**
 * ModelInstall — pull a Hugging Face model id with a real progress bar.
 *
 * The user types any HF repo id (e.g. `TigerTrading/TradingBot`,
 * `onnx-community/Qwen2.5-0.5B-Instruct`) and we forward the download to
 * `@huggingface/transformers`. Progress is sourced directly from the
 * library's per-file events so the bar reflects the actual byte stream
 * (Doherty Threshold: keep the user informed every <400 ms).
 */

import React, { useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import TextInput from "ink-text-input";

import { Panel } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import { formatBytes, type PullProgress } from "../../../llm/model_manager.js";

interface Props {
  disabled: boolean;
  onPull: (
    id: string,
    onProgress: (p: PullProgress) => void,
  ) => Promise<void>;
  onSelectAfterPull: (id: string) => Promise<void>;
}

interface PullState {
  id: string;
  fileToProgress: Map<string, PullProgress>;
  done: boolean;
  error?: string;
}

export function ModelInstall({ disabled, onPull, onSelectAfterPull }: Props): React.ReactElement {
  const [draftId, setDraftId] = useState("");
  const [state, setState] = useState<PullState | null>(null);

  useInput((input, key) => {
    if (disabled) return;
    if (!state) return;
    if (state.done && !state.error && input === "a") {
      void onSelectAfterPull(state.id);
      return;
    }
    if (state.done && key.escape) {
      setState(null);
      setDraftId("");
    }
  });

  async function startPull(id: string): Promise<void> {
    const trimmed = id.trim();
    if (!trimmed) return;
    const initial: PullState = { id: trimmed, fileToProgress: new Map(), done: false };
    setState(initial);
    try {
      await onPull(trimmed, (p) => {
        setState((prev) => {
          if (!prev || prev.id !== trimmed) return prev;
          const next = new Map(prev.fileToProgress);
          next.set(p.file, p);
          return { ...prev, fileToProgress: next };
        });
      });
      setState((prev) => (prev && prev.id === trimmed ? { ...prev, done: true } : prev));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setState((prev) =>
        prev && prev.id === trimmed ? { ...prev, done: true, error: message } : prev,
      );
    }
  }

  if (state) return <PullView state={state} />;

  return (
    <Panel title="Install a Hugging Face model">
      <Text color={theme.color.muted}>
        Enter the full repo id for a causal / chat model (e.g. `TigerTrading/TradingBot`,
        `onnx-community/Qwen2.5-0.5B-Instruct`).
      </Text>
      <Text color={theme.color.muted}>
        The trading agent uses a text-generation pipeline: encoder-only models (BERT,
        sentiment, etc.) cannot be loaded here — pick a decoder LLM with ONNX weights.
      </Text>
      <Text color={theme.color.muted}>
        Files go to the cache path above; remove bad pulls from the Installed tab.
      </Text>
      <Box marginTop={1}>
        <Text color={theme.color.primary}>id: </Text>
        <TextInput value={draftId} onChange={setDraftId} onSubmit={startPull} />
      </Box>
      <Box marginTop={1}>
        <Text color={theme.color.muted}>Enter to install · ONNX repos only.</Text>
      </Box>
    </Panel>
  );
}

function PullView({ state }: { state: PullState }): React.ReactElement {
  const files = useMemo(() => Array.from(state.fileToProgress.values()), [state]);
  const totalBytes = files.reduce((acc, f) => acc + (f.total || 0), 0);
  const loadedBytes = files.reduce((acc, f) => acc + (f.loaded || 0), 0);
  const overall = totalBytes > 0 ? loadedBytes / totalBytes : null;
  const unsupportedHint = state.error ? unsupportedModelTypeHint(state.error) : null;

  return (
    <Panel title={`Installing ${state.id}`}>
      <Box flexDirection="column">
        {state.error ? (
          <>
            <Text color={theme.color.danger}>Error: {state.error}</Text>
            {unsupportedHint ? (
              <Box marginTop={1}>
                <Text color={theme.color.muted}>{unsupportedHint}</Text>
              </Box>
            ) : null}
            <Box marginTop={1}>
              <Text color={theme.color.muted}>Press Esc to try a different id.</Text>
            </Box>
          </>
        ) : state.done ? (
          <Text color={theme.color.success}>
            Done. Press `a` to set as active model, or Esc to install another.
          </Text>
        ) : (
          <>
            <Box>
              <Text color={theme.color.muted}>Overall </Text>
              <Bar fraction={overall} width={32} />
              <Text color={theme.color.muted}>
                {"  "}
                {formatBytes(loadedBytes)}
                {totalBytes > 0 ? ` / ${formatBytes(totalBytes)}` : ""}
              </Text>
            </Box>
            <Box marginTop={1} flexDirection="column">
              {files.slice(-6).map((f) => (
                <Box key={f.file}>
                  <Text color={theme.color.muted}>{shortenFile(f.file)}</Text>
                  <Text color={theme.color.muted}>{"  "}</Text>
                  <Bar fraction={f.fraction} width={20} />
                </Box>
              ))}
            </Box>
          </>
        )}
      </Box>
    </Panel>
  );
}

function Bar({ fraction, width }: { fraction: number | null; width: number }): React.ReactElement {
  if (fraction === null) {
    return <Text color={theme.color.muted}>{"·".repeat(width)}</Text>;
  }
  const filled = Math.max(0, Math.min(width, Math.round(fraction * width)));
  const empty = width - filled;
  return (
    <Text>
      <Text color={theme.color.accent}>{"█".repeat(filled)}</Text>
      <Text color={theme.color.muted}>{"░".repeat(empty)}</Text>
    </Text>
  );
}

function shortenFile(file: string): string {
  const max = 32;
  if (file.length <= max) return file.padEnd(max);
  return ("…" + file.slice(file.length - (max - 1))).padEnd(max);
}

/** Extra context when Transformers.js rejects the checkpoint architecture. */
function unsupportedModelTypeHint(message: string): string | null {
  if (!/unsupported model type/i.test(message)) return null;
  return (
    "Install a causal language model (GPT / LLaMA / Qwen style) exported for ONNX, " +
    "not BERT or other task-specific encoders."
  );
}
