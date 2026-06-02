'use client'

import Link from 'next/link'
import { FileText, Briefcase, Wrench, ClipboardList, Clock } from 'lucide-react'
import { useRecentItems, fmtRecent, type RecentItemType } from '@/lib/recent-items'

const TYPE_ICON: Record<RecentItemType, React.ReactNode> = {
  referral: <FileText    className="w-3.5 h-3.5" />,
  case:     <Briefcase   className="w-3.5 h-3.5" />,
  service:  <Wrench      className="w-3.5 h-3.5" />,
  review:   <ClipboardList className="w-3.5 h-3.5" />,
}

const TYPE_COLOR: Record<RecentItemType, string> = {
  referral: 'text-blue-400   bg-blue-900/40',
  case:     'text-indigo-400 bg-indigo-900/40',
  service:  'text-amber-400  bg-amber-900/40',
  review:   'text-emerald-400 bg-emerald-900/40',
}

export function RecentlyViewed() {
  const items = useRecentItems()

  if (items.length === 0) return null

  return (
    <div>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-3.5 h-3.5 text-slate-500" />
        <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
          Recently Viewed
        </h2>
      </div>

      <div className="space-y-1.5">
        {items.map(item => (
          <Link
            key={`${item.type}-${item.id}`}
            href={item.href}
            className="flex items-center gap-3 bg-slate-800 rounded-xl px-4 py-3 hover:bg-slate-700 transition-colors group"
          >
            {/* Type badge */}
            <span className={`inline-flex items-center justify-center rounded p-1 shrink-0 ${TYPE_COLOR[item.type]}`}>
              {TYPE_ICON[item.type]}
            </span>

            {/* Labels */}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-white truncate group-hover:text-white">
                {item.label}
              </p>
              <p className="text-xs text-slate-500 truncate">{item.sublabel}</p>
            </div>

            {/* Time */}
            <span className="text-xs text-slate-600 shrink-0 group-hover:text-slate-500 transition-colors">
              {fmtRecent(item.visitedAt)}
            </span>
          </Link>
        ))}
      </div>
    </div>
  )
}
