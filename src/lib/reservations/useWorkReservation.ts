'use client'

/**
 * useWorkReservation — the client half of the shared reservation primitive.
 *
 * A single hook both shared-activity screens use (Send Introductory Emails and
 * Contact Research) so the reservation behavior is identical and lives in one
 * place. It owns exactly four jobs and NOTHING about the activity's own work:
 *
 *   1. reserveNext(candidateIds) — ask the server for the next AVAILABLE subject
 *      from an ordered candidate list, atomically skipping any a teammate holds.
 *      Used both on open (land on the first free subject) and on Save & Next
 *      (advance to the next free subject) with no employee action.
 *   2. Heartbeat the currently held subject on an interval while the screen is
 *      mounted, so a live worker's lease never lapses mid-task.
 *   3. release() — drop the held reservation on completion, skip, or a normal
 *      leave (unmount), so the subject frees immediately for a teammate.
 *   4. A best-effort release on tab close / navigation via sendBeacon, so a
 *      closed browser frees the subject promptly. Even if the beacon never
 *      arrives (hard crash, lost connectivity), the server-side TTL guarantees
 *      the subject frees on its own — the reservation can never become permanent.
 *
 * It holds no business state and makes no business decision; it is pure
 * coordination layered on top of the activity's existing session logic.
 */

import { useCallback, useEffect, useRef } from 'react'
import type {
  ReservationActivityKey,
  ReservationSubjectType,
} from './work-reservations'

/** Heartbeat cadence. Comfortably under the server TTL (180s) so a live worker
 * renews two to three times per lease window; a worker who stops (closed tab,
 * lost connectivity) lapses within one window. */
const HEARTBEAT_MS = 60_000

export function useWorkReservation(opts: {
  activity: ReservationActivityKey
  subjectType: ReservationSubjectType
}) {
  const { activity, subjectType } = opts

  // The subject this client currently holds, if any. A ref (not state) because
  // the heartbeat interval and the unload handler must read the latest value
  // without re-subscribing, and holding it never needs to trigger a render.
  const heldRef = useRef<string | null>(null)

  /** POST to the reservations endpoint. On a transport or HTTP failure (network
   * error, 4xx/5xx) it THROWS, so the caller can distinguish a real failure
   * from a successful "nothing available" response. A successful 2xx returns
   * the response `data` (which may legitimately be null-ish fields). The
   * heartbeat and unload paths pass `swallow: true` to keep best-effort
   * renew/release calls from throwing into an interval or an unload handler. */
  const post = useCallback(
    async (
      payload: Record<string, unknown>,
      opts?: { swallow?: boolean },
    ): Promise<unknown> => {
      try {
        const res = await fetch('/api/reservations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ activity, subject_type: subjectType, ...payload }),
          cache: 'no-store',
        })
        if (!res.ok) {
          if (opts?.swallow) return null
          const err = await res.json().catch(() => null)
          throw new Error(err?.error ?? `Reservation request failed (${res.status})`)
        }
        const json = await res.json().catch(() => null)
        return json?.data ?? null
      } catch (e) {
        if (opts?.swallow) return null
        throw e instanceof Error ? e : new Error('Reservation request failed')
      }
    },
    [activity, subjectType],
  )

  /** Reserve the next available subject from an ordered candidate list. Returns
   * the reserved subject id, or null when every candidate is currently taken
   * (a successful, empty result). THROWS on a reservation/transport failure so
   * the caller can surface an error instead of mistaking a failure for an empty
   * population. Updates the held subject so the heartbeat tracks it. */
  const reserveNext = useCallback(
    async (candidateIds: string[]): Promise<string | null> => {
      const data = (await post({ action: 'next', candidate_ids: candidateIds })) as
        | { subject_id: string | null }
        | null
      const next = data?.subject_id ?? null
      heldRef.current = next
      return next
    },
    [post],
  )

  /** Reserve ONE specific subject (a deliberate open — a list card click or a
   * deep-link reopen). Returns whether the caller now holds it. Either way the
   * caller decides whether to open it; a deliberate reopen is never blocked by
   * the coordination layer, but holding the lease still tracks the worker and
   * frees it on leave. Updates the held subject so the heartbeat tracks it. */
  const reserveOne = useCallback(
    async (subjectId: string): Promise<boolean> => {
      // A deliberate reopen opens the subject regardless of the lease outcome,
      // so a reservation failure here must not throw: swallow and report "not
      // mine" (false). The caller opens either way; the TTL reclaims any stale
      // lease.
      const data = (await post(
        { action: 'reserve', subject_id: subjectId },
        { swallow: true },
      )) as { mine: boolean; subject_id: string | null } | null
      const mine = !!data?.mine
      if (mine) heldRef.current = subjectId
      return mine
    },
    [post],
  )

  /** Release the currently held subject (completion, skip, or deliberate leave).
   * Safe to call when nothing is held. */
  const release = useCallback(async (): Promise<void> => {
    const held = heldRef.current
    if (!held) return
    heldRef.current = null
    // Best-effort: a failed release is reclaimed by the TTL, so never throw.
    await post({ action: 'release', subject_id: held }, { swallow: true })
  }, [post])

  // Heartbeat the held subject while the screen is mounted.
  useEffect(() => {
    const t = setInterval(() => {
      const held = heldRef.current
      if (!held) return
      // Best-effort renew: a missed heartbeat only risks TTL lapse, never throw.
      void post({ action: 'heartbeat', subject_id: held }, { swallow: true })
    }, HEARTBEAT_MS)
    return () => clearInterval(t)
  }, [post])

  // Best-effort release on tab close / navigation away. sendBeacon survives an
  // unload the way a normal fetch cannot. The server TTL is the real guarantee;
  // this just frees the subject promptly in the common close case.
  useEffect(() => {
    const onHide = () => {
      const held = heldRef.current
      if (!held) return
      const payload = JSON.stringify({
        activity,
        subject_type: subjectType,
        action: 'release',
        subject_id: held,
      })
      try {
        navigator.sendBeacon(
          '/api/reservations',
          new Blob([payload], { type: 'application/json' }),
        )
      } catch {
        // Ignore: the TTL will reclaim the subject if the beacon fails.
      }
    }
    // pagehide covers tab close, navigation, and bfcache on all modern browsers.
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      // Normal unmount (leaving the screen in-app) releases explicitly.
      void release()
    }
  }, [activity, subjectType, release])

  return { reserveNext, reserveOne, release, heldRef }
}
