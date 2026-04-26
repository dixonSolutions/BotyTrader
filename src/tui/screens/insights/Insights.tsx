/**
 * Insights — head portfolio table, virtualized holdings, DB signal audit, then details.
 */

import React, { useEffect, useState } from "react";
import { Box, Text, useStdout } from "ink";

import TextInput from "../../components/SafeTextInput.js";
import { Button } from "../../components/Button.js";
import { Footer, Header, ScreenFrame } from "../../components/Layout.js";
import { ScrollRegion } from "../../components/ScrollRegion.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import { AgentActivity } from "./AgentActivity.js";
import { HoldingsCompactTable } from "./HoldingsCompactTable.js";
import { InsightsHeadTable } from "./InsightsHeadTable.js";
import { MarketContext } from "./MarketContext.js";
import { Performance } from "./Performance.js";
import { SystemLogs } from "./SystemLogs.js";
import { TradingSignalsTable } from "./TradingSignalsTable.js";
import { VitalSigns } from "./VitalSigns.js";
import type { Orchestrator, OrchestratorState } from "../../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
  state: OrchestratorState;
  onBack: () => void;
}

const LOG_VIEWPORT = 14;
/** Min height (lines) for the signals ink-table scroll pane — table chrome needs more than one row. */
const SIGNALS_VIEWPORT = 16;

