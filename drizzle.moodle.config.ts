import { defineConfig } from 'drizzle-kit'
import { config } from './src/lib/config'

// Moodle モードの DB（data/moodle-mode.db）。完全移行のあとは、このファイルと migrations-moodle/ ごと消す
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/moodle-mode/schema.ts',
  out: './migrations-moodle',
  dbCredentials: { url: config.moodleDatabasePath },
})
