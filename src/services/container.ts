/**
 * Service Container — lightweight DI registry for the three core services:
 *
 *   "logs"   → LogService   (always present after bootstrap)
 *   "db"     → Database     (nullable; engine opens it lazily)
 *   "alpaca" → BrokerAdapter (nullable until secrets load)
 *
 * All three are registered during `loadRuntime()` / `bootstrapOrchestrator()`.
 * Consumers call `container.resolve("logs")` to get the singleton.
 *
 * Design: intentionally minimal — no reflection, no decorators, no async
 * factories.  The goal is predictable wiring (Open/Closed + DRY) not a
 * framework.
 */

import type { LogService } from "./logService.js";
import type { BrokerAdapter } from "../execution/broker.js";
import type Database from "better-sqlite3";

/** All injectable services and their resolved types. */
export interface ServiceMap {
  /** Real-time structured log bus. */
  logs: LogService;
  /** SQLite trading database (null when path unreachable or native module missing). */
  db: Database.Database | null;
  /** Alpaca broker adapter (null when credentials are absent or platform mismatch). */
  alpaca: BrokerAdapter | null;
}

type ServiceKey = keyof ServiceMap;

class ServiceContainer {
  private readonly registry = new Map<ServiceKey, unknown>();

  /**
   * Register a service value under the given key.
   * Calling again with the same key overwrites the previous entry (e.g. when
   * the broker swaps between paper ↔ live).
   */
  register<K extends ServiceKey>(key: K, service: ServiceMap[K]): void {
    this.registry.set(key, service);
  }

  /**
   * Resolve a registered service.
   * Throws if the service has not been registered — signals a wiring bug.
   */
  resolve<K extends ServiceKey>(key: K): ServiceMap[K] {
    if (!this.registry.has(key)) {
      throw new Error(`[DI] Service "${key}" is not registered. Check bootstrap order in runtime.ts.`);
    }
    return this.registry.get(key) as ServiceMap[K];
  }

  /**
   * Attempt to resolve a service; returns `undefined` if not yet registered.
   * Use when the service may be absent at call time (e.g. optional DB).
   */
  tryResolve<K extends ServiceKey>(key: K): ServiceMap[K] | undefined {
    return this.registry.get(key) as ServiceMap[K] | undefined;
  }

  /** Returns true when the key has been registered. */
  has(key: ServiceKey): boolean {
    return this.registry.has(key);
  }
}

/** Application-wide singleton DI container. */
export const container = new ServiceContainer();
