import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import path from 'path'

// OURA_DB_PATH lets a test point at a throwaway copy. Without it, always the
// real database, so nothing can accidentally run against the wrong file.
const dbPath = process.env.OURA_DB_PATH
  ? path.resolve(process.env.OURA_DB_PATH)
  : path.join(__dirname, '../../data/dashboard.db')
const sqlite = new Database(dbPath)

sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
