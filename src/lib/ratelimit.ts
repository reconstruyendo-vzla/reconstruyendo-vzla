import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const hasRedis = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
)

const redis = hasRedis
  ? new Redis({
      url: process.env.UPSTASH_REDIS_REST_URL!,
      token: process.env.UPSTASH_REDIS_REST_TOKEN!,
    })
  : null

export const ratelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(5, '1 h'),
      analytics: true,
      prefix: 'rvzla:reportar',
    })
  : null

export const notifyRatelimit = redis
  ? new Ratelimit({
      redis,
      limiter: Ratelimit.slidingWindow(3, '1 h'),
      analytics: true,
      prefix: 'rvzla:notify',
    })
  : null

export async function checkRateLimit(
  limiter: Ratelimit | null,
  key: string
): Promise<{ success: boolean; limited: boolean }> {
  if (!limiter) {
    // Sin Upstash Redis no hay rate limit (la app guarda directo en Supabase con RLS)
    return { success: true, limited: false }
  }
  const { success } = await limiter.limit(key)
  return { success, limited: !success }
}
