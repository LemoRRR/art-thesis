import './env'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const fallbackUrl = 'http://localhost:54321'
const fallbackKey = 'missing-supabase-service-role-key'

if (!supabaseUrl || !serviceRoleKey) {
  console.warn('[server] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured')
}

export const supabase = createClient(
  supabaseUrl || fallbackUrl,
  serviceRoleKey || fallbackKey
)

export function createUserClient(accessToken: string) {
  return createClient(
    supabaseUrl || fallbackUrl,
    serviceRoleKey || fallbackKey,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    }
  )
}
