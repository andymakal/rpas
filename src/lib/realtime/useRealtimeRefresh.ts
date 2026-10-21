'use client'

/**
 * useRealtimeRefresh — one reusable Supabase Realtime mechanism for Right Path.
 *
 * A screen names the tables whose row changes should make it update, and this
 * hook opens a SINGLE Realtime channel subscribed to Postgres change events on
 * those tables and runs a debounced callback when any of them change. The
 * default callback is `router.refresh()`, which re-runs the server render of the
 * current route and hands the client a freshly composed server state — so counts
 * and any server-decided ordering/priority come back correct, with no
 * client-side recomputation and no polling.
 *
 * Why refresh the server render instead of patching client state:
 *   - Right Path's actionable counts, workflow ordering, and GoRules (ZEN)
 *     priority bands are all decided server-side from live reads. Recomputing
 *     them on the client would duplicate that logic and risk desync. A
 *     `router.refresh()` keeps the client component mounted (so local state such
 *     as filters and open panels survives) while replacing the server props with
 *     a correct, freshly composed state.
 *
 * Security / scope:
 *   - The browser subscription runs under the signed-in user's session (anon key
 *     + JWT), so Realtime events are filtered by each table's RLS SELECT policy.
 *     A screen only receives events for rows the viewer may already read. Enable
 *     Realtime only on tables whose session can read them (see the
 *     my_work_realtime migration).
 *
 * Reuse: this hook is screen-agnostic. Any client component can call it with the
 * tables that feed it. It is the single Realtime entry point other Right Path
 * screens should use.
 */

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js'

export interface RealtimeTableSpec {
  /** Table name, e.g. 'stewardship_outreach'. */
  table: string
  /** Schema; defaults to 'public'. */
  schema?: string
  /**
   * Which change events to listen for. Defaults to all ('*' = INSERT, UPDATE,
   * DELETE), which is the right default for a count/priority surface where any
   * change can matter.
   */
  event?: 'INSERT' | 'UPDATE' | 'DELETE' | '*'
  /**
   * An optional server-side row filter, e.g. `project_id=eq.<uuid>`. Omit to
   * receive every (RLS-permitted) change on the table.
   */
  filter?: string
}

export interface UseRealtimeRefreshOptions {
  /**
   * A stable channel name. Give each distinct subscription on a page a distinct
   * name so multiple hooks (or tabs) do not collide.
   */
  channelName: string
  /** The tables whose changes should trigger the callback. */
  tables: RealtimeTableSpec[]
  /**
   * What to do when a relevant change arrives. Defaults to `router.refresh()`.
   * Receives the change payload for callers that want to react more precisely.
   */
  onChange?: (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => void
  /**
   * Debounce window in ms. Bursts of events (e.g. a claim that writes several
   * rows, or two employees acting at once) collapse into one refresh. Defaults
   * to 400ms: well under the "within seconds" target while avoiding a refresh
   * per event and the flicker that would cause.
   */
  debounceMs?: number
  /** Set false to disable the subscription (e.g. the screen has no profile). */
  enabled?: boolean
}

/**
 * Subscribe to Realtime changes for the given tables and run a debounced
 * callback (default: refresh the current route's server render) when any change
 * arrives. Returns nothing; it manages its own subscription lifecycle.
 */
export function useRealtimeRefresh({
  channelName,
  tables,
  onChange,
  debounceMs = 400,
  enabled = true,
}: UseRealtimeRefreshOptions): void {
  const router = useRouter()

  // Keep the latest callback without re-subscribing when only the callback
  // identity changes (the default router.refresh closure is recreated often).
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  // A stable key for the table set so the effect re-subscribes only when the
  // actual tables/filters change, not on every render.
  const tablesKey = JSON.stringify(tables)

  useEffect(() => {
    if (!enabled) return

    const specs: RealtimeTableSpec[] = JSON.parse(tablesKey)
    const supabase = createClient()
    const channel = supabase.channel(channelName)

    let timer: ReturnType<typeof setTimeout> | null = null
    const fire = (
      payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
    ) => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        const cb = onChangeRef.current
        if (cb) cb(payload)
        else router.refresh()
      }, debounceMs)
    }

    for (const spec of specs) {
      channel.on(
        // The supabase-js types model postgres_changes as a distinct overload;
        // the config object is passed through to the Realtime server as-is.
        'postgres_changes' as 'system',
        {
          event: spec.event ?? '*',
          schema: spec.schema ?? 'public',
          table: spec.table,
          ...(spec.filter ? { filter: spec.filter } : {}),
        } as Record<string, unknown>,
        (payload: unknown) =>
          fire(payload as RealtimePostgresChangesPayload<Record<string, unknown>>),
      )
    }

    channel.subscribe()

    return () => {
      if (timer) clearTimeout(timer)
      supabase.removeChannel(channel)
    }
    // router is stable across renders in the app router; debounceMs/channelName
    // are primitives; tablesKey captures the table set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, channelName, tablesKey, debounceMs])
}
