import { defineEventHandler } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { eq, desc } from 'drizzle-orm'

/** List all non-archived accounts. */
export default defineEventHandler(async () => {
  const db = useDb()
  const rows = await db.select().from(schema.accounts)
    .orderBy(desc(schema.accounts.createdAt))
    .all()
  return { accounts: rows.filter((a) => !a.archived) }
})
