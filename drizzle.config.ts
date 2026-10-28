import { defineConfig } from 'drizzle-kit'
import { config } from './src/lib/config'

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/lib/schema.ts',
  out: './migrations',
  dbCredentials: { url: config.databasePath },
})
