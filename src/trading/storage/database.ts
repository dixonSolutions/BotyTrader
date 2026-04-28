/**
 * Open SQLite and apply idempotent migrations (pragma user_version).
 */

import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

import type Database from "better-sqlite3";

import { MIGRATIONS } from "./migrations.js";

const require = createRequire(import.meta.url);

function loadDatabase(): typeof Database {
  return require("better-sqlite3") as typeof Database;
}

export function openTradingDatabase(absolutePath: string): Database.Database {
  const dir = path.dirname(absolutePath);
  fs.mkdirSync(dir, { recursive: true });
  const DatabaseCtor = loadDatabase();
  const db = new DatabaseCtor(absolutePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  const target = MIGRATIONS.length;
  const current = Number(db.pragma("user_version", { simple: true }) ?? 0);
  for (let i = current; i < target; i++) {
    db.exec(MIGRATIONS[i]!);
  }
  db.pragma(`user_version = ${target}`);
  return db;
}
