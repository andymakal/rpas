'use client'

import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

/**
 * The single sign-out action for internal chrome. Both the sidebar footer and
 * Bob's workflow header use this so there is one definition of what signing out
 * does (end the Supabase session, return to login). Extracted from the original
 * inline Sidebar handler without changing its behavior.
 */
export function useSignOut(): () => Promise<void> {
  const router = useRouter()
  const supabase = createClient()
  return async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }
}
