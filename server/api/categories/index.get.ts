import { defineEventHandler } from 'h3'
import { useDb, schema } from '~~/server/db/client'
import { asc } from 'drizzle-orm'

/** List all non-archived categories, grouped by type, ordered by sortOrder. */
export default defineEventHandler(async () => {
  const db = useDb()
  const rows = await db.select().from(schema.categories)
    .orderBy(asc(schema.categories.type), asc(schema.categories.sortOrder), asc(schema.categories.name))
    .all()

  return {
    categories: rows.filter((c) => !c.archived),
  }
})
