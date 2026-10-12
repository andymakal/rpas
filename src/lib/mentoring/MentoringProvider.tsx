'use client'

/**
 * Mentoring context — the app-wide on/off for IPF-style coaching.
 *
 * Mentoring is a thin, separate layer from the Assistant (IPF doctrine): the
 * teal Assistant explains WHAT to do; the purple Mentor explains HOW. This
 * provider holds the single source of truth for whether Mentoring is on, so the
 * persistent toggle in the shared chrome (Sidebar) and the contextual coaching
 * notes rendered inside pages stay in sync. Turning it off removes all guidance
 * and changes nothing about the Assistant, counts, or workflow.
 *
 * The preference persists per browser (no server preference exists). It starts
 * off so SSR and first paint agree, then hydrates from localStorage on mount.
 * The storage key is unchanged from the original My Work implementation so an
 * existing preference carries over.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export const MENTORING_STORAGE_KEY = 'rpas.myWork.mentoring'

type MentoringContextValue = {
  mentoring: boolean
  setMentoring: (on: boolean) => void
}

const MentoringContext = createContext<MentoringContextValue | null>(null)

export function MentoringProvider({ children }: { children: ReactNode }) {
  const [mentoring, setMentoringState] = useState(false)

  useEffect(() => {
    try {
      setMentoringState(window.localStorage.getItem(MENTORING_STORAGE_KEY) === 'on')
    } catch {
      // localStorage unavailable (private mode / blocked): Mentoring stays off.
    }
  }, [])

  const setMentoring = (next: boolean) => {
    setMentoringState(next)
    try {
      window.localStorage.setItem(MENTORING_STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      // Non-fatal: the toggle still works for this session.
    }
  }

  return (
    <MentoringContext.Provider value={{ mentoring, setMentoring }}>
      {children}
    </MentoringContext.Provider>
  )
}

/** Read the Mentoring on/off state. Safe outside a provider (defaults to off,
 * no-op setter) so a stray consumer never crashes. */
export function useMentoring(): MentoringContextValue {
  const ctx = useContext(MentoringContext)
  if (!ctx) return { mentoring: false, setMentoring: () => {} }
  return ctx
}
