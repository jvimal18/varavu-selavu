import { defineEventHandler } from 'h3'
import { getCurrentUser } from '~~/server/utils/auth'

export default defineEventHandler(async (event) => {
  const user = await getCurrentUser(event)
  if (!user) {
    return { user: null }
  }
  return {
    user: {
      id: user.id,
      name: user.name,
      color: user.color,
      hasPin: !!user.pinHash,
    },
  }
})
