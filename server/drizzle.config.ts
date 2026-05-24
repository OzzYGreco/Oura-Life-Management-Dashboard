import { defineConfig } from 'drizzle-kit'
import path from 'path'

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/dashboard.db',
  },
})
