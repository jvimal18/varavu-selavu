import { defineEventHandler } from 'h3'
import { and } from 'drizzle-orm'
import { useDb, schema } from '~~/server/db/client'

/** All users (for "spent by" filters and switcher). */
export default defineEventHandler(async () => {
  const db = useDb()
  const users = await db.select({
    id: schema.users.id,
    name: schema.users.name,
    color: schema.users.color,
  }).from(schema.users).all()
  return { users }
})
