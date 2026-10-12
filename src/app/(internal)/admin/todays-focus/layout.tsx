import { WorkflowChrome } from '@/components/layout/WorkflowChrome'

// Light-theme workflow page: gets the persistent Mentoring header + provider.
// Scoped to todays-focus only; the other admin pages keep the dark layout.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <WorkflowChrome>{children}</WorkflowChrome>
}
