/**
 * Config → Models: FinBERT (sentiment) — download, local vs HF Inference API,
 * hybrid scheduling, and HF_TOKEN guidance.
 * Reasoning LLM (causal LM) is edited under Settings → Active local model.
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useStdout } from "ink";

import { Button } from "../../components/Button.js";
import { SentimentDownloadPanel } from "../../components/SentimentDownloadPanel.js";
import { Panel } from "../../components/Layout.js";
import { Select } from "../../components/Select.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import type { Orchestrator, OrchestratorState } from "../../../orchestrator.js";
import type { SentimentProvider } from "../../../config.js";
import {
  LOCAL_TRANSFORMERS_FINBERT_REPO,
  SUPPORTED_SENTIMENT_REPO_ID,
} from "../../../trading/sentiment/finbert.js";

export const OFFICIAL_FINBERT_MODEL_ID = SUPPORTED_SENTIMENT_REPO_ID;

export const OFFICIAL_FINBERT_MODEL_URL = "https://huggingface.co/ProsusAI/finbert";

const SENTIMENT_PROVIDER_OPTIONS: readonly SentimentProvider[] = [
  "local_finbert",
  "hybrid_finbert",
  "huggingface_api",
  "disabled",
];

const SENTIMENT_PROVIDER_LABELS: Partial<Record<SentimentProvider, string>> = {
  local_finbert: "Local ONNX (CPU/GPU via Transformers.js)",
  hybrid_finbert: "Hybrid — HF API + local (ratio below)",
  huggingface_api: "HF Inference API only",
  disabled: "Off (neutral sentiment)",
};

interface Props {
  orchestrator: Orchestrator;
  /** Live trading / sentiment readiness from the app subscription. */
  trading: OrchestratorState["trading"];
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
}

