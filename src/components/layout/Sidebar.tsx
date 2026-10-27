'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSidebarCollapse } from '@/components/layout/SidebarCollapseProvider'
import { isWorkflowRoute } from '@/components/layout/workflow-routes'
import { useSignOut } from '@/components/layout/use-sign-out'
import {
  LayoutDashboard,
  GitMerge,
  Building2,
  FolderKanban,
  TrendingUp,
  Upload,
  Users,
  Settings,
  Package,
  ClipboardList,
  LogOut,
  Plus,
  DollarSign,
  KeyRound,
  Inbox,
  Wrench,
  ClipboardCheck,
  FileSpreadsheet,
  Shield,
  BookOpen,
  BarChart2,
  LayoutList,
  FolderGit2,
  ListTodo,
  Sparkles,
  FileText,
} from 'lucide-react'
import { NotificationBell } from '@/components/layout/NotificationBell'

const navItems = [
  { href: '/dashboard',              icon: LayoutDashboard, label: 'Dashboard'        },
  { href: '/my-work',                icon: ListTodo,        label: 'My Work'          },
  { href: '/my-projects',            icon: FolderGit2,      label: 'My Projects'      },
  { href: '/triage',                 icon: Inbox,           label: 'Triage'           },
  { href: '/referrals',              icon: GitMerge,        label: 'Referrals'        },
  { href: '/spiff',                  icon: DollarSign,      label: 'SPIFF'            },
  { href: '/agencies',               icon: Building2,       label: 'Agencies'         },
  { href: '/cases',                  icon: FolderKanban,    label: 'Cases'            },
  { href: '/production',             icon: TrendingUp,      label: 'Production'       },
  { href: '/service',                icon: Wrench,          label: 'Service'          },
  { href: '/policies',               icon: BookOpen,        label: 'Policies'         },
  { href: '/reviews',                icon: ClipboardCheck,  label: 'Reviews'          },
  { href: '/forms',                  icon: FileText,        label: 'Forms'            },
  { href: '/financial-review',       icon: BarChart2,       label: 'Financial Review' },
  { href: '/projects',               icon: FolderGit2,      label: 'Projects'         },
  { href: '/customers',               icon: Users,           label: 'Customers'        },
  { href: '/team',                   icon: Users,           label: 'Team'             },
  { href: '/admin/todays-focus',      icon: Sparkles,        label: "Today's Focus"    },
  { href: '/admin/scorecard',         icon: LayoutList,      label: 'Scorecard'        },
  { href: '/admin/gdc-import',       icon: Upload,          label: 'GDC Import'       },
  { href: '/admin/policy-import',    icon: FileSpreadsheet, label: 'Policy Import'    },
  { href: '/admin/book-import',      icon: BookOpen,        label: 'Book Import'      },
  { href: '/admin/lead-import',      icon: Users,           label: 'Lead Import'      },
  { href: '/admin/pending-import',   icon: ClipboardList,   label: 'Pending Import'   },
  { href: '/settings/products',      icon: Package,         label: 'Products'         },
  { href: '/settings',               icon: Settings,        label: 'Settings'         },
]

export function Sidebar({ userEmail }: { userEmail: string }) {
  const pathname = usePathname()
  const handleSignOut = useSignOut()
  const { collapsed } = useSidebarCollapse()

  // Collapse is a Bob-only workflow affordance. On Andy's dark routes the
  // sidebar always renders expanded exactly as before, regardless of the stored
  // preference, so those pages are unchanged.
  const isCollapsed = collapsed && isWorkflowRoute(pathname)

  return (
    <aside
      style={{ width: isCollapsed ? '4rem' : '14rem', flexShrink: 0, display: 'flex', flexDirection: 'column', height: '100%' }}
      className="border-r border-slate-800 bg-slate-900 transition-[width] duration-200"
    >
      {/* Logo */}
      <div className={cn('flex items-center border-b border-slate-800 px-4 py-4', isCollapsed ? 'justify-center' : 'justify-between')}>
        <div className="flex items-center gap-3">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
            style={{ backgroundColor: '#1F3864' }}
          >
            <span className="text-white text-xs font-bold">RP</span>
          </div>
          {!isCollapsed && (
            <div>
              <p className="text-white text-sm font-semibold leading-tight">Right Path</p>
              <p className="text-slate-500 text-xs leading-tight">Agency System</p>
            </div>
          )}
        </div>
        {!isCollapsed && <NotificationBell />}
      </div>

      {/* Log Referral CTA */}
      <div className={cn('pt-3 pb-2', isCollapsed ? 'px-2' : 'px-3')}>
        <Link
          href="/referrals/new"
          title={isCollapsed ? 'Log Referral' : undefined}
          className={cn(
            'flex items-center justify-center gap-2 w-full rounded-lg py-2 text-sm font-medium text-white transition-opacity hover:opacity-90',
          )}
          style={{ backgroundColor: '#1F3864' }}
        >
          <Plus className="w-4 h-4 shrink-0" />
          {!isCollapsed && 'Log Referral'}
        </Link>
      </div>

      {/* Nav items */}
      <nav className="flex-1 min-h-0 overflow-y-auto px-2 py-2 space-y-0.5">
        {navItems.map(({ href, icon: Icon, label }) => {
          const active =
            pathname === href ||
            (href !== '/dashboard' && pathname.startsWith(href + '/'))
          return (
            <Link
              key={href}
              href={href}
              title={isCollapsed ? label : undefined}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                isCollapsed && 'justify-center',
                active
                  ? 'bg-slate-800 text-white font-medium'
                  : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
              )}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {!isCollapsed && label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-2 py-3 border-t border-slate-800">
        {!isCollapsed && <p className="px-3 pb-1.5 text-xs text-slate-600 truncate">{userEmail}</p>}
        <Link
          href="/settings/password"
          title={isCollapsed ? 'Change Password' : undefined}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors',
            isCollapsed && 'justify-center',
          )}
        >
          <KeyRound className="w-4 h-4 shrink-0" />
          {!isCollapsed && 'Change Password'}
        </Link>
        <button
          onClick={handleSignOut}
          title={isCollapsed ? 'Sign out' : undefined}
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-slate-400 hover:bg-slate-800/60 hover:text-slate-200 transition-colors',
            isCollapsed && 'justify-center',
          )}
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {!isCollapsed && 'Sign out'}
        </button>
      </div>
    </aside>
  )
}
