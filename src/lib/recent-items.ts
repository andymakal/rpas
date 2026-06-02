/**
 * Recently Viewed — client-side visit tracking via localStorage.
 *
 * Each detail page registers itself on mount. The Dashboard (and any
 * other page) can read the list to show a "Recently Viewed" section.
 * Stored per-device; survives page refreshes but not a browser cache clear.
 */

import { useState, useEffect } from 'react'

export type RecentItemType = 'referral' | 'case' | 'service' | 'review'

export type RecentItem = {
  id:        string
  type:      RecentItemType
  label:     string   // primary name  e.g. "John & Jane Smith"
  sublabel:  string   // secondary     e.g. "Active Referral" | "SR-2026-001"
  href:      string
  visitedAt: number   // Date.now()
}

const KEY = 'rpas_recently_viewed'
const MAX = 12

/** Register a page visit. Call from a useEffect([]) in each detail client. */
export function addRecentItem(item: Omit<RecentItem, 'visitedAt'>): void {
  try {
    const current = getRecentItems()
    // Remove any existing entry for this id so it re-surfaces at the top
    const deduped  = current.filter(r => r.id !== item.id)
    const updated  = [{ ...item, visitedAt: Date.now() }, ...deduped].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(updated))
  } catch { /* ignore quota / private-browsing errors */ }
}

/** Read the list synchronously (safe to call only in browser context). */
export function getRecentItems(): RecentItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as RecentItem[]) : []
  } catch {
    return []
  }
}

/** React hook — returns items after hydration so SSR stays safe. */
export function useRecentItems(): RecentItem[] {
  const [items, setItems] = useState<RecentItem[]>([])

  useEffect(() => {
    setItems(getRecentItems())
  }, [])

  return items
}

/** Human-readable elapsed time label ("just now", "5m", "2h", "Mon"). */
export function fmtRecent(visitedAt: number): string {
  const sec = Math.floor((Date.now() - visitedAt) / 1000)
  if (sec <   60) return 'just now'
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`
  const d = Math.floor(sec / 86400)
  return d === 1 ? 'yesterday' : `${d}d ago`
}
