/**
 * Alpaca Market Data news — lazy loading with progress bar.
 * Loads news in batches as user scrolls, with real-time progress indication.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, useStdout } from "ink";

import TextInput from "../../components/SafeTextInput.js";
import { Button } from "../../components/Button.js";
import { Panel, StatRow } from "../../components/Layout.js";
import { ScrollRegion } from "../../components/ScrollRegion.js";
import { AppTable, type AppTableRow } from "../../components/AppTable.js";
import { AlpacaScoredSymbolsBlock } from "./AlpacaScoredSymbolsBlock.js";
import { ProgressBar } from "../../components/ProgressBar.js";
import { useMouse } from "@zenobius/ink-mouse";
import { icons } from "../../components/icons.js";
import { theme } from "../../theme.js";
import type { NewsItem } from "../../../execution/broker.js";
import type { Orchestrator } from "../../../orchestrator.js";
import type { AlpacaSearchScoredSymbol } from "../../../trading/types.js";
import { buildAlpacaNewsSearchScoredSymbol } from "../../../trading/display/alpacaNewsSearchCandidate.js";

interface Props {
  orchestrator: Orchestrator;
  connected: boolean;
  showPanelHeading?: boolean;
}

interface SearchResult {
  news: NewsItem[];
  candidates: AlpacaSearchScoredSymbol[];
  totalAvailable: number;
  nextPageToken?: string | null;
}

/** Build news table data for visible items only */
function buildNewsTableData(news: NewsItem[], startIdx: number, count: number, width: number): { rows: AppTableRow[]; columns: string[] } {
  const w = Math.max(48, width);
  const dateW = 16;
  const srcW = Math.min(12, Math.max(8, Math.floor(w * 0.12)));
  const symW = Math.min(14, Math.max(8, Math.floor(w * 0.14)));
  const titleW = Math.max(20, w - dateW - srcW - symW - 20);

  const columns = ["#", "Time", "Source", "Symbols", "Headline"];

  const visibleNews = news.slice(startIdx, startIdx + count);
  const rows: AppTableRow[] = visibleNews.map((it, i) => {
    const sym = (it.symbols ?? []).length > 0 ? it.symbols!.join(",") : "—";
    const t = it.publishedAt;
    const timeStr = t.length >= 16 ? `${t.slice(11, 16)} ${t.slice(8, 10)}/${t.slice(5, 7)}` : t;

    return {
      "#": String(startIdx + i + 1),
      Time: timeStr.slice(0, dateW),
      Source: it.source.slice(0, srcW),
      Symbols: sym.slice(0, symW),
      Headline: it.title.slice(0, titleW),
    };
  });

  return { rows, columns };
}

/** Batch size for lazy loading */
const NEWS_BATCH_SIZE = 10;
const SYMBOLS_BATCH_SIZE = 5;

