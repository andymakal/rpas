'use client'

/**
 * Shared collapse state for the navy sidebar.
 *
 * The collapse control lives in Bob's light-theme header (WorkflowChrome) while
 * the sidebar it collapses lives in the shared internal layout — two different
 * points in the tree. This provider, mounted once at the root internal layout,
 * is the single source of truth they both read, so the header button and the
 * sidebar stay in sync.
 *
 * The preference persists per browser (same approach as Mentoring; there is no
 * server preference). It starts expanded so SSR and first paint agree, then
 * hydrates from localStorage on mount.
 *
 * This changes nothing for Andy's dark pages: those routes render no collapse
 * control and the sidebar only honors the collapsed state on Bob's workflow
 * routes, so the default-expanded sidebar there is byte-identical to today.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

export const SIDEBAR_COLLAPSE_STORAGE_KEY = 'rpas.workflow.sidebarCollapsed'

type SidebarCollapseValue = {
  collapsed: boolean
  setCollapsed: (next: boolean) => void
  toggle: () => void
}

const SidebarCollapseContext = createContext<SidebarCollapseValue | null>(null)

export function SidebarCollapseProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsedState] = useState(false)

  useEffect(() => {
    try {
      setCollapsedState(window.localStorage.getItem(SIDEBAR_COLLAPSE_STORAGE_KEY) === 'on')
    } catch {
      // localStorage unavailable: sidebar stays expanded.
    }
  }, [])

  const setCollapsed = (next: boolean) => {
    setCollapsedState(next)
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_STORAGE_KEY, next ? 'on' : 'off')
    } catch {
      // Non-fatal: the toggle still works for this session.
    }
  }

  return (
    <SidebarCollapseContext.Provider
      value={{ collapsed, setCollapsed, toggle: () => setCollapsed(!collapsed) }}
    >
      {children}
    </SidebarCollapseContext.Provider>
  )
}

/** Read the sidebar collapse state. Safe outside a provider (defaults to
 * expanded, no-op setters) so a stray consumer never crashes. */
export function useSidebarCollapse(): SidebarCollapseValue {
  const ctx = useContext(SidebarCollapseContext)
  if (!ctx) return { collapsed: false, setCollapsed: () => {}, toggle: () => {} }
  return ctx
}
