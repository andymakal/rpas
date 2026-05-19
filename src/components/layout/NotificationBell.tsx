'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { Bell, CheckCheck, GitMerge } from 'lucide-react'

type Notification = {
  id: string
  type: string
  title: string
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

function fmtAge(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export function NotificationBell() {
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [open, setOpen]                   = useState(false)
  const [loading, setLoading]             = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter(n => !n.read_at).length

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications')
      if (res.ok) {
        const { data } = await res.json()
        setNotifications(data ?? [])
      }
    } catch { /* silent */ }
  }, [])

  // Initial fetch + poll every 30 s
  useEffect(() => {
    fetchNotifications()
    const id = setInterval(fetchNotifications, 30_000)
    return () => clearInterval(id)
  }, [fetchNotifications])

  // Close on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  async function markRead(id: string) {
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' })
    setNotifications(prev =>
      prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n)
    )
  }

  async function markAllRead() {
    setLoading(true)
    await fetch('/api/notifications/mark-all-read', { method: 'POST' })
    setNotifications(prev =>
      prev.map(n => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))
    )
    setLoading(false)
  }

  return (
    <div ref={panelRef} className="relative">
      {/* Bell button */}
      <button
        onClick={() => setOpen(o => !o)}
        className="relative flex items-center justify-center w-7 h-7 rounded-md text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
        aria-label="Notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[14px] h-[14px] rounded-full bg-red-500 text-white text-[9px] font-bold px-0.5 leading-none">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute left-0 top-9 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl shadow-black/50 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <span className="text-xs font-semibold text-slate-300 uppercase tracking-wide">
              Notifications
            </span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                disabled={loading}
                className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                Mark all read
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-96 overflow-y-auto divide-y divide-slate-800/60">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-600">
                No notifications yet
              </div>
            ) : (
              notifications.map(n => {
                const isUnread = !n.read_at
                const inner = (
                  <div
                    className={`px-4 py-3 flex items-start gap-3 transition-colors ${
                      isUnread
                        ? 'bg-slate-800/40 hover:bg-slate-800/60'
                        : 'hover:bg-slate-800/30'
                    }`}
                    onClick={() => { if (isUnread) markRead(n.id) }}
                  >
                    <div className={`mt-0.5 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                      isUnread ? 'bg-blue-900/60' : 'bg-slate-800'
                    }`}>
                      <GitMerge className={`w-3 h-3 ${isUnread ? 'text-blue-400' : 'text-slate-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm leading-snug ${isUnread ? 'text-slate-100 font-medium' : 'text-slate-400'}`}>
                        {n.title}
                      </p>
                      {n.body && (
                        <p className="text-xs text-slate-500 mt-0.5 truncate">{n.body}</p>
                      )}
                      <p className="text-xs text-slate-600 mt-1">{fmtAge(n.created_at)}</p>
                    </div>
                    {isUnread && (
                      <span className="mt-1.5 flex-shrink-0 w-2 h-2 rounded-full bg-blue-500" />
                    )}
                  </div>
                )

                return n.link ? (
                  <Link key={n.id} href={n.link} onClick={() => { setOpen(false); if (isUnread) markRead(n.id) }}>
                    {inner}
                  </Link>
                ) : (
                  <div key={n.id} className="cursor-default">{inner}</div>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