export function FinbertModelsEditor({
  orchestrator,
  trading,
  active,
  focusRowId,
  onFocusRowConsumed,
}: Props): React.ReactElement {
  const { stdout } = useStdout();
  const { config } = orchestrator;
  const [busy, setBusy] = useState(false);
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;
  void active;

  useEffect(() => {
    if (focusRowId == null) return;
    consumeRef.current?.();
  }, [focusRowId]);

  const sentimentW = config.agent.sentiment_weight;
  const st = trading;
  const num = config.sentiment.hf_api_runs_numerator;
  const den = config.sentiment.hf_api_runs_denominator;
  const hasHfToken = Boolean(orchestrator.secrets.HF_TOKEN?.trim());

  function bumpAgentBlend(delta: number): void {
    const next = Math.max(0, Math.min(1, Math.round((sentimentW + delta) * 100) / 100));
    orchestrator.setSentimentWeight(next);
  }

  function applyOfficialId(): void {
    setBusy(true);
    try {
      orchestrator.setSentimentConfig({
        provider: config.sentiment.provider,
        modelId: SUPPORTED_SENTIMENT_REPO_ID,
      });
    } finally {
      setBusy(false);
    }
  }

  function setHybridRatio(n: number, d: number): void {
    setBusy(true);
    try {
      orchestrator.setSentimentConfig({
        provider: "hybrid_finbert",
        hfApiRunsNumerator: n,
        hfApiRunsDenominator: d,
      });
    } finally {
      setBusy(false);
    }
  }

  const idOk = config.sentiment.model_id.trim() === SUPPORTED_SENTIMENT_REPO_ID;
  const needsLocalWeights =
    (config.sentiment.provider === "local_finbert" || config.sentiment.provider === "hybrid_finbert") &&
    !st.sentimentModelOk;

  return (
    <Box flexDirection="column">
      <Panel title="FinBERT (sentiment)">
        <Text color={theme.color.muted}>
          Financial sentiment (positive / neutral / negative). Hub card:{" "}
          <Text color={theme.color.accent}>{OFFICIAL_FINBERT_MODEL_URL}</Text>
        </Text>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>
            Local Node path uses <Text bold color={theme.color.primary}>{LOCAL_TRANSFORMERS_FINBERT_REPO}</Text>{" "}
            (Transformers.js ONNX). Use <Text bold>Download / verify</Text> below if weights are missing.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>Configured repo id (HF Inference + metadata)</Text>
          <Text bold color={idOk ? theme.color.success : theme.color.warn}>
            {config.sentiment.model_id.trim() || "(empty)"}
            {!idOk ? ` — expected ${SUPPORTED_SENTIMENT_REPO_ID}` : ""}
          </Text>
        </Box>
        {!idOk ? (
          <Box marginTop={1}>
            <Button
              label={`Use ${SUPPORTED_SENTIMENT_REPO_ID}`}
              icon={icons.check}
              onClick={applyOfficialId}
              disabled={busy}
              variant="primary"
              minWidth={22}
            />
          </Box>
        ) : null}
        {config.sentiment.provider === "local_finbert" || config.sentiment.provider === "hybrid_finbert" ? (
          <SentimentDownloadPanel
            orchestrator={orchestrator}
            needsLocalInstall={needsLocalWeights}
            cacheDir={config.model.cache_dir}
            parentBusy={busy}
            onBusyChange={setBusy}
          />
        ) : null}
      </Panel>

      <Box marginTop={1}>
        <Panel title="FinBERT routing (API vs local)">
          <Text color={theme.color.muted}>
            <Text bold>HF_TOKEN</Text> — create a read token at{" "}
            <Text color={theme.color.accent}>https://huggingface.co/settings/tokens</Text>, then add one line to your{" "}
            <Text bold>.env</Text> next to <Text bold>config.toml</Text>:{" "}
            <Text bold color={theme.color.primary}>HF_TOKEN=hf_...</Text> or set it under <Text bold>Config → Secrets</Text>.
            Restart the app if the token was added while it was running.
          </Text>
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.color.muted}>Token visible to this session</Text>
            <Text color={hasHfToken ? theme.color.success : theme.color.warn}>
              {hasHfToken ? "HF_TOKEN is set" : "HF_TOKEN not loaded — API / hybrid API slots cannot call Hugging Face"}
            </Text>
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.color.muted}>Sentiment provider</Text>
            <Select
              label="Mode"
              options={SENTIMENT_PROVIDER_OPTIONS}
              optionLabels={SENTIMENT_PROVIDER_LABELS}
              value={config.sentiment.provider}
              width={Math.min(72, Math.max(42, (stdout.columns ?? 80) - 6))}
              disabled={busy}
              onChange={(next) => {
                setBusy(true);
                try {
                  orchestrator.setSentimentConfig({ provider: next });
                } finally {
                  setBusy(false);
                }
              }}
            />
          </Box>
          {config.sentiment.provider === "hybrid_finbert" ? (
            <Box marginTop={1} flexDirection="column">
              <Text color={theme.color.muted}>
                API usage ratio — over each block of <Text bold>{den}</Text> symbol sentiment batches, use HF Inference
                for the first <Text bold>{num}</Text> (then local for the rest). On HTTP 429 / rate limit, the app uses
                local FinBERT for <Text bold>~90s</Text> then retries API.
              </Text>
              <Box marginTop={1} flexDirection="row" flexWrap="wrap">
                <Button label="1 / 2 API" onClick={() => setHybridRatio(1, 2)} disabled={busy} variant="secondary" minWidth={12} />
                <Text> </Text>
                <Button label="1 / 3 API" onClick={() => setHybridRatio(1, 3)} disabled={busy} variant="secondary" minWidth={12} />
                <Text> </Text>
                <Button label="2 / 3 API" onClick={() => setHybridRatio(2, 3)} disabled={busy} variant="secondary" minWidth={12} />
                <Text> </Text>
                <Button label="Always API" onClick={() => setHybridRatio(1, 1)} disabled={busy} variant="secondary" minWidth={14} />
                <Text> </Text>
                <Button label="Always local" onClick={() => setHybridRatio(0, 1)} disabled={busy} variant="secondary" minWidth={14} />
              </Box>
              <Text marginTop={1} color={theme.color.muted}>
                Current: <Text bold>{num}</Text> / <Text bold>{den}</Text>
              </Text>
            </Box>
          ) : null}
        </Panel>
      </Box>

      <Box marginTop={1}>
        <Panel title="Runtime">
          <Box flexDirection="row" flexWrap="wrap" marginBottom={1}>
            <Text color={theme.color.muted}>Active mode: </Text>
            <Text bold>{config.sentiment.provider}</Text>
          </Box>
          <Box flexDirection="row" flexWrap="wrap">
            <Button
              label="Warm / reload local"
              icon={icons.play}
              onClick={() => {
                setBusy(true);
                void orchestrator.warmSentimentModel().finally(() => setBusy(false));
              }}
              disabled={busy || config.sentiment.provider === "disabled" || config.sentiment.provider === "huggingface_api"}
              variant="secondary"
              minWidth={22}
            />
            <Text> </Text>
            <Button
              label="Remove local ONNX"
              icon={icons.close}
              onClick={() => {
                setBusy(true);
                void orchestrator.removeSentimentFinbertLocal().finally(() => setBusy(false));
              }}
              disabled={
                busy ||
                (config.sentiment.provider !== "local_finbert" && config.sentiment.provider !== "hybrid_finbert")
              }
              variant="danger"
              minWidth={20}
            />
          </Box>
          <Box marginTop={1} flexDirection="column">
            <Text color={theme.color.muted}>Local classifier (ONNX)</Text>
            <Text color={st.sentimentModelOk ? theme.color.success : theme.color.danger}>
              {config.sentiment.provider === "disabled"
                ? "disabled"
                : config.sentiment.provider === "huggingface_api"
                  ? "not used (API only)"
                  : st.sentimentModelOk
                    ? "ok"
                    : st.sentimentError ?? "not ready"}
            </Text>
          </Box>
        </Panel>
      </Box>

      <Box marginTop={1}>
        <Panel title="Agent prompt blend (ReAct)">
          <Text color={theme.color.muted}>
            How much the reasoning agent favours qualitative sentiment vs technicals in its cycle prompt (0 =
            technical, 1 = sentiment). Simple-strategy weights stay under Config → Trading.
          </Text>
          <Box marginTop={1} flexDirection="row" flexWrap="wrap">
            <Button label="−" icon={icons.minus} onClick={() => bumpAgentBlend(-0.05)} disabled={busy} variant="ghost" />
            <Text> </Text>
            <Text bold>
              {Math.round(sentimentW * 100)}% sentiment · {Math.round((1 - sentimentW) * 100)}% technical
            </Text>
            <Text> </Text>
            <Button label="+" icon={icons.plus} onClick={() => bumpAgentBlend(0.05)} disabled={busy} variant="ghost" />
          </Box>
        </Panel>
      </Box>

      <Box marginTop={1} borderStyle="round" borderColor={theme.color.muted} paddingX={1}>
        <Text color={theme.color.muted}>
          Reasoning LLM (causal model for the agent): edit <Text bold>Active local model</Text> under the Settings tab,
          or set <Text bold>[model] id</Text> in config.toml. Cache directory is <Text bold>{config.model.cache_dir}</Text>.
        </Text>
      </Box>
    </Box>
  );
}
