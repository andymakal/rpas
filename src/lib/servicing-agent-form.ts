import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import { MAX_CONTRACTS } from './servicing-agent-form-shared'

export { MAX_CONTRACTS, servicingAgentEmailMessage } from './servicing-agent-form-shared'

/**
 * Everlake / Allstate "Servicing Agent Change for Fixed Life Insurance or
 * Annuity Contracts" form (carrier form ALL2018-4, rev 09/25).
 *
 * We fill the fillable version of the ORIGINAL carrier PDF
 * (src/lib/pdf-templates/ALL2018-4-fillable.pdf) by its named AcroForm fields
 * using pdf-lib. There is no coordinate math or layout rendering here: the
 * template already carries the permanent agent block (0C4775000, James Andrew
 * Makal, amakal@allstate.com, (814)808-7526, NPN 3211211) and the checked
 * "Contract Owner" box. We only populate the contract numbers and the printed
 * requester name, then flatten so the result prints cleanly for signature.
 * Signature and date are left blank for the owner to complete by hand.
 *
 * The template's named fields (confirmed from the file):
 *   "1" … "12"  — the twelve contract-number lines
 *   "Printed name of requester Contract Owner Current Writing Agent only"
 *               — the printed requester (contract owner) name
 */

const TEMPLATE_PATH = path.join(
  process.cwd(),
  'src',
  'lib',
  'pdf-templates',
  'ALL2018-4-fillable.pdf',
)

/** The twelve contract-number fields, in order. */
const CONTRACT_FIELD_NAMES = Array.from({ length: 12 }, (_, i) => String(i + 1))

/** The printed-requester-name field (verbatim name as authored in the template). */
const REQUESTER_NAME_FIELD =
  'Printed name of requester Contract Owner Current Writing Agent only'

/**
 * The agency's return address, shown on the postal cover page and used as the
 * return/mail-back address when the form is sent by mail. The permanent
 * servicing-agent identity (James Andrew Makal) is baked into the carrier form
 * template itself; this is just the office mailing address for the cover sheet.
 */
export const AGENCY_RETURN_ADDRESS = {
  name: 'James Andrew Makal',
  line1: 'Makal Financial Services',
  phone: '(814) 808-7526',
  email: 'amakal@allstate.com',
} as const

export type PostalAddress = {
  /** Addressee name (usually the contract owner). */
  name: string
  line1: string | null
  line2?: string | null
  city: string | null
  state: string | null
  zip: string | null
}

export type ServicingAgentFormInput = {
  /** Contract owner's full name, written to the printed-requester field. */
  ownerName: string
  /** Contract (policy) numbers; up to MAX_CONTRACTS are placed in fields 1–12. */
  contractNumbers: string[]
  /**
   * When present, a postal cover page addressed to this mailing address is
   * prepended to the filled form so the whole packet can be printed and mailed.
   * Omit for the email path (form only, no cover page).
   */
  postalTo?: PostalAddress | null
}

/** Format a mailing address into display lines, dropping blanks. */
function addressLines(a: PostalAddress): string[] {
  const cityStateZip = [a.city, a.state].filter(Boolean).join(', ')
  const lastLine = [cityStateZip, a.zip].filter(Boolean).join(' ')
  return [a.name, a.line1 ?? '', a.line2 ?? '', lastLine].filter(l => l && l.trim())
}

/**
 * Build a single-page postal cover letter: the agency return address, today's
 * date, the customer's mailing address, and a short instruction to sign and
 * mail the attached form back. Drawn with pdf-lib's standard font (no external
 * assets). This is the postal counterpart to the email body.
 */
async function buildPostalCoverPage(
  doc: PDFDocument,
  to: PostalAddress,
): Promise<void> {
  const page = doc.insertPage(0, [612, 792]) // US Letter, cover first
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.12, 0.16)
  const left = 72
  let y = 720

  const line = (text: string, f = font, size = 11, gap = 16) => {
    page.drawText(text, { x: left, y, size, font: f, color: ink })
    y -= gap
  }

  // Return address block.
  line(AGENCY_RETURN_ADDRESS.name, bold)
  line(AGENCY_RETURN_ADDRESS.line1)
  line(`${AGENCY_RETURN_ADDRESS.phone}  ·  ${AGENCY_RETURN_ADDRESS.email}`)
  y -= 18

  // Date.
  const today = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
  line(today)
  y -= 10

  // Recipient address block.
  for (const l of addressLines(to)) line(l)
  y -= 20

  // Salutation + body.
  const first = to.name.trim().split(/\s+/)[0] || 'there'
  line(`Dear ${first},`)
  y -= 6
  const body = [
    'Enclosed is a Servicing Agent Change form for your Everlake (formerly Allstate)',
    'life insurance or annuity contract(s). It names James Andrew Makal as your',
    'servicing agent so our office can continue to help you with your contract(s).',
    '',
    'Signing this form does not change your policy or coverage. It simply allows us',
    'to access your policy information and assist you when needed.',
    '',
    'Please sign and date the requester line near the bottom of the enclosed form,',
    'then return it to us in the enclosed envelope or by mail to the address above.',
    'If you have additional contracts, there is space on the form to include them.',
    '',
    'Thank you,',
  ]
  for (const l of body) line(l || ' ', font, 11, 16)
  y -= 4
  line(AGENCY_RETURN_ADDRESS.name, bold)
}

export async function buildServicingAgentChangePdf(
  input: ServicingAgentFormInput,
): Promise<Uint8Array> {
  const ownerName = input.ownerName.trim()
  const contracts = input.contractNumbers
    .map(c => c.trim())
    .filter(Boolean)
    .slice(0, MAX_CONTRACTS)

  const templateBytes = await readFile(TEMPLATE_PATH)
  const doc = await PDFDocument.load(templateBytes)
  const form = doc.getForm()

  // Contract numbers → fields "1".."12"; unused fields stay blank.
  CONTRACT_FIELD_NAMES.forEach((name, i) => {
    const value = contracts[i] ?? ''
    if (value) form.getTextField(name).setText(value)
  })

  // Printed name of requester (contract owner).
  if (ownerName) {
    form.getTextField(REQUESTER_NAME_FIELD).setText(ownerName)
  }

  // Flatten so the filled values are baked in and the PDF prints consistently
  // for the owner to sign. The agent block and the checked Contract Owner box
  // are already part of the template.
  form.flatten()

  // Postal path: prepend a cover letter addressed to the customer so the whole
  // packet can be printed and mailed. The email path omits this (form only).
  if (input.postalTo) {
    await buildPostalCoverPage(doc, input.postalTo)
  }

  return doc.save()
}
