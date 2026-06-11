import './env.js'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY
const fallbackUrl = 'http://localhost:54321'
const fallbackKey = 'missing-supabase-service-role-key'
const fallbackAnonKey = 'missing-supabase-anon-key'

export const publicSupabaseUrl = supabaseUrl || fallbackUrl
export const publicSupabaseAnonKey = anonKey || fallbackAnonKey

if (!supabaseUrl || !serviceRoleKey) {
  console.warn('[server] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not configured')
}

if (!supabaseUrl || !anonKey) {
  console.warn('[server] SUPABASE_URL or SUPABASE_ANON_KEY/VITE_SUPABASE_ANON_KEY is not configured')
}

export const supabase = createClient(
  supabaseUrl || fallbackUrl,
  serviceRoleKey || fallbackKey,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  }
)

export function createUserClient(accessToken: string) {
  return createClient(
    publicSupabaseUrl,
    publicSupabaseAnonKey,
    {
      global: {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    }
  )
}
