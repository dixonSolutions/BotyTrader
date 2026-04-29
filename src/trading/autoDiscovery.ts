/**
 * Auto-Discovery for New Users
 *
 * When a user has no positions, automatically discovers and invests
 * in top-ranked stocks to bootstrap their portfolio.
 */

import { submitOrder, type SubmitOrderResult } from "../actions/alpaca.js";
import type { Decision } from "../actions/types.js";
import type { Config, Secrets } from "../config.js";
import type { BrokerAdapter } from "../execution/broker.js";
import { runDiscoveryScan } from "./discovery/scanner.js";
import type { TradingRepositories } from "./storage/repositories.js";
import type { DiscoveryCandidate } from "./discovery/scanner.js";

export interface AutoDiscoveryStatus {
  running: boolean;
  lastMessage: string | null;
  lastRunAt: string | null;
}

/**
 * Check if user has positions and auto-discover if not.
 * Returns true if auto-discovery was triggered.
 */
export async function checkAndRunAutoDiscovery(
  config: Config,
  secrets: Secrets,
  broker: BrokerAdapter,
  repo: TradingRepositories,
  status: AutoDiscoveryStatus,
): Promise<boolean> {
  // Skip if discovery not enabled
  if (!config.discovery?.enabled || !config.discovery.auto_invest) {
    return false;
  }

  // Skip if already running
  if (status.running) {
    return false;
  }

  // Check if user has positions
  const positions = await broker.listPositions();
  if (positions.length > 0) {
    return false; // User has positions, skip auto-discovery
  }

  // Run auto-discovery
  status.running = true;
  status.lastRunAt = new Date().toISOString();

  try {
    await runAutoDiscovery(config, secrets, broker, repo, status);
    return true;
  } finally {
    status.running = false;
  }
}

/**
 * Run auto-discovery and invest in top stocks for new users.
 */
async function runAutoDiscovery(
  config: Config,
  secrets: Secrets,
  broker: BrokerAdapter,
  repo: TradingRepositories,
  status: AutoDiscoveryStatus,
): Promise<void> {
  const hasAlpaca =
    config.broker.platform === "alpaca_paper" || config.broker.platform === "alpaca_live";
  if (!hasAlpaca) {
    status.lastMessage = "Auto-discovery requires Alpaca broker.";
    return;
  }

  status.lastMessage = "Auto-discovering stocks for new portfolio...";

  // Run discovery scan with higher limits for initial portfolio
  const scan = await runDiscoveryScan(config, secrets, broker, repo, {
    maxCandidates: 30,
    minRankScore: config.discovery.min_rank_score ?? 50,
    includePopularETFs: true,
    includeTechStocks: true,
    newsQuery: "stocks earnings",
  });

  if (scan.candidates.length === 0) {
    status.lastMessage = "No suitable stocks found for initial investment.";
    return;
  }

  // Sort by rank and pick top stocks
  const sorted = scan.candidates.sort((a, b) => b.rankScore - a.rankScore);
  const topPicks = sorted.slice(0, Math.min(5, sorted.length));

  // Filter for buy signals
  const investThreshold = config.discovery.invest_threshold ?? 0.3;
  const buyCandidates = topPicks.filter((c) => c.hybridScore > investThreshold);

  if (buyCandidates.length === 0) {
    status.lastMessage = "No stocks with strong buy signals found. Waiting for better opportunities.";
    return;
  }

  status.lastMessage = `Auto-investing in ${buyCandidates.length} stocks: ${buyCandidates.map((c) => c.symbol).join(", ")}...`;

  // Record and invest in each candidate
  for (const candidate of buyCandidates) {
    const discoveryId = repo.insertDiscovery({
      symbol: candidate.symbol,
      source: "auto_new_user",
      technicalScore: candidate.technicalScore,
      sentimentScore: candidate.sentimentScore,
      hybridScore: candidate.hybridScore,
      rankScore: candidate.rankScore,
      priceAtDiscovery: candidate.price,
      action: "buy",
      notes: `Auto-selected for new portfolio: ${candidate.reason}`,
    });

    await investInDiscovery(config, broker, repo, candidate, discoveryId);
  }

  status.lastMessage = `Successfully started portfolio with ${buyCandidates.length} positions.`;
}

/**
 * Execute a buy order for a discovered stock.
 */
async function investInDiscovery(
  config: Config,
  broker: BrokerAdapter,
  repo: TradingRepositories,
  candidate: DiscoveryCandidate,
  discoveryId: string,
): Promise<void> {
  try {
    const account = await broker.getAccount();
    const maxPositionNotional = (account.equity * config.risk.max_position_pct) / 100;
    const qty = Math.max(1, Math.floor(maxPositionNotional / candidate.price));

    const decision: Decision = {
      action: "buy",
      symbol: candidate.symbol,
      qty,
      reasoning: `Auto-discovery: ${candidate.reason}`,
      confidence: (candidate.hybridScore + 1) / 2,
    };

    const submission: SubmitOrderResult = await submitOrder(decision, config, broker);

    if (submission.submitted && submission.order) {
      repo.markDiscoveryInvested(discoveryId);

      repo.insertTrade({
        signalId: null,
        brokerOrderId: submission.order.id,
        symbol: candidate.symbol,
        side: "buy",
        qty,
        status: submission.order.status,
        submittedAt: submission.order.submittedAt,
        filledAt: null,
        filledAvgPrice: submission.order.filledAvgPrice ?? null,
      });
    }
  } catch (e) {
    // Log but don't fail the entire discovery process
    console.error(`Auto-discovery: Failed to invest in ${candidate.symbol}:`, e);
  }
}

/**
 * Create initial auto-discovery status.
 */
export function createAutoDiscoveryStatus(): AutoDiscoveryStatus {
  return {
    running: false,
    lastMessage: null,
    lastRunAt: null,
  };
}
