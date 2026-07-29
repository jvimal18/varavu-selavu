import type { Config } from 'drizzle-kit'

export default <Config>{
  schema: './server/db/schema.ts',
  out: './db/migrations',
  dialect: 'sqlite',
  dbCredentials: {
    url: './data/dev.db',
  },
}
