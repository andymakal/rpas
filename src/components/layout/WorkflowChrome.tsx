import { MentoringProvider } from '@/lib/mentoring/MentoringProvider'

/**
 * Light-theme workflow chrome for Bob's operator-facing pages ONLY.
 *
 * It provides the MentoringProvider that backs the Mentoring toggle, scoped to
 * the light-theme workflow routes (My Work, My Projects, Projects, Stewardship,
 * Today's Focus) so it never bleeds onto Andy's existing dark screens.
 *
 * The shared top header was removed to reclaim vertical space. The Mentoring
 * toggle it used to carry now lives on the right side of each page's shared
 * title: the shared WorkflowHeader renders it by default, and QueueListHeader
 * (an opened queue list's title) carries it too. Sign Out stays in the sidebar,
 * and the sidebar-collapse control is gone (sidebar navigation is unchanged).
 * The sidebar collapse state is still owned by SidebarCollapseProvider in the
 * shared internal layout, which sits above this.
 */
export function WorkflowChrome({ children }: { children: React.ReactNode }) {
  return (
    <MentoringProvider>
      {/* Fill the shared <main> scroll container as a flex column so the page
          can own the full remaining height. With the top header removed, the
          page fills everything via flex-1 + min-h-0. A page that opts into
          WorkflowPage's heading slot pins its own heading band and scrolls only
          its work area; a page that does not simply fills and scrolls normally.
          h-full resolves because <main> has a definite height (a flex child of
          the fixed inset:0 shell). */}
      <div className="flex h-full min-h-0 flex-col">
        <div className="min-h-0 flex-1">{children}</div>
      </div>
    </MentoringProvider>
  )
}
