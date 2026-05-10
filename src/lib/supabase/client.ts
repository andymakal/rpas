import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    'https://erbvssfcglhnelfelbfi.supabase.co',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}