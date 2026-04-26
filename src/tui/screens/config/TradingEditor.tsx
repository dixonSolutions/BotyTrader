/**
 * Trading engine settings — simple strategy, FinBERT, DB path, paper/live.
 */

import React, { useEffect, useRef, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "../../components/SafeTextInput.js";

import { Button } from "../../components/Button.js";
import { ClickableRow } from "../../components/ClickableRow.js";
import { Panel } from "../../components/Layout.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import type { Orchestrator } from "../../../orchestrator.js";
import type { SentimentProvider, TradingMode } from "../../../config.js";

interface Props {
  orchestrator: Orchestrator;
  active: boolean;
  focusRowId?: string | null;
  onFocusRowConsumed?: () => void;
}

type RowId =
  | "trading_enabled"
  | "trading_mode"
  | "db_path"
  | "simple_enabled"
  | "tech_w"
  | "sent_w"
  | "buy_th"
  | "sell_th"
  | "sma_fast"
  | "sma_slow"
  | "rsi"
  | "sma_neutral"
  | "sent_provider"
  | "sent_ttl";

export function TradingEditor({
  orchestrator,
  active,
  focusRowId,
  onFocusRowConsumed,
}: Props): React.ReactElement {
  const { config } = orchestrator;
  const [editing, setEditing] = useState(false);
  const [editingRow, setEditingRow] = useState<RowId | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState(0);
  const consumeRef = useRef(onFocusRowConsumed);
  consumeRef.current = onFocusRowConsumed;
  void active;

  const rows: { id: RowId; label: string; value: string; desc?: string }[] = [
    { id: "trading_enabled", label: "Trading engine", value: config.trading.enabled ? "ON" : "OFF" },
    { id: "trading_mode", label: "Paper / live (Alpaca)", value: config.trading.mode },
    { id: "db_path", label: "SQLite database path", value: config.trading.database_path },
    { id: "simple_enabled", label: "Simple strategy", value: config.strategy.simple.enabled ? "ON" : "OFF" },
    { id: "tech_w", label: "Technical weight (0-1)", value: String(config.strategy.simple.technical_weight) },
    { id: "sent_w", label: "Sentiment weight (0-1)", value: String(config.strategy.simple.sentiment_weight) },
    { id: "buy_th", label: "Buy threshold", value: String(config.strategy.simple.buy_threshold) },
    { id: "sell_th", label: "Sell threshold", value: String(config.strategy.simple.sell_threshold) },
    { id: "sma_fast", label: "SMA fast period", value: String(config.strategy.simple.sma_fast_period) },
    { id: "sma_slow", label: "SMA slow period", value: String(config.strategy.simple.sma_slow_period) },
    { id: "rsi", label: "RSI period", value: String(config.strategy.simple.rsi_period) },
    { id: "sma_neutral", label: "SMA neutral band", value: String(config.strategy.simple.sma_neutral_band) },
    { id: "sent_provider", label: "Sentiment provider", value: config.sentiment.provider },
    { id: "sent_ttl", label: "Sentiment cache (hours)", value: String(config.sentiment.cache_ttl_hours) },
  ];

  useEffect(() => {
    if (focusRowId == null) return;
    const j = rows.findIndex((r) => r.id === focusRowId);
    if (j >= 0) setSelected(j);
    consumeRef.current?.();
  }, [focusRowId, rows]);

  function startEdit(i: number): void {
    const r = rows[i];
    if (!r) return;
    setSelected(i);
    if (r.id === "trading_enabled" || r.id === "simple_enabled") {
      if (r.id === "trading_enabled") {
        setBusy(true);
        try {
          orchestrator.setTradingEnabled(!config.trading.enabled);
        } finally {
          setBusy(false);
        }
      } else {
        orchestrator.setSimpleStrategyEnabled(!config.strategy.simple.enabled);
      }
      return;
    }
    if (r.id === "trading_mode") {
      const next: TradingMode = config.trading.mode === "paper" ? "live" : "paper";
      setBusy(true);
      try {
        orchestrator.setTradingMode(next);
      } finally {
        setBusy(false);
      }
      return;
    }
    if (r.id === "sent_provider") {
      const order: SentimentProvider[] = ["local_finbert", "disabled", "huggingface_api"];
      const i2 = (order.indexOf(config.sentiment.provider) + 1) % order.length;
      setBusy(true);
      try {
        orchestrator.setSentimentConfig({ provider: order[i2]! });
      } finally {
        setBusy(false);
      }
      return;
    }
    setEditing(true);
    setEditingRow(r.id);
    setDraft(r.value);
  }

  function commit(): void {
    if (!editingRow) {
      setEditing(false);
      return;
    }
    const raw = draft.trim();
    setEditing(false);
    setEditingRow(null);
    setDraft("");
    const n = Number(raw);
    setBusy(true);
    try {
      switch (editingRow) {
        case "db_path":
          if (raw) orchestrator.setTradingDatabasePath(raw);
          break;
        case "tech_w":
          if (raw && Number.isFinite(n)) orchestrator.setSimpleStrategyNumeric("technical_weight", n);
          break;
        case "sent_w":
          if (raw && Number.isFinite(n)) orchestrator.setSimpleStrategyNumeric("sentiment_weight", n);
          break;
        case "buy_th":
          if (raw && Number.isFinite(n)) orchestrator.setSimpleStrategyNumeric("buy_threshold", n);
          break;
        case "sell_th":
          if (raw && Number.isFinite(n)) orchestrator.setSimpleStrategyNumeric("sell_threshold", n);
          break;
        case "sma_neutral":
          if (raw && Number.isFinite(n)) orchestrator.setSimpleStrategyNumeric("sma_neutral_band", n);
          break;
        case "sma_fast":
          if (raw && Number.isFinite(n)) orchestrator.setSimpleStrategyInt("sma_fast_period", n);
          break;
        case "sma_slow":
          if (raw && Number.isFinite(n)) orchestrator.setSimpleStrategyInt("sma_slow_period", n);
          break;
        case "rsi":
          if (raw && Number.isFinite(n)) orchestrator.setSimpleStrategyInt("rsi_period", n);
          break;
        case "sent_ttl":
          if (raw && Number.isFinite(n) && n > 0) {
            orchestrator.setSentimentConfig({ provider: config.sentiment.provider, cacheTtlHours: n });
          }
          break;
        default:
          break;
      }
    } finally {
      setBusy(false);
    }
  }

  const st = orchestrator.getState().trading;
  return (
    <Box flexDirection="column">
      <Box borderStyle="round" borderColor={st.ready ? theme.color.success : theme.color.warn} paddingX={1} marginBottom={1} flexDirection="column">
        <Text bold>Engine status</Text>
        <Text color={st.ready ? theme.color.success : theme.color.danger}>
          {st.ready ? "Ready" : "Not ready — fix issues in Config or .env"}
        </Text>
        {st.readiness.issues.length > 0 ? (
          <Text color={theme.color.danger}>Issues: {st.readiness.issues.join(" · ")}</Text>
        ) : null}
        {st.readiness.warnings.length > 0 ? (
          <Text color={theme.color.muted}>Warnings: {st.readiness.warnings.join(" · ")}</Text>
        ) : null}
        <Text color={theme.color.muted}>DB: {st.dbPath}</Text>
        <Text color={theme.color.muted}>
          FinBERT: {orchestrator.config.sentiment.provider === "local_finbert" ? (st.sentimentModelOk ? "ok" : st.sentimentError ?? "error") : orchestrator.config.sentiment.provider}
          {" — "}
          repo <Text bold>{orchestrator.config.sentiment.model_id}</Text> (Config → Models)
        </Text>
      </Box>
      <Panel>
        {rows.map((r, i) => (
          <ClickableRow
            key={r.id}
            selected={i === selected}
            onClick={() => {
              if (busy) return;
              if (editing) return;
              setSelected(i);
              startEdit(i);
            }}
          >
            <Text>
              <Text color={i === selected ? theme.color.accent : theme.color.text}>{r.label.padEnd(28)}</Text>
              <Text color={theme.color.muted}> {r.value}</Text>
            </Text>
          </ClickableRow>
        ))}
        {editing ? (
          <Box marginTop={1} flexDirection="row" flexWrap="wrap">
            <Text color={theme.color.primary}>Value: </Text>
            <TextInput value={draft} onChange={setDraft} onSubmit={commit} />
            <Box marginLeft={1}>
              <Button label="Save" icon={icons.check} onClick={commit} minWidth={8} />
            </Box>
          </Box>
        ) : null}
        <Box marginTop={1} flexDirection="row" flexWrap="wrap">
          <Button
            label="Warm FinBERT / refresh sentiment"
            icon={icons.bullet}
            onClick={() => {
              setBusy(true);
              void orchestrator.warmSentimentModel().finally(() => setBusy(false));
            }}
            disabled={busy}
            variant="secondary"
          />
        </Box>
      </Panel>
    </Box>
  );
}
