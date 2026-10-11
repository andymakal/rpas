'use client'

/**
 * Right Path actor-timezone synchronizer.
 *
 * Adapted from IPF (ipf-stewardship: src/components/actor-timezone-sync.tsx).
 * Captures the signed-in employee's browser/device IANA timezone and keeps it
 * in a cookie so server-rendered, timezone-sensitive content receives the
 * CURRENT actor timezone. This is the detection mechanism that lets Andy
 * (Eastern) and Bob/Angie (Central) each see their own clock, with no hardcoded
 * or server zone.
 *
 * On mount it reads Intl.DateTimeFormat().resolvedOptions().timeZone. When that
 * differs from the stored cookie value, it updates the cookie and refreshes the
 * current route once so the server re-renders with the current actor zone. When
 * the stored value already matches, it does nothing (no refresh loop).
 *
 * Renders nothing.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ACTOR_TIME_ZONE_COOKIE } from './actor-timezone-cookie'

// One year. The actor zone is re-detected on every mount, so this is only a
// persistence floor between requests, not a fixed expiry of the value.
const COOKIE_MAX_AGE = 60 * 60 * 24 * 365

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null
  const prefix = `${name}=`
  for (const part of document.cookie.split('; ')) {
    if (part.startsWith(prefix)) {
      return decodeURIComponent(part.slice(prefix.length))
    }
  }
  return null
}

export function ActorTimeZoneSync() {
  const router = useRouter()

  useEffect(() => {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!detected) return

    const stored = readCookie(ACTOR_TIME_ZONE_COOKIE)
    if (stored === detected) return

    document.cookie = `${ACTOR_TIME_ZONE_COOKIE}=${encodeURIComponent(detected)}; path=/; max-age=${COOKIE_MAX_AGE}; samesite=lax`
    // Refresh once so server components re-read the cookie and render
    // timezone-sensitive content on the current actor clock.
    router.refresh()
  }, [router])

  return null
}
