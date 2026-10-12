import { WorkflowChrome } from '@/components/layout/WorkflowChrome'

// Light-theme workflow pages (Projects board, project detail, 1035 Review,
// Contact Review): get the persistent Mentoring header + provider.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <WorkflowChrome>{children}</WorkflowChrome>
}
