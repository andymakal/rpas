/**
 * Override the parent (internal) layout for the print route.
 * This strips the sidebar navigation so the page prints clean.
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
