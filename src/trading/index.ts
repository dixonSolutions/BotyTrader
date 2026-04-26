/**
 * Public exports for the deterministic trading engine.
 */

export { TradingEngine, type TradingEngineStatus } from "./engine.js";
export { checkTradingReadiness, type ReadinessResult } from "./readiness.js";
export { computeSimpleStrategy } from "./strategy/simple.js";
export { openTradingDatabase } from "./storage/database.js";
export { TradingRepositories, hashHeadline, newsItemsForSymbol } from "./storage/repositories.js";
export { aggregateNewsSentiment, scoreHeadline, getLocalClassifier } from "./sentiment/finbert.js";
