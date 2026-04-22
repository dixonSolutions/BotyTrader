/**
 * Config container — sub-tabbed editor for everything writable.
 *
 * Tabs (limited to 3 to respect Hick's Law):
 *   - Settings : config.toml fields (broker, watchlist, risk, models, features, autotrade)
 *   - Secrets  : .env credentials (masked)
 *   - Schedule : cycle interval (writes config.toml + reschedules in place)
 *
 * Search:
 *   - `/` — search across all tabs; pick a row to jump there
 *   - `f` — in any tab, filter rows within that tab (see each editor footer)
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import { Footer, Header, ScreenFrame } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import { SecretsEditor } from "./SecretsEditor.js";
import { SettingsEditor } from "./SettingsEditor.js";
import { ScheduleEditor } from "./ScheduleEditor.js";
import type { Orchestrator, OrchestratorState } from "../../../orchestrator.js";
import {
  buildConfigSearchHits,
  hitHaystack,
  matchesConfigFilter,
  type ConfigTabId,
} from "./configSearchIndex.js";

type ConfigTab = ConfigTabId;

const TABS: { id: ConfigTab; label: string; key: string }[] = [
  { id: "settings", label: "Settings", key: "1" },
  { id: "secrets", label: "Secrets", key: "2" },
  { id: "schedule", label: "Schedule", key: "3" },
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
  const [globalResultIndex, setGlobalResultIndex] = useState(0);
  const [focusRowId, setFocusRowId] = useState<string | null>(null);

  const allHits = useMemo(() => buildConfigSearchHits(orchestrator), [orchestrator]);
  const filteredHits = useMemo(
    () => allHits.filter((h) => matchesConfigFilter(globalQuery, hitHaystack(h))),
    [allHits, globalQuery],
  );

  useEffect(() => {
    setGlobalResultIndex((i) => Math.min(i, Math.max(0, filteredHits.length - 1)));
  }, [filteredHits.length]);

  useInput(
    (input, key) => {
      if (!globalSearchOpen) return;
      if (key.escape) {
        setGlobalSearchOpen(false);
        setGlobalQuery("");
        setGlobalResultIndex(0);
        return;
      }
      if (key.upArrow) {
        setGlobalResultIndex((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setGlobalResultIndex((i) => Math.min(Math.max(0, filteredHits.length - 1), i + 1));
        return;
      }
      if (key.return) {
        const hit = filteredHits[globalResultIndex];
        if (hit) {
          setTab(hit.tab);
          setFocusRowId(hit.rowId);
        }
        setGlobalSearchOpen(false);
        setGlobalQuery("");
        setGlobalResultIndex(0);
        return;
      }
      if (key.backspace || key.delete) {
        setGlobalQuery((q) => q.slice(0, -1));
        setGlobalResultIndex(0);
        return;
      }
      if (input && !key.ctrl && !key.meta && input.length === 1) {
        setGlobalQuery((q) => q + input);
        setGlobalResultIndex(0);
      }
    },
    { isActive: globalSearchOpen },
  );

  useInput(
    (input, key) => {
      if (globalSearchOpen) return;
      if (key.escape || input === "h") {
        onBack();
        return;
      }
      const match = TABS.find((t) => t.key === input);
      if (match) setTab(match.id);
    },
    { isActive: !globalSearchOpen },
  );

  const editorActive = (t: ConfigTab) => tab === t && !globalSearchOpen;

  return (
    <Box flexDirection="column">
      <Header
        breadcrumb={["Config", labelFor(tab)]}
        brokerName={state.brokerName}
        connected={state.connected}
      />
      <ScreenFrame
        title="Config"
        subtitle="Edit settings, secrets, and the cycle schedule. Changes persist to config.toml / .env."
      >
        <TabBar current={tab} />
        {globalSearchOpen ? (
          <GlobalSearchView
            query={globalQuery}
            hits={filteredHits}
            selectedIndex={globalResultIndex}
          />
        ) : (
          <>
            {tab === "settings" ? (
              <SettingsEditor
                orchestrator={orchestrator}
                active={editorActive("settings")}
                focusRowId={tab === "settings" ? focusRowId : null}
                onFocusRowConsumed={() => setFocusRowId(null)}
                onOpenGlobalSearch={() => {
                  setGlobalSearchOpen(true);
                  setGlobalQuery("");
                  setGlobalResultIndex(0);
                }}
              />
            ) : null}
            {tab === "secrets" ? (
              <SecretsEditor
                orchestrator={orchestrator}
                active={editorActive("secrets")}
                focusRowId={tab === "secrets" ? focusRowId : null}
                onFocusRowConsumed={() => setFocusRowId(null)}
                onOpenGlobalSearch={() => {
                  setGlobalSearchOpen(true);
                  setGlobalQuery("");
                  setGlobalResultIndex(0);
                }}
              />
            ) : null}
            {tab === "schedule" ? (
              <ScheduleEditor
                orchestrator={orchestrator}
                active={editorActive("schedule")}
                focusRowId={tab === "schedule" ? focusRowId : null}
                onFocusRowConsumed={() => setFocusRowId(null)}
                onOpenGlobalSearch={() => {
                  setGlobalSearchOpen(true);
                  setGlobalQuery("");
                  setGlobalResultIndex(0);
                }}
              />
            ) : null}
          </>
        )}
      </ScreenFrame>
      <Footer
        hints={
          globalSearchOpen
            ? ["type to filter", "↑↓ pick", "Enter jump", "Esc close"]
            : ["/ search all", "f filter tab", "1 settings", "2 secrets", "3 schedule", "h home", "Esc back"]
        }
      />
    </Box>
  );
}

function GlobalSearchView({
  query,
  hits,
  selectedIndex,
}: {
  query: string;
  hits: ReturnType<typeof buildConfigSearchHits>;
  selectedIndex: number;
}): React.ReactElement {
  const maxLines = 10;
  const slice = hits.slice(0, maxLines);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.color.accent} paddingX={1} marginBottom={1}>
      <Text bold color={theme.color.primary}>
        Search all tabs
      </Text>
      <Text color={theme.color.muted}>
        Query: {query.length === 0 ? "(empty shows all)" : query}
        {query.length > 0 && hits.length === 0 ? " — no matches" : null}
      </Text>
      <Box marginTop={1} flexDirection="column">
        {slice.map((h, i) => {
          const sel = i === selectedIndex;
          const tabLabel = h.tab === "settings" ? "Settings" : h.tab === "secrets" ? "Secrets" : "Schedule";
          return (
            <Box key={`${h.tab}-${h.rowId}`} flexDirection="column">
              <Text color={sel ? theme.color.accent : theme.color.text} bold={sel}>
                {sel ? "› " : "  "}
                {tabLabel} › {h.title}
              </Text>
              {h.subtitle ? (
                <Text color={theme.color.muted}>{"    " + truncate(h.subtitle, 72)}</Text>
              ) : null}
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

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function TabBar({ current }: { current: ConfigTab }): React.ReactElement {
  return (
    <Box marginBottom={1}>
      {TABS.map((t, i) => {
        const active = t.id === current;
        return (
          <Box key={t.id} marginRight={i === TABS.length - 1 ? 0 : 2}>
            <Text color={theme.color.muted}>[{t.key}] </Text>
            <Text bold={active} color={active ? theme.color.accent : theme.color.text}>
              {t.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function labelFor(tab: ConfigTab): string {
  return TABS.find((t) => t.id === tab)?.label ?? "";
}
