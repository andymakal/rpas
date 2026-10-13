import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'
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

export type ServicingAgentFormInput = {
  /** Contract owner's full name, written to the printed-requester field. */
  ownerName: string
  /** Contract (policy) numbers; up to MAX_CONTRACTS are placed in fields 1–12. */
  contractNumbers: string[]
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

  return doc.save()
}
