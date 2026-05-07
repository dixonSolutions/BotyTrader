/**
 * Config container — sub-tabbed editor for everything writable.
 * Tabs: Settings · Trading · Models · Indicators · Optimize · Secrets · Schedule · DB. Global search is pointer-driven.
 */

import React, { useMemo, useState } from "react";
import { Box, Text } from "ink";
import TextInput from "../../components/SafeTextInput.js";

import { Button } from "../../components/Button.js";
import { Footer, Header, ScreenFrame } from "../../components/Layout.js";
import { ScrollRegion } from "../../components/ScrollRegion.js";
import { TabBarClickable, type TabItem } from "../../components/TabBarClickable.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import { SecretsEditor } from "./SecretsEditor.js";
import { SettingsEditor } from "./SettingsEditor.js";
import { ScheduleEditor } from "./ScheduleEditor.js";
import { TradingEditor } from "./TradingEditor.js";
import { FinbertModelsEditor } from "./FinbertModelsEditor.js";
import { IndicatorsEditor } from "./IndicatorsEditor.js";
import { OptimizationEditor } from "./OptimizationEditor.js";
import { DbEditor } from "./DbEditor.js";
import type { Orchestrator, OrchestratorState } from "../../../orchestrator.js";
import { buildConfigSearchHits, hitHaystack, matchesConfigFilter, type ConfigTabId } from "./configSearchIndex.js";

type ConfigTab = ConfigTabId;

const TABS: readonly TabItem<ConfigTab>[] = [
  { id: "settings", label: "Settings", icon: icons.bullet },
  { id: "trading", label: "Trading", icon: icons.bullet },
  { id: "models", label: "Models", icon: icons.bullet },
  { id: "indicators", label: "Indicators", icon: icons.bullet },
  { id: "optimize", label: "Optimize", icon: icons.bullet },
  { id: "secrets", label: "Secrets", icon: icons.bullet },
  { id: "schedule", label: "Schedule", icon: icons.bullet },
  { id: "db", label: "DB", icon: icons.bullet },
];

interface Props {
  orchestrator: Orchestrator;
  state: OrchestratorState;
  onBack: () => void;
}

export function Config({ orchestrator, state, onBack }: Props): React.ReactElement {
  const [tab, setTab] = useState<ConfigTab>("settings");
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState("");
  const [focusRowId, setFocusRowId] = useState<string | null>(null);

  const allHits = useMemo(() => buildConfigSearchHits(orchestrator), [orchestrator]);
  const filteredHits = useMemo(
    () => allHits.filter((h) => matchesConfigFilter(globalQuery, hitHaystack(h))),
    [allHits, globalQuery],
  );

  const editorActive = (t: ConfigTab) => tab === t && !globalSearchOpen;

  function openSearch(): void {
    setGlobalSearchOpen(true);
    setGlobalQuery("");
  }

  function closeSearch(): void {
    setGlobalSearchOpen(false);
    setGlobalQuery("");
  }

  function jumpToHit(h: (typeof allHits)[number]): void {
    setTab(h.tab);
    setFocusRowId(h.rowId);
    closeSearch();
  }

  return (
    <Box flexDirection="column" flexGrow={1} minHeight={0}>
      <Box flexShrink={0}>
        <Header
          breadcrumb={["Config", labelFor(tab)]}
          brokerName={state.brokerName}
          connected={state.connected}
          onBack={onBack}
        />
      </Box>
      <ScrollRegion>
        <ScreenFrame
          title="Config"
          subtitle="Settings, trading, models (FinBERT), indicators, optimizer, secrets, schedules, and DB (SQLite) — config.toml / .env."
        >
        <Box marginBottom={1} flexDirection="row" flexWrap="wrap">
          <Button
            label={globalSearchOpen ? "Close search" : "Search all tabs"}
            icon={globalSearchOpen ? icons.close : icons.search}
            onClick={globalSearchOpen ? closeSearch : openSearch}
            variant="secondary"
            minWidth={16}
          />
        </Box>
        <TabBarClickable tabs={TABS} current={tab} onSelect={setTab} />
        {globalSearchOpen ? (
          <GlobalSearchOverlay
            query={globalQuery}
            onQueryChange={setGlobalQuery}
            hits={filteredHits}
            onPick={jumpToHit}
            onClose={closeSearch}
          />
        ) : null}
        {!globalSearchOpen && tab === "settings" ? (
          <SettingsEditor
            orchestrator={orchestrator}
            active={editorActive("settings")}
            focusRowId={tab === "settings" ? focusRowId : null}
            onFocusRowConsumed={() => setFocusRowId(null)}
          />
        ) : null}
        {!globalSearchOpen && tab === "trading" ? (
          <TradingEditor
            orchestrator={orchestrator}
            active={editorActive("trading")}
            focusRowId={tab === "trading" ? focusRowId : null}
            onFocusRowConsumed={() => setFocusRowId(null)}
          />
        ) : null}
        {!globalSearchOpen && tab === "models" ? (
          <FinbertModelsEditor
            orchestrator={orchestrator}
            trading={state.trading}
            active={editorActive("models")}
            focusRowId={tab === "models" ? focusRowId : null}
            onFocusRowConsumed={() => setFocusRowId(null)}
          />
        ) : null}
        {!globalSearchOpen && tab === "indicators" ? (
          <IndicatorsEditor
            orchestrator={orchestrator}
            active={editorActive("indicators")}
            focusRowId={tab === "indicators" ? focusRowId : null}
            onFocusRowConsumed={() => setFocusRowId(null)}
          />
        ) : null}
        {!globalSearchOpen && tab === "optimize" ? (
          <OptimizationEditor
            orchestrator={orchestrator}
            active={editorActive("optimize")}
            focusRowId={tab === "optimize" ? focusRowId : null}
            onFocusRowConsumed={() => setFocusRowId(null)}
          />
        ) : null}
        {!globalSearchOpen && tab === "secrets" ? (
          <SecretsEditor
            orchestrator={orchestrator}
            active={editorActive("secrets")}
            focusRowId={tab === "secrets" ? focusRowId : null}
            onFocusRowConsumed={() => setFocusRowId(null)}
          />
        ) : null}
        {!globalSearchOpen && tab === "schedule" ? (
          <ScheduleEditor
            orchestrator={orchestrator}
            active={editorActive("schedule")}
            focusRowId={tab === "schedule" ? focusRowId : null}
            onFocusRowConsumed={() => setFocusRowId(null)}
          />
        ) : null}
        {!globalSearchOpen && tab === "db" ? (
          <DbEditor
            orchestrator={orchestrator}
            state={state}
            active={editorActive("db")}
            focusRowId={tab === "db" ? focusRowId : null}
            onFocusRowConsumed={() => setFocusRowId(null)}
          />
        ) : null}
        </ScreenFrame>
      </ScrollRegion>
      <Box flexShrink={0}>
        <Footer
          hints={[
            "Tabs: click pill labels",
            globalSearchOpen ? "Type in search field, click a result or Close" : "Search all opens cross-tab search",
            "Wheel scrolls the main pane when content is tall",
            "Back (top row) returns Home",
          ]}
        />
      </Box>
    </Box>
  );
}