export function AlpacaSearchPanel({
  orchestrator,
  connected,
  showPanelHeading = true,
}: Props): React.ReactElement {
  const { stdout } = useStdout();
  const mouse = useMouse();
  const cols = stdout.columns ?? 80;
  const rows = stdout.rows ?? 24;

  // Search state
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResult | null>(null);

  // Lazy loading state
  const [visibleNewsCount, setVisibleNewsCount] = useState(NEWS_BATCH_SIZE);
  const [loadingMore, setLoadingMore] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: "" });

  // Scoring state
  const [scoringProgress, setScoringProgress] = useState({ current: 0, total: 0 });
  const [pendingSymbols, setPendingSymbols] = useState<string[]>([]);
  const [scoredCandidates, setScoredCandidates] = useState<AlpacaSearchScoredSymbol[]>([]);

  const searchWidth = Math.min(72, Math.max(36, cols - 8));

  // Get strategy weights from config
  const config = orchestrator.config;
  const simple = config.strategy.simple;
  const techWeight = simple.technical_weight;
  const sentWeight = simple.sentiment_weight;

  // Calculate visible items based on terminal height
  const visibleNewsRows = Math.max(5, Math.min(NEWS_BATCH_SIZE, Math.floor(rows * 0.3)));

  /** Load more news on scroll */
  const loadMoreNews = useCallback(() => {
    if (!results || loadingMore) return;
    if (visibleNewsCount >= results.news.length) return;

    setLoadingMore(true);
    // Simulate brief loading delay for UX
    setTimeout(() => {
      setVisibleNewsCount((prev) => Math.min(prev + NEWS_BATCH_SIZE, results.news.length));
      setLoadingMore(false);
    }, 200);
  }, [results, visibleNewsCount, loadingMore]);

  /** Score symbols progressively */
  const scoreSymbolsBatch = useCallback(
    async (symbols: string[], startIdx: number) => {
      const repo = orchestrator.tradingEngine["repo"];
      if (!repo) return;

      const broker = orchestrator.broker;
      const batch = symbols.slice(startIdx, startIdx + SYMBOLS_BATCH_SIZE);
      const newCandidates: AlpacaSearchScoredSymbol[] = [];

      for (const symbol of batch) {
        try {
          setScoringProgress({ current: startIdx + newCandidates.length + 1, total: symbols.length });

          const bars = await broker.getPriceHistory(symbol, 120);
          if (bars.length < 55) continue;

          const closes = bars.map((b) => b.c);
          const ohlcBars = bars.map((b) => ({ o: b.o, h: b.h, l: b.l, c: b.c, v: b.v }));

          let symbolNews: NewsItem[] = [];
          if (broker.getNews) {
            try {
              symbolNews = await broker.getNews(symbol, 12);
            } catch {
              // ignore
            }
          }

          const { aggregateNewsSentiment } = await import("../../../trading/sentiment/finbert.js");
          const { newsItemsForSymbol } = await import("../../../trading/storage/repositories.js");
          const { computeSimpleStrategy } = await import("../../../trading/strategy/simple.js");

          const { sentimentScore } = await aggregateNewsSentiment(
            config,
            orchestrator["secrets"],
            repo,
            newsItemsForSymbol(symbolNews),
          );

          const strat = computeSimpleStrategy(config, { bars: ohlcBars, sentimentScore });

          newCandidates.push(
            buildAlpacaNewsSearchScoredSymbol({
              symbol,
              strat,
              sentimentScore,
              price: closes[closes.length - 1] ?? 0,
              volume24h: bars[bars.length - 1]?.v ?? 0,
              newsCount: symbolNews.length,
            }),
          );
        } catch {
          // Skip failed symbols
        }
      }

      setScoredCandidates((prev) => {
        const combined = [...prev, ...newCandidates];
        combined.sort((a, b) => b.rankScore - a.rankScore);
        return combined;
      });

      // Continue with next batch if there are more symbols
      const nextIdx = startIdx + SYMBOLS_BATCH_SIZE;
      if (nextIdx < symbols.length) {
        setTimeout(() => {
          void scoreSymbolsBatch(symbols, nextIdx);
        }, 100);
      }
    },
    [config, orchestrator],
  );

  /** Initial search - fetch news first, then start progressive scoring */
  const runSearch = useCallback(
    async (raw: string): Promise<void> => {
      const q = raw.trim();
      setError(null);
      setResults(null);
      setVisibleNewsCount(visibleNewsRows);
      setScoredCandidates([]);
      setPendingSymbols([]);
      setProgress({ current: 0, total: 0, phase: "" });
      setScoringProgress({ current: 0, total: 0 });

      if (!q) {
        setError("Type a ticker (e.g. AAPL) or keywords, then search.");
        return;
      }
      if (!connected) {
        setError("Broker is not connected — check keys and ping from the toolbar.");
        return;
      }

      setLoading(true);
      setProgress({ current: 0, total: 100, phase: "Fetching news..." });

      try {
        // Fetch news
        const newsOut = await orchestrator.searchAlpacaNews(q);
        if (!newsOut.ok) {
          setError(newsOut.error);
          return;
        }

        if (newsOut.items.length === 0) {
          setError("No articles matched. Try another symbol or broader keywords.");
          return;
        }

        setProgress({ current: 50, total: 100, phase: "Processing results..." });

        // Extract unique symbols
        const symbols = new Set<string>();
        for (const item of newsOut.items) {
          if (item.symbols) {
            for (const sym of item.symbols) {
              symbols.add(sym.toUpperCase());
            }
          }
        }

        const symbolList = Array.from(symbols).slice(0, 15); // Limit to 15 symbols

        setResults({
          news: newsOut.items,
          candidates: [],
          totalAvailable: newsOut.items.length,
        });

        setPendingSymbols(symbolList);
        setScoringProgress({ current: 0, total: symbolList.length });

        // Start progressive scoring
        if (symbolList.length > 0) {
          setProgress({ current: 100, total: 100, phase: `Scoring ${symbolList.length} symbols...` });
          void scoreSymbolsBatch(symbolList, 0);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [orchestrator, connected, visibleNewsRows, scoreSymbolsBatch],
  );

  const newsTable = useMemo(() => {
    if (!results?.news.length) return null;
    return buildNewsTableData(results.news, 0, visibleNewsCount, Math.max(48, cols - 4));
  }, [results?.news, visibleNewsCount, cols]);

  // Wheel scroll handler for lazy loading
  useEffect(() => {
    const onScroll = (_pos: { x: number; y: number }, dir: "scrollup" | "scrolldown" | null) => {
      if (dir === "scrolldown" && results) {
        loadMoreNews();
      }
    };

    mouse.events.on("scroll", onScroll);
    return () => {
      mouse.events.off("scroll", onScroll);
    };
  }, [mouse.events, results, loadMoreNews]);

  const hasMoreNews = results && visibleNewsCount < results.news.length;

  return (
    <Panel title={showPanelHeading ? "Alpaca Search + Scoring" : undefined}>
      <Text color={theme.color.muted}>
        Search news with lazy loading. Final score = Tech ({(techWeight * 100).toFixed(0)}%) × technical + Sent (
        {(sentWeight * 100).toFixed(0)}%) × sentiment.
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
          label={loading ? "Searching…" : "Search with Scoring"}
          icon={icons.search}
          onClick={() => void runSearch(query)}
          disabled={loading || !connected}
          variant="success"
          minWidth={searchWidth}
        />
      </Box>

      {/* Progress Bar */}
      {(loading || scoringProgress.current < scoringProgress.total) && (
        <Box marginTop={1} flexDirection="column">
          <Text color={theme.color.primary}>{progress.phase || "Scoring symbols..."}</Text>
          <Box marginTop={0}>
            <ProgressBar
              percent={
                loading
                  ? (progress.current / progress.total) * 100
                  : (scoringProgress.current / scoringProgress.total) * 100
              }
              width={Math.min(40, cols - 10)}
              fillColor={theme.color.success}
              emptyColor={theme.color.muted}
            />
          </Box>
          <Text color={theme.color.muted}>
            {scoringProgress.current > 0
              ? `Scored ${scoringProgress.current} of ${scoringProgress.total} symbols...`
              : "Loading news data..."}
          </Text>
        </Box>
      )}

      {error ? (
        <Box marginTop={1}>
          <Text color={theme.color.warn}>{error}</Text>
        </Box>
      ) : null}

      {results && (
        <Box marginTop={1} flexDirection="column">
          {/* Stats Row */}
          <Box marginBottom={1}>
            <StatRow
              label="Results"
              value={`${visibleNewsCount}/${results.news.length} articles · ${scoredCandidates.length}/${pendingSymbols.length} symbols scored`}
            />
          </Box>

          {/* Scored Symbols Table */}
          {scoredCandidates.length > 0 ? (
            <Box marginBottom={2} flexDirection="column">
              <ScrollRegion>
                <AlpacaScoredSymbolsBlock
                  candidates={scoredCandidates}
                  mouse={mouse}
                  techWeightPct={techWeight * 100}
                  sentWeightPct={sentWeight * 100}
                  buyThreshold={simple.buy_threshold}
                  sellThreshold={simple.sell_threshold}
                />
              </ScrollRegion>
            </Box>
          ) : null}

          {/* News Articles - Lazy Loaded */}
          {newsTable && (
            <Box flexDirection="column">
              <Box flexDirection="row" justifyContent="space-between">
                <Text bold color={theme.color.primary}>News Articles</Text>
                <Text color={theme.color.muted}>
                  Showing {visibleNewsCount} of {results.news.length}
                </Text>
              </Box>

              <Box marginTop={1}>
                <ScrollRegion>
                  <AppTable
                    data={newsTable.rows}
                    columns={newsTable.columns}
                    padding={1}
                  />
                </ScrollRegion>
              </Box>

              {/* Load More Button */}
              {hasMoreNews && (
                <Box marginTop={1}>
                  <Button
                    label={loadingMore ? "Loading…" : `Load more (+${Math.min(NEWS_BATCH_SIZE, results.news.length - visibleNewsCount)})`}
                    onClick={loadMoreNews}
                    disabled={loadingMore}
                    variant="secondary"
                    minWidth={30}
                  />
                </Box>
              )}

              {loadingMore && (
                <Box marginTop={1}>
                  <ProgressBar
                    percent={50}
                    width={Math.min(30, cols - 10)}
                    fillColor={theme.color.success}
                    emptyColor={theme.color.muted}
                    showPercent={false}
                  />
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
    </Panel>
  );
}
