import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

// Print layout: auth-protected but no sidebar or shell chrome.
// Used by fact-finder and form print routes so they render as clean
// standalone documents without the internal nav overlapping on print.
export default async function PrintLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return <>{children}</>
}
