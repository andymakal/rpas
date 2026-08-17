/**
 * Fire-and-forget email touch log.
 * Call from any "Open in Outlook" onClick — Outlook opens immediately
 * while the touch posts in the background.
 */
export function logEmailTouch(caseId: string): void {
  fetch(`/api/cases/${caseId}/touch`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ touch_type: 'email' }),
  }).catch(() => { /* non-fatal */ })
}
