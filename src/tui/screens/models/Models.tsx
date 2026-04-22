/**
 * Models screen — manage local Hugging Face models.
 *
 * Three sub-views (Hick's Law: 3 ≤ choices ≤ 5):
 *   - Installed : list every model on disk; select / delete
 *   - Install   : type a Hugging Face repo id and pull it
 *   - Details   : per-model size, path, files
 *
 * Visual hierarchy follows Insights/Config: Header → tabs → Panel → Footer.
 * The accent colour follows `theme.color.accent` (Consistency).
 */

import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";

import { Footer, Header, ScreenFrame } from "../../components/Layout.js";
import { theme } from "../../theme.js";
import { ModelList } from "./ModelList.js";
import { ModelInstall } from "./ModelInstall.js";
import { ModelDetails } from "./ModelDetails.js";
import type { Orchestrator, OrchestratorState } from "../../../orchestrator.js";
import {
  formatBytes,
  type InstalledModel,
} from "../../../llm/model_manager.js";

type Tab = "installed" | "install" | "details";

const TABS: { id: Tab; label: string; key: string }[] = [
  { id: "installed", label: "Installed", key: "1" },
  { id: "install", label: "Install", key: "2" },
  { id: "details", label: "Details", key: "3" },
];

interface Props {
  orchestrator: Orchestrator;
  state: OrchestratorState;
  onBack: () => void;
}

export function Models({ orchestrator, state, onBack }: Props): React.ReactElement {
  const [tab, setTab] = useState<Tab>("installed");
  const [installed, setInstalled] = useState<InstalledModel[]>(() =>
    orchestrator.models.listInstalled(),
  );
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [busy, setBusy] = useState(false);

  function refresh(): void {
    setInstalled(orchestrator.models.listInstalled());
  }

  useEffect(() => {
    refresh();
  }, []);

  useInput((input, key) => {
    if (busy) return;
    if (key.escape || input === "h") {
      onBack();
      return;
    }
    const match = TABS.find((t) => t.key === input);
    if (match) {
      setTab(match.id);
      return;
    }
  });

  const activeId = orchestrator.models.activeId;
  const totalSize = useMemo(
    () => installed.reduce((acc, m) => acc + m.sizeBytes, 0),
    [installed],
  );

  return (
    <Box flexDirection="column">
      <Header
        breadcrumb={["Models", labelFor(tab)]}
        brokerName={state.brokerName}
        connected={state.connected}
      />
      <ScreenFrame
        title="Models"
        subtitle="Install, select, and delete local Hugging Face models. The active one powers the trading agent."
      >
        <SummaryStrip
          activeId={activeId}
          installedCount={installed.length}
          totalSize={totalSize}
          cacheDir={orchestrator.models.cacheDir}
        />
        <TabBar current={tab} />
        {tab === "installed" ? (
          <ModelList
            installed={installed}
            activeId={activeId}
            selectedIdx={selectedIdx}
            onSelectedIdxChange={setSelectedIdx}
            disabled={busy}
            onMakeActive={async (id) => {
              setBusy(true);
              try {
                await orchestrator.models.select(id);
              } finally {
                setBusy(false);
                refresh();
              }
            }}
            onDelete={async (id) => {
              setBusy(true);
              try {
                await orchestrator.models.delete(id);
              } finally {
                setBusy(false);
                refresh();
                setSelectedIdx((i) => Math.max(0, i - 1));
              }
            }}
          />
        ) : null}
        {tab === "install" ? (
          <ModelInstall
            disabled={busy}
            onPull={async (id, onProgress) => {
              setBusy(true);
              try {
                await orchestrator.models.pull(id, onProgress);
                refresh();
              } finally {
                setBusy(false);
              }
            }}
            onSelectAfterPull={async (id) => {
              setBusy(true);
              try {
                await orchestrator.models.select(id);
                refresh();
                setTab("installed");
              } finally {
                setBusy(false);
              }
            }}
          />
        ) : null}
        {tab === "details" ? (
          <ModelDetails model={installed[selectedIdx] ?? null} activeId={activeId} />
        ) : null}
      </ScreenFrame>
      <Footer
        hints={[
          "1 installed",
          "2 install",
          "3 details",
          tab === "installed" ? "↑/↓ pick · Enter activate · d delete" : "",
          tab === "install" ? "type repo id · Enter install" : "",
          "h home",
          "Esc back",
        ].filter(Boolean)}
      />
    </Box>
  );
}

function SummaryStrip({
  activeId,
  installedCount,
  totalSize,
  cacheDir,
}: {
  activeId: string;
  installedCount: number;
  totalSize: number;
  cacheDir: string;
}): React.ReactElement {
  return (
    <Box
      borderStyle="round"
      borderColor={theme.color.muted}
      paddingX={1}
      marginBottom={1}
      flexDirection="column"
    >
      <Box justifyContent="space-between">
        <Box>
          <Text color={theme.color.muted}>Active </Text>
          <Text bold color={activeId ? theme.color.success : theme.color.danger}>
            {activeId || "(none)"}
          </Text>
        </Box>
        <Box>
          <Text color={theme.color.muted}>Installed </Text>
          <Text>{installedCount}</Text>
          <Text color={theme.color.muted}>  ·  Total </Text>
          <Text>{formatBytes(totalSize)}</Text>
        </Box>
      </Box>
      <Text color={theme.color.muted}>Cache: {cacheDir}</Text>
    </Box>
  );
}

function TabBar({ current }: { current: Tab }): React.ReactElement {
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

function labelFor(tab: Tab): string {
  return TABS.find((t) => t.id === tab)?.label ?? "";
}
