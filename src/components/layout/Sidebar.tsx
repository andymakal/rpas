'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  LayoutDashboard,
  GitMerge,
  Building2,
  FolderKanban,
  CalendarDays,
  Upload,
  Settings,
  LogOut,
  Plus,
} from 'lucide-react'

const navItems = [
  { href: '/dashboard',       icon: LayoutDashboard, label: 'Dashboard'   },
  { href: '/referrals',       icon: GitMerge,        label: 'Referrals'   },
  { href: '/agencies',        icon: Building2,       label: 'Agencies'    },
  { href: '/cases',           icon: FolderKanban,    label: 'Cases'       },
  { href: '/production',      icon: CalendarDays,    label: 'Production'  },
  { href: '/admin/gdc-import', icon: Upload,         label: 'GDC Import'  },
  { href: '/settings',        icon: Settings,        label: 'Settings'    },
]

export function Sidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()

  async function handleSignOut() {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  return (
    <aside className="w-56 flex flex-col shrink-0 border-r border-slate-800 bg-slate-900">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-800">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
          style={{ backgroundColor: '#1F3864' }}
        >
          <span className="text-white text-xs font-bold">RP</span>
        </div>
        <div>
          <p className="text-white text-sm font-semibold leading-tight">Right Path</p>
          <p className="text-slate-500 text-xs leading-tight">Agency System</p>
        </div>
      </div>

      {/* Log Referral CTA */}
      <div className="px-3 pt-3 pb-2">
        <Link
          href="/referrals/new"
          className="flex items-center justify-center gap-2 w-full rounded-lg py-2 text-sm font-medium text-white transition-opacity hover:opacity-90"
          style={{ backgroundColor: '#1F3864' }}
        >
          <Plus className="w-4 h-4" />
          Log Referral
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-2 space-y-0.5">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active =
            pathname === href ||
            (href !== '/dashboard' && pathname.startsWith(href + '/'))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-slate-800 text-white font-medium'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 py-3 border-t border-slate-800">
        <p className="px-3 pb-1.5 text-xs text-slate-600 truncate">{userEmail}</p>
        <button
          onClick={handleSignOut}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
