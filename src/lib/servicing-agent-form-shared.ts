/**
 * Client-safe shared values for the Everlake/Allstate Servicing Agent Change
 * (ALL2018-4) form. This module has NO Node-only imports so it can be used from
 * both the browser (the form UI) and the server (the PDF generator).
 */

/** Maximum contract numbers the carrier form can hold on page 1 (fields 1–12). */
export const MAX_CONTRACTS = 12

/**
 * The short accompanying email the owner receives with the form. Kept here so
 * the UI and any server use share one source of truth.
 */
export function servicingAgentEmailMessage(ownerName: string): string {
  const first = ownerName.trim().split(/\s+/)[0] || 'there'
  return (
    `Hi ${first},\n\n` +
    `Attached is the Servicing Agent Change form for your Everlake (Allstate) ` +
    `life insurance/annuity contract(s). It names James Andrew Makal as your ` +
    `servicing agent so our office can help you with your contract(s).\n\n` +
    `Please review it, then sign and date the requester line near the bottom and ` +
    `send it back to us. There is nothing else you need to fill in.\n\n` +
    `Thank you,\nJames Andrew Makal\namakal@allstate.com\n(814)808-7526`
  )
}
