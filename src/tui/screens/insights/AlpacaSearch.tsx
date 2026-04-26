/**
 * Alpaca Market Data news — ticker or keyword prompt, wide primary action.
 */

import React, { useCallback, useState } from "react";
import { Box, Text, useStdout } from "ink";

import TextInput from "../../components/SafeTextInput.js";
import { Button } from "../../components/Button.js";
import { Panel } from "../../components/Layout.js";
import { ScrollRegion } from "../../components/ScrollRegion.js";
import { AppTable } from "../../components/AppTable.js";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import type { NewsItem } from "../../../execution/broker.js";
import type { Orchestrator } from "../../../orchestrator.js";
import { buildNewsTableData } from "./newsTable.js";

interface Props {
  orchestrator: Orchestrator;
  connected: boolean;
  /** Set false when the parent screen already shows “Alpaca Search” as the main title. */
  showPanelHeading?: boolean;
}

export function AlpacaSearchPanel({
  orchestrator,
  connected,
  showPanelHeading = true,
}: Props): React.ReactElement {
  const { stdout } = useStdout();
  const cols = stdout.columns ?? 80;
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<NewsItem[] | null>(null);

  const searchWidth = Math.min(72, Math.max(36, cols - 8));

  const runSearch = useCallback(
    async (raw: string): Promise<void> => {
      const q = raw.trim();
      setError(null);
      setResults(null);
      if (!q) {
        setError("Type a ticker (e.g. AAPL) or keywords, then search.");
        return;
      }
      if (!connected) {
        setError("Broker is not connected — check keys and ping from the toolbar.");
        return;
      }
      setLoading(true);
      try {
        const out = await orchestrator.searchAlpacaNews(q);
        if (!out.ok) {
          setError(out.error);
          return;
        }
        setResults(out.items);
        if (out.items.length === 0) {
          setError("No articles matched. Try another symbol or broader keywords.");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [orchestrator, connected],
  );

  const tableSpec =
    results && results.length > 0 ? buildNewsTableData(results, Math.max(48, cols - 2 * theme.padding)) : null;

  return (
    <Panel title={showPanelHeading ? "Alpaca Search" : undefined}>
      <Text color={theme.color.muted}>
        Market Data news: <Text bold>AAPL</Text> or <Text bold>AAPL,MSFT</Text> uses Alpaca{" "}
        <Text bold>symbols</Text> (every page, 50 rows each, until the API ends — max 10,000). Keywords fetch the same
        full timeline then filter title/summary on this machine.
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Text color={theme.color.muted}>Search</Text>
        <Box borderStyle="round" borderColor={theme.color.muted} paddingX={1}>
          <TextInput
            value={query}
            onChange={setQuery}
            onSubmit={(v) => void runSearch(v)}
            placeholder="Ticker or keywords…"
          />
        </Box>
      </Box>
      <Box marginTop={1}>
        <Button
          label={loading ? "Searching…" : "Search news with Alpaca"}
          icon={icons.search}
          onClick={() => void runSearch(query)}
          disabled={loading || !connected}
          variant="success"
          minWidth={searchWidth}
        />
      </Box>
      {error ? (
        <Box marginTop={1}>
          <Text color={theme.color.warn}>{error}</Text>
        </Box>
      ) : null}
      {tableSpec ? (
        <Box marginTop={1} flexDirection="column" flexGrow={1} minHeight={0}>
          <Text color={theme.color.muted}>
            <Text bold color={theme.color.text}>
              {results?.length ?? 0} article{(results?.length ?? 0) === 1 ? "" : "s"}
            </Text>{" "}
            — table (wheel scroll when over the results pane).
          </Text>
          <Box marginTop={1} flexGrow={1} minHeight={8} flexDirection="column">
            <ScrollRegion showScrollbar>
              <AppTable data={tableSpec.rows} columns={tableSpec.columns} padding={1} />
            </ScrollRegion>
          </Box>
        </Box>
      ) : null}
    </Panel>
  );
}