function GlobalSearchOverlay({
  query,
  onQueryChange,
  hits,
  onPick,
  onClose,
}: {
  query: string;
  onQueryChange: (q: string) => void;
  hits: ReturnType<typeof buildConfigSearchHits>;
  onPick: (h: ReturnType<typeof buildConfigSearchHits>[number]) => void;
  onClose: () => void;
}): React.ReactElement {
  const maxLines = 10;
  const slice = hits.slice(0, maxLines);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.color.accent} paddingX={1} marginBottom={1}>
      <Text bold color={theme.color.primary}>
        Search all tabs
      </Text>
      <Box marginTop={1} flexDirection="row" flexWrap="wrap">
        <Text color={theme.color.muted}>Query: </Text>
        <TextInput value={query} onChange={onQueryChange} />
        <Box marginLeft={1}>
          <Button label="Close" icon={icons.close} onClick={onClose} variant="ghost" />
        </Box>
      </Box>
      <Text color={theme.color.muted}>
        {query.length > 0 && hits.length === 0 ? "No matches" : "Empty query shows the first results — narrow by typing."}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {slice.map((h) => {
          const tabLabel =
            h.tab === "settings"
              ? "Settings"
              : h.tab === "trading"
                ? "Trading"
                : h.tab === "db"
                  ? "DB"
                  : h.tab === "models"
                    ? "Models"
                    : h.tab === "indicators"
                      ? "Indicators"
                      : h.tab === "optimize"
                        ? "Optimize"
                        : h.tab === "secrets"
                          ? "Secrets"
                          : h.tab === "schedule"
                            ? "Schedule"
                            : "Config";
          return (
            <Box key={`${h.tab}-${h.rowId}`} marginBottom={1} flexDirection="row" flexWrap="wrap">
              <Button
                label={`${tabLabel} — ${h.title}`}
                onClick={() => onPick(h)}
                variant="secondary"
                minWidth={24}
              />
            </Box>
          );
        })}
      </Box>
      {hits.length > maxLines ? (
        <Text color={theme.color.muted}>… {hits.length - maxLines} more (narrow your query)</Text>
      ) : null}
    </Box>
  );
}

function labelFor(t: ConfigTab): string {
  return TABS.find((x) => x.id === t)?.label ?? "";
}
