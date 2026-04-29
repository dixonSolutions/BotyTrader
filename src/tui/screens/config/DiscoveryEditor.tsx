/**
 * Discovery editor — configure auto-discovery scanner and auto-investment.
 */

import React, { useMemo, useState } from "react";
import { Box, Text } from "ink";

import { Button } from "../../components/Button.js";
import { Panel, StatRow } from "../../components/Layout.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import { writeConfig } from "../../../config.js";
import type { Orchestrator } from "../../../orchestrator.js";

interface Props {
  orchestrator: Orchestrator;
}

export function DiscoveryEditor({ orchestrator }: Props): React.ReactElement {
  const { config } = orchestrator;
  const [saved, setSaved] = useState(false);

  const discovery = config.discovery ?? {};

  const fields = useMemo(
    () => [
      { id: "enabled", label: "Discovery enabled", value: discovery.enabled ?? false, type: "boolean" },
      { id: "auto_invest", label: "Auto-invest", value: discovery.auto_invest ?? false, type: "boolean" },
      {
        id: "scan_interval_seconds",
        label: "Scan interval (seconds)",
        value: discovery.scan_interval_seconds ?? 14400,
        type: "number",
      },
      { id: "max_candidates", label: "Max candidates per scan", value: discovery.max_candidates ?? 20, type: "number" },
      { id: "min_rank_score", label: "Min rank score (0-100)", value: discovery.min_rank_score ?? 50, type: "number" },
      { id: "max_new_positions", label: "Max new positions per scan", value: discovery.max_new_positions ?? 3, type: "number" },
      {
        id: "invest_threshold",
        label: "Invest threshold (-1 to 1)",
        value: discovery.invest_threshold ?? 0.4,
        type: "number",
      },
      { id: "cooldown_hours", label: "Rediscovery cooldown (hours)", value: discovery.cooldown_hours ?? 48, type: "number" },
      { id: "include_etfs", label: "Include ETFs", value: discovery.include_etfs ?? true, type: "boolean" },
      { id: "include_tech", label: "Include tech stocks", value: discovery.include_tech ?? true, type: "boolean" },
      { id: "news_query", label: "News query", value: discovery.news_query ?? "stocks earnings", type: "string" },
    ],
    [discovery],
  );

  function toggleField(id: string): void {
    const current = fields.find((f) => f.id === id)?.value;
    const newValue = !current;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = { ...config.discovery };
    patch[id] = newValue;
    config.discovery = patch;
    writeConfig(config);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  return (
    <Panel>
      <Box marginBottom={1}>
        <Text bold color={theme.color.primary}>
          Discovery Scanner
        </Text>
      </Box>

      <Text color={theme.color.muted}>
        Automatically finds and ranks new stocks beyond your watchlist.
      </Text>

      <Box marginTop={1} flexDirection="column">
        {fields.map((field) => (
          <Box key={field.id} marginY={0} flexDirection="row" justifyContent="space-between">
            <Text color={theme.color.text}>{field.label}</Text>
            {field.type === "boolean" ? (
              <Button
                label={field.value ? "ON" : "OFF"}
                onClick={() => toggleField(field.id)}
                variant={field.value ? "primary" : "ghost"}
                minWidth={6}
              />
            ) : (
              <Text color={theme.color.accent}>{String(field.value)}</Text>
            )}
          </Box>
        ))}
      </Box>

      <Box marginTop={1}>
        <Text color={theme.color.muted}>
          Edit config.toml directly to change numeric values. Discovery runs on its own cycle and scans
          popular ETFs, tech stocks, and news for opportunities.
        </Text>
      </Box>

      {saved ? (
        <Box marginTop={1}>
          <Text color={theme.color.success}>{icons.check} Saved</Text>
        </Box>
      ) : null}

      <Box marginTop={1} flexDirection="column">
        <StatRow
          label="Status"
          value={discovery.enabled ? (discovery.auto_invest ? "Active + Auto-invest" : "Active") : "Disabled"}
        />
        <StatRow
          label="Next scan"
          value={discovery.enabled ? `${((discovery.scan_interval_seconds ?? 14400) / 3600).toFixed(1)}h intervals` : "—"}
        />
      </Box>
    </Panel>
  );
}