export function Insights({ orchestrator, state, onBack }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const [focusIdx, setFocusIdx] = useState(0);
  const [logScrollOffset, setLogScrollOffset] = useState(0);
  const [posFilter, setPosFilter] = useState("");

  useEffect(() => {
    if (focusIdx >= state.watchlist.length) {
      setFocusIdx(0);
    }
  }, [state.watchlist.length, focusIdx]);

  const maxLogOffset = Math.max(0, state.logs.length - LOG_VIEWPORT);

  useEffect(() => {
    setLogScrollOffset((o) => Math.min(o, maxLogOffset));
  }, [maxLogOffset, state.logs.length]);

  const focusSymbol = state.watchlist[focusIdx] ?? null;

  function cycleSymbol(delta: number): void {
    if (state.watchlist.length === 0) return;
    setFocusIdx((i) => (i + delta + state.watchlist.length) % state.watchlist.length);
  }

  const rows = stdout.rows ?? 28;
  const holdingsViewport = Math.max(4, Math.min(14, Math.floor(rows * 0.22)));

  const logToolbar = (
    <>
      <Button
        label="Older"
        icon={icons.chevronUp}
        onClick={() => setLogScrollOffset((o) => Math.min(o + 1, maxLogOffset))}
        disabled={state.logs.length === 0}
        variant="secondary"
        minWidth={10}
      />
      <Text> </Text>
      <Button
        label="Newer"
        icon={icons.chevronDown}
        onClick={() => setLogScrollOffset((o) => Math.max(0, o - 1))}
        disabled={state.logs.length === 0}
        variant="secondary"
        minWidth={10}
      />
      <Text> </Text>
      <Button
        label="Pg−"
        onClick={() => setLogScrollOffset((o) => Math.min(o + LOG_VIEWPORT, maxLogOffset))}
        disabled={state.logs.length === 0}
        variant="ghost"
        minWidth={6}
      />
      <Text> </Text>
      <Button
        label="Pg+"
        onClick={() => setLogScrollOffset((o) => Math.max(0, o - LOG_VIEWPORT))}
        disabled={state.logs.length === 0}
        variant="ghost"
        minWidth={6}
      />
      <Text> </Text>
      <Button
        label="Newest"
        onClick={() => setLogScrollOffset(0)}
        disabled={state.logs.length === 0}
        variant="ghost"
        minWidth={10}
      />
    </>
  );

  const cur = state.account?.currency ?? "USD";

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      <Box flexShrink={0}>
        <Header
          breadcrumb={["Insights", focusSymbol ?? "(no symbol)"]}
          brokerName={state.brokerName}
          connected={state.connected}
          onBack={onBack}
        />
      </Box>

      <Box flexShrink={0} flexDirection="column" paddingX={1}>
        <InsightsHeadTable state={state} />

        {!orchestrator.models.activeId ? (
          <Text color={theme.color.danger}>
            No reasoning LLM — <Text bold>Config</Text> → <Text bold>Settings</Text> → Active local model.
          </Text>
        ) : null}

        <Box flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1} marginBottom={0}>
          <Text color={theme.color.muted}>Watchlist </Text>
          <Button
            label="◀"
            icon={icons.chevronUp}
            onClick={() => cycleSymbol(-1)}
            disabled={state.watchlist.length === 0}
            variant="ghost"
            minWidth={4}
          />
          <Text> </Text>
          <Button
            label="▶"
            icon={icons.chevronDown}
            onClick={() => cycleSymbol(1)}
            disabled={state.watchlist.length === 0}
            variant="ghost"
            minWidth={4}
          />
          <Text> </Text>
          <Text bold color={theme.color.text}>
            {focusSymbol ?? "—"}
          </Text>
        </Box>

        <VitalSigns state={state} />

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.color.muted}
          marginTop={1}
          flexShrink={0}
        >
          <Box marginLeft={1} marginTop={0}>
            <Text bold color={theme.color.primary}>
              Holdings
            </Text>
          </Box>
          <Box flexDirection="column" paddingX={1} flexShrink={0}>
            <Text color={theme.color.muted}>Filter</Text>
            <Box borderStyle="round" borderColor={theme.color.subtle} paddingX={1}>
              <TextInput value={posFilter} onChange={setPosFilter} placeholder="Symbol contains…" />
            </Box>
          </Box>
          <HoldingsCompactTable
            positions={state.positions}
            symbolsFilter={posFilter}
            viewportRows={holdingsViewport}
            currency={cur}
          />
        </Box>

        <Box
          flexDirection="column"
          borderStyle="round"
          borderColor={theme.color.muted}
          marginTop={1}
          marginBottom={1}
          flexShrink={0}
        >
          <Box marginLeft={1} marginTop={0}>
            <Text bold color={theme.color.primary}>
              Recent strategy signals (database)
            </Text>
          </Box>
          <TradingSignalsTable
            signals={state.recentTradingSignals}
            dbOpenError={state.trading.dbOpenError}
            viewportRows={SIGNALS_VIEWPORT}
          />
        </Box>
      </Box>

      <Box flexGrow={1} minHeight={0} minWidth={0}>
        <ScrollRegion>
          <ScreenFrame
            title="Details"
            subtitle="Agent, performance, market context for the focused symbol, and logs."
          >
            <Box flexDirection="row" flexWrap="wrap" marginBottom={1}>
              <Button
                label="Run agent"
                icon={icons.play}
                onClick={() => void orchestrator.runNow(state.watchlist[focusIdx])}
                disabled={state.watchlist.length === 0}
                variant="primary"
                minWidth={14}
              />
              <Text> </Text>
              <Button
                label={state.status === "paused" ? "Resume" : "Pause"}
                icon={icons.pause}
                onClick={() => orchestrator.togglePause()}
                variant="secondary"
                minWidth={10}
              />
              <Text> </Text>
              <Button label="Ping" icon={icons.bullet} onClick={() => void orchestrator.pingNow()} variant="ghost" minWidth={8} />
              <Text> </Text>
              <Button
                label="Trade now"
                icon={icons.play}
                onClick={() => void orchestrator.runTradingNow()}
                disabled={state.tradingBusy || !orchestrator.config.trading.enabled}
                variant="secondary"
                minWidth={12}
              />
              {state.tradingBusy ? (
                <Text color={theme.color.muted}>
                  {" "}
                  …
                </Text>
              ) : null}
            </Box>

            <Text color={theme.color.muted}>
              Simple strategy · {state.tradingMode} · engine {state.trading.ready ? "ready" : "blocked"}
              {state.trading.readiness.issues[0] ? ` — ${state.trading.readiness.issues[0]}` : ""}
            </Text>

            <Box marginTop={1} flexDirection="column">
              <Performance metrics={state.performance} />
              <Box marginTop={1}>
                <MarketContext broker={orchestrator.broker} symbol={focusSymbol} />
              </Box>
            </Box>

            <Box marginTop={1}>
              <AgentActivity state={state} />
            </Box>

            <Box marginTop={1}>
              <SystemLogs
                logs={state.logs}
                scrollOffset={logScrollOffset}
                viewportLines={LOG_VIEWPORT}
                toolbar={logToolbar}
              />
            </Box>
          </ScreenFrame>
        </ScrollRegion>
      </Box>

      <Box flexShrink={0}>
        <Footer
          hints={[
            "Holdings: wheel over the table to scroll rows · Details pane: wheel scrolls full page",
            "Home has Alpaca Search · Back returns Home",
          ]}
        />
      </Box>
    </Box>
  );
}
