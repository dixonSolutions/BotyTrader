/**
 * Insights — Portfolio vs Bot tabs: trading dashboard, engine actions, signals, and live debug logs.
 */

import { useMouse } from "@zenobius/ink-mouse";
import { ScrollView } from "ink-scroll-view";
import type { ScrollViewRef } from "ink-scroll-view";
import React, { useEffect, useRef, useState } from "react";
import { Box, Text, useStdout, type DOMElement } from "ink";

import TextInput from "../../components/SafeTextInput.js";
import { Button } from "../../components/Button.js";
import { Footer, Header, ScreenFrame } from "../../components/Layout.js";
import { TabBarClickable, type TabItem } from "../../components/TabBarClickable.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import { DebuggingPanel } from "../debugging/DebuggingPanel.js";
import { AgentActivity } from "./AgentActivity.js";
import { OptimizerActivity } from "./OptimizerActivity.js";
import { HoldingsCompactTable } from "./HoldingsCompactTable.js";
import { InsightsHeadTable } from "./InsightsHeadTable.js";
import { MarketContext } from "./MarketContext.js";
import { Performance } from "./Performance.js";
import { PortfolioSummary } from "./Positions.js";
import { RecentOrdersTable } from "./RecentOrdersTable.js";
import { RecentTradingSignals } from "./RecentTradingSignals.js";
import { SystemLogs } from "./SystemLogs.js";
import { TradingSignalsTable } from "./TradingSignalsTable.js";
import { VitalSigns } from "./VitalSigns.js";
import type { Orchestrator, OrchestratorState } from "../../../orchestrator.js";
import type { LogService } from "../../../services/logService.js";
import { cellInsideBounds, getTerminalCellBounds, type TerminalViewport } from "../../pointer/cellHit.js";

type InsightsTab = "portfolio" | "bot";

const INSIGHTS_TABS: readonly TabItem<InsightsTab>[] = [
  { id: "portfolio", label: "Portfolio" },
  { id: "bot", label: "Bot" },
];

interface Props {
  orchestrator: Orchestrator;
  state: OrchestratorState;
  logService: LogService;
  onBack: () => void;
}

const LOG_VIEWPORT = 14;
const SIGNALS_VIEWPORT = 16;
const AGENT_ACTIONS_VIEWPORT = 6;
const WHEEL_STEP = 3;

