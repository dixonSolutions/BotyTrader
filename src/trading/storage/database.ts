/**
 * Open SQLite and apply idempotent migrations (pragma user_version).
 */

import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import { MIGRATIONS } from "./migrations.js";

export function openTradingDatabase(absolutePath: string): Database.Database {
  const dir = path.dirname(absolutePath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(absolutePath);
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
