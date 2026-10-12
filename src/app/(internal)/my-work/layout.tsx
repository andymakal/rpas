import { WorkflowChrome } from '@/components/layout/WorkflowChrome'

// Light-theme workflow page: gets the persistent Mentoring header + provider.
export default function Layout({ children }: { children: React.ReactNode }) {
  return <WorkflowChrome>{children}</WorkflowChrome>
}
