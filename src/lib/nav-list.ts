/**
 * List navigation helpers — Prev / Next across detail pages.
 *
 * When a user clicks a row in any list (Referrals, Triage, Cases,
 * Service Requests, Reviews), the list stores the currently visible
 * ordered IDs in sessionStorage.  The detail page reads them to show
 * ← Prev  N / total  Next → controls in the header.
 *
 * Uses sessionStorage so:
 *   - No URL bloat (IDs stay out of the query string)
 *   - Survives page refresh within the same tab
 *   - Each new list navigation automatically replaces the previous list
 */

import { useState, useEffect } from 'react'

const KEY = 'rpas_nav_list'

/** Call this in every list component before router.push(). */
export function setNavList(ids: string[]): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ids))
  } catch {
    // Ignore storage errors (private browsing, quota exceeded, etc.)
  }
}

/**
 * Read the nav list in a detail component.
 * Returns null prevId / nextId when there is no adjacent record or when
 * the page was opened directly (not via a list).
 */
export function useNavList(currentId: string): {
  prevId:   string | null
  nextId:   string | null
  position: number   // 1-based; 0 when list is unavailable
  total:    number
} {
  const [list, setList] = useState<string[]>([])

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(KEY)
      if (raw) setList(JSON.parse(raw) as string[])
    } catch { /* ignore */ }
  }, [currentId])

  const idx = list.indexOf(currentId)
  if (idx === -1) return { prevId: null, nextId: null, position: 0, total: 0 }

  return {
    prevId:   idx > 0                  ? list[idx - 1] : null,
    nextId:   idx < list.length - 1    ? list[idx + 1] : null,
    position: idx + 1,
    total:    list.length,
  }
}
