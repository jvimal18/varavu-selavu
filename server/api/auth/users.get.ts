import { defineEventHandler } from 'h3'
import { useDb, schema } from '~~/server/db/client'

/**
 * Returns all users (for the login user-picker). Public endpoint.
 */
export default defineEventHandler(async (event) => {
  const db = useDb()
  const users = await db.select({
    id: schema.users.id,
    name: schema.users.name,
    color: schema.users.color,
    hasPin: schema.users.pinHash,
  }).from(schema.users).all()
  return {
    users: users.map((u) => ({ ...u, hasPin: !!u.hasPin })),
  }
})