export function Insights({ orchestrator, state, logService, onBack }: Props): React.ReactElement {
  const { stdout } = useStdout();
  const mouse = useMouse();
  const scrollViewRef = useRef<ScrollViewRef>(null);
  const systemLogsWheelRef = useRef<DOMElement | null>(null);
  const debugLogsWheelRef = useRef<DOMElement | null>(null);
  const viewportRef = useRef<TerminalViewport>({ cols: 80, rows: 24 });
  viewportRef.current = { cols: stdout.columns ?? 80, rows: stdout.rows ?? 24 };
  const [insightsTab, setInsightsTab] = useState<InsightsTab>("portfolio");
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

  useEffect(() => {
    const onScroll = (pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === null) return;
      if (insightsTab === "bot") {
        const sysBox = getTerminalCellBounds(systemLogsWheelRef);
        if (sysBox && cellInsideBounds(sysBox, pos.x, pos.y, viewportRef.current)) return;
        const dbgBox = getTerminalCellBounds(debugLogsWheelRef);
        if (dbgBox && cellInsideBounds(dbgBox, pos.x, pos.y, viewportRef.current)) return;
      }
      const scrollView = scrollViewRef.current;
      if (!scrollView) return;

      if (dir === "scrollup") {
        scrollView.scrollBy(-WHEEL_STEP);
      } else if (dir === "scrolldown") {
        scrollView.scrollBy(WHEEL_STEP);
      }
    };
    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events, insightsTab]);

  const focusSymbol = state.watchlist[focusIdx] ?? null;

  function cycleSymbol(delta: number): void {
    if (state.watchlist.length === 0) return;
    setFocusIdx((i) => (i + delta + state.watchlist.length) % state.watchlist.length);
  }

  const rows = stdout.rows ?? 28;
  const holdingsViewport = Math.max(4, Math.min(14, Math.floor(rows * 0.22)));
  const debugLogLines = Math.max(6, Math.min(18, rows - 22));

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
  const tabLabel = insightsTab === "portfolio" ? "Portfolio" : "Bot";
  const minSnapshots = orchestrator.config.optimization.min_snapshots ?? 10;
  const optSummary = state.trading.optimization;
  const snapshotsWithOutcome = optSummary?.snapshotsWithOutcome ?? 0;
  const optimizerReady =
    orchestrator.config.optimization.enabled && snapshotsWithOutcome >= minSnapshots;
  const optimizerBlockReason = !orchestrator.config.optimization.enabled
    ? "Enable optimization in Config."
    : snapshotsWithOutcome < minSnapshots
      ? `Optimizer needs ≥${minSnapshots} snapshots with outcomes (have ${snapshotsWithOutcome}).`
      : null;

  const portfolioTab = (
    <>
      <InsightsHeadTable state={state} />

      <Box flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1} marginBottom={0}>
        <Text color={theme.color.muted}>Focus symbol </Text>
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

      <ScreenFrame title="Balances & exposure" subtitle="Cash, equity, invested notional, and open P&L.">
        <PortfolioSummary positions={state.positions} account={state.account} heading="" />
      </ScreenFrame>

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
        flexShrink={0}
      >
        <Box marginLeft={1} marginTop={0}>
          <Text bold color={theme.color.primary}>
            Recent orders
          </Text>
        </Box>
        <RecentOrdersTable orders={state.recentOrders} currency={cur} />
      </Box>

      <ScreenFrame title="Performance" subtitle="Risk-style stats from closed activity (not live quotes).">
        <Performance metrics={state.performance} />
      </ScreenFrame>

      <ScreenFrame title="Market context" subtitle="Price history for the focus symbol (watchlist).">
        <MarketContext broker={orchestrator.broker} symbol={focusSymbol} />
      </ScreenFrame>
    </>
  );

  const botTab = (
    <>
      <ScreenFrame
        title="Strategy signals"
        subtitle="Recent simple-strategy decisions per symbol (SQLite audit trail)."
      >
        <RecentTradingSignals signals={state.recentTradingSignals} viewportRows={AGENT_ACTIONS_VIEWPORT} />
        <Box marginTop={1}>
          <TradingSignalsTable
            signals={state.recentTradingSignals}
            dbOpenError={state.trading.dbOpenError}
            databasePath={state.trading.dbPath}
            viewportRows={SIGNALS_VIEWPORT}
          />
        </Box>
      </ScreenFrame>

      <Box marginTop={1}>
        <OptimizerActivity state={state} />
      </Box>

      <Box marginTop={1}>
        <AgentActivity state={state} />
      </Box>

      <ScreenFrame
        title="Actions"
        subtitle="Run the trading engine, walk-forward optimizer, optional LLM cycle, or pause schedules."
      >
        <Box flexDirection="row" flexWrap="wrap" marginBottom={1}>
          <Button
            label="Run trading bot"
            icon={icons.play}
            onClick={() => void orchestrator.runTradingNow()}
            disabled={state.tradingBusy || !orchestrator.config.trading.enabled}
            variant="primary"
            minWidth={20}
          />
          {state.tradingBusy ? (
            <Text color={theme.color.muted}>
              {" "}
              …
            </Text>
          ) : null}
          <Text> </Text>
          <Button
            label="Run optimizer"
            icon={icons.play}
            onClick={() => void orchestrator.runOptimizationNow()}
            disabled={!optimizerReady}
            variant="secondary"
            minWidth={16}
          />
          <Text> </Text>
          <Button
            label="LLM: ReAct"
            icon={icons.play}
            onClick={() => void orchestrator.runNow(state.watchlist[focusIdx])}
            disabled={state.watchlist.length === 0}
            variant="secondary"
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
        </Box>
        {optimizerBlockReason ? (
          <Text color={theme.color.muted} wrap="wrap">
            Optimizer: {optimizerBlockReason}
          </Text>
        ) : null}
        <Box marginTop={1}>
          <Text color={theme.color.muted} wrap="wrap">
            Trading bot = portfolio + watchlist SQLite strategy. Optimizer mutates weights when gates pass. ReAct uses tools +
            JSON (optional).
          </Text>
        </Box>
        <Text color={theme.color.muted}>
          Mode {state.tradingMode} · engine {state.trading.ready ? "ready" : "blocked"}
          {state.trading.readiness.issues[0] ? ` — ${state.trading.readiness.issues[0]}` : ""}
        </Text>
        {orchestrator.tradingEngine.getStatus().lastError ? (
          <Box marginTop={1}>
            <Text color={theme.color.warn}>Engine: {orchestrator.tradingEngine.getStatus().lastError}</Text>
          </Box>
        ) : null}
      </ScreenFrame>

      <Box flexDirection="row" flexWrap="wrap" alignItems="center" marginTop={1} marginBottom={0}>
        <Text color={theme.color.muted}>LLM / watchlist symbol </Text>
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

      <Box marginTop={1}>
        <SystemLogs
          logs={state.logs}
          scrollOffset={logScrollOffset}
          viewportLines={LOG_VIEWPORT}
          toolbar={logToolbar}
          wheelCaptureRef={systemLogsWheelRef}
          onWheelScrollOffsetChange={setLogScrollOffset}
        />
      </Box>

      <DebuggingPanel
        orchestrator={orchestrator}
        logService={logService}
        logViewportLines={debugLogLines}
        logWheelCaptureRef={debugLogsWheelRef}
      />
    </>
  );

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      <Box flexShrink={0}>
        <Header
          breadcrumb={["Insights", tabLabel, focusSymbol ?? "—"]}
          brokerName={state.brokerName}
          connected={state.connected}
          onBack={onBack}
        />
      </Box>

      <Box flexShrink={0} justifyContent="center" width="100%" paddingX={1} paddingTop={0} paddingBottom={0}>
        <Box flexDirection="column" alignItems="center">
          <TabBarClickable tabs={INSIGHTS_TABS} current={insightsTab} onSelect={setInsightsTab} />
        </Box>
      </Box>

      <Box flexGrow={1} minHeight={0} minWidth={0}>
        <ScrollView ref={scrollViewRef} flexGrow={1}>
          <Box flexDirection="column" paddingX={1} paddingBottom={1}>
            {insightsTab === "portfolio" ? portfolioTab : botTab}
          </Box>
        </ScrollView>
      </Box>

      <Box flexShrink={0}>
        <Footer
          hints={[
            insightsTab === "portfolio"
              ? "Portfolio: balances, holdings, orders, performance · switch to Bot for engine + debug"
              : "Bot: signals, optimizer, actions, orchestrator logs, channel debug · Config sets schedules",
            "Wheel: over a log pane scrolls that pane; elsewhere scrolls the page · Copy logs copies to clipboard",
          ]}
        />
      </Box>
    </Box>
  );
}
