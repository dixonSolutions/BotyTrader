/**
 * Config → Models: sentiment is FinBERT-only (ProsusAI/finbert).
 * Reasoning LLM (causal LM) is edited under Settings → Active local model.
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";

import { Button } from "../../components/Button.js";
import { SentimentDownloadPanel } from "../../components/SentimentDownloadPanel.js";
import { Panel } from "../../components/Layout.js";
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

  function bumpAgentBlend(delta: number): void {
    const next = Math.max(0, Math.min(1, Math.round((sentimentW + delta) * 100) / 100));
    orchestrator.setSentimentWeight(next);
  }

  function cycleProvider(): void {
    const order: SentimentProvider[] = ["local_finbert", "disabled", "huggingface_api"];
    const i2 = (order.indexOf(config.sentiment.provider) + 1) % order.length;
    setBusy(true);
    try {
      orchestrator.setSentimentConfig({ provider: order[i2]! });
    } finally {
      setBusy(false);
    }
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

  const idOk = config.sentiment.model_id.trim() === SUPPORTED_SENTIMENT_REPO_ID;
  const needsLocalInstall =
    config.sentiment.provider === "local_finbert" && !st.sentimentModelOk;

  return (
    <Box flexDirection="column">
      <Panel title="FinBERT (sentiment)">
        <Text color={theme.color.muted}>
          BotyTrader supports only this financial sentiment model for now (three-class positive / neutral /
          negative):
        </Text>
        <Box marginTop={1}>
          <Text color={theme.color.accent}>{OFFICIAL_FINBERT_MODEL_URL}</Text>
        </Box>
        <Box marginTop={1}>
          <Text color={theme.color.muted}>
            Local install / warm uses <Text bold color={theme.color.primary}>{LOCAL_TRANSFORMERS_FINBERT_REPO}</Text>{" "}
            (Transformers.js ONNX + tokenizer.json). <Text bold>{SUPPORTED_SENTIMENT_REPO_ID}</Text> is the PyTorch
            card; it does not ship the files Node needs, which caused the tokenizer.json error.
          </Text>
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>Configured repo id</Text>
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
        {config.sentiment.provider === "local_finbert" ? (
          <SentimentDownloadPanel
            orchestrator={orchestrator}
            needsLocalInstall={needsLocalInstall}
            cacheDir={config.model.cache_dir}
            parentBusy={busy}
            onBusyChange={setBusy}
          />
        ) : null}
      </Panel>

      <Box marginTop={1}>
      <Panel title="Runtime">
        <Box flexDirection="row" flexWrap="wrap" marginBottom={1}>
          <Text color={theme.color.muted}>Sentiment provider: </Text>
          <Text bold>{config.sentiment.provider}</Text>
        </Box>
        <Box flexDirection="row" flexWrap="wrap">
          <Button
            label="Cycle provider"
            icon={icons.bullet}
            onClick={cycleProvider}
            disabled={busy}
            variant="secondary"
            minWidth={16}
          />
          <Text> </Text>
          <Button
            label="Warm / reload"
            icon={icons.play}
            onClick={() => {
              setBusy(true);
              void orchestrator.warmSentimentModel().finally(() => setBusy(false));
            }}
            disabled={busy || config.sentiment.provider === "disabled"}
            variant="secondary"
            minWidth={16}
          />
          <Text> </Text>
          <Button
            label="Remove local ONNX"
            icon={icons.close}
            onClick={() => {
              setBusy(true);
              void orchestrator.removeSentimentFinbertLocal().finally(() => setBusy(false));
            }}
            disabled={busy || config.sentiment.provider !== "local_finbert"}
            variant="danger"
            minWidth={20}
          />
        </Box>
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.muted}>Engine sentiment</Text>
          <Text color={st.sentimentModelOk ? theme.color.success : theme.color.danger}>
            {config.sentiment.provider === "disabled"
              ? "disabled"
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
          technical, 1 = sentiment). Simple-strategy weights stay under Trading.
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
          Reasoning LLM (causal model for the agent): edit <Text bold>Active local model</Text> under the
          Settings tab, or set <Text bold>[model] id</Text> in config.toml. Cache directory is{" "}
          <Text bold>{config.model.cache_dir}</Text>.
        </Text>
      </Box>
    </Box>
  );
}
