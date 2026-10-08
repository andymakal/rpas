/**
 * Static fixtures for the 1035 Workflow prototype. STORYBOOK-ONLY.
 *
 * Real customers carry only their ACTUAL holdings. Anything that needs a
 * contact state, a linked spouse, or an extra holding that the real records
 * cannot show is attached to a clearly SYNTHETIC customer (names marked DEMO).
 * No fabricated holdings or relationships are ever attached to a real identity.
 */

import {
  type ContactInfo,
  type Person,
  type QueueId,
  type WorkItem,
  QUEUE_ORDER,
} from './data'

// ─────────────────────────────────────────────────────────────────────────────
// Real customers (identity + holdings verbatim from the live Cassidy book).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stephen Remy. REAL. No email on file, owner phone 610-541-6748, DOB held as
 * month + year only (06/xx/1958). Three Lincoln Benefit Life UL policies, two
 * insuring other family members. No email -> Ready to Call at intake.
 */
export const stephenRemy: WorkItem = {
  id:        '9a5f6565-93a2-4bd9-9716-37add3275a4d',
  firstName: 'Stephen',
  lastName:  'Remy',
  address:   { line1: null, city: null, state: 'PA', zip: null },
  dob:       { precision: 'month-year', year: 1958, month: 6 },
  dobStatus: 'unverified',
  contact: {
    email:         { value: null,           status: 'unverified' },
    personalPhone: { value: '610-541-6748', status: 'allstate-record' },
    workPhone:     { value: null,           status: 'unverified' },
    preferredPhone: 'personal',
  },
  communication:     { mode: 'direct' },
  requiredSignerIds: ['9a5f6565-93a2-4bd9-9716-37add3275a4d'],
  holdings: [
    {
      id: 'p-remy-60595', policyNumber: '01N1A60595',
      productType: 'Universal Life', carrier: 'Lincoln Benefit Life',
      faceAmount: 200000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Primary coverage. Owner is the insured.',
      inRequest: true,
    },
    {
      id: 'p-remy-29070', policyNumber: '01N1A29070',
      productType: 'Universal Life', carrier: 'Lincoln Benefit Life',
      faceAmount: 50000, insuredName: 'Michael Remy',
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Child policy. Low cash value.',
      inRequest: true,
    },
    {
      id: 'p-remy-32166', policyNumber: '01N1A32166',
      productType: 'Universal Life', carrier: 'Lincoln Benefit Life',
      faceAmount: 50000, insuredName: 'Kelly Remy',
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Child policy. Low cash value.',
      inRequest: true,
    },
  ],
  queue: 'ready-to-call',
  callReason: 'no-email',
}

/**
 * Rita Eburuoh. REAL identity + holdings. Email is an illustrative placeholder
 * (no email on the live record) used to exercise the email path. DOB year only.
 * Two Lincoln Benefit Life whole life policies.
 */
export const ritaEburuoh: WorkItem = {
  id:        '56609a05-ddcc-4bba-a53c-edf4f6dc1177',
  firstName: 'Rita',
  lastName:  'Eburuoh',
  address:   { line1: null, city: 'Philadelphia', state: 'PA', zip: null },
  dob:       { precision: 'year-only', year: 1965 },
  dobStatus: 'unverified',
  contact: {
    email:         { value: 'rita.eburuoh@example.com', status: 'allstate-record' },
    personalPhone: { value: '215-847-6056',             status: 'allstate-record' },
    workPhone:     { value: null,                        status: 'unverified' },
    preferredPhone: 'personal',
  },
  communication:     { mode: 'direct' },
  requiredSignerIds: ['56609a05-ddcc-4bba-a53c-edf4f6dc1177'],
  holdings: [
    {
      id: 'p-eburuoh-04430', policyNumber: '05W1E04430',
      productType: 'Whole Life', carrier: 'Lincoln Benefit Life',
      faceAmount: 25000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Owner-insured whole life.',
      inRequest: true,
    },
    {
      id: 'p-eburuoh-04431', policyNumber: '05W1E04431',
      productType: 'Whole Life', carrier: 'Lincoln Benefit Life',
      faceAmount: 15000, insuredName: 'Chidi Eburuoh',
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Family policy. Same servicing-agent form.',
      inRequest: true,
    },
  ],
  queue: 'ready-to-email',
}

/**
 * Gerald Cassidy. REAL. Single large UL policy, exact DOB on file. Email
 * placeholder present and marked customer-verified to show the email path with
 * a confirmed address.
 */
export const geraldCassidy: WorkItem = {
  id:        '2e700ebd-e9f2-4e5a-86dd-6e2509b11e01',
  firstName: 'Gerald',
  lastName:  'Cassidy',
  address:   { line1: '975 Beverly Lane', city: 'Newtown Square', state: 'PA', zip: '19073-2731' },
  dob:       { precision: 'exact', year: 1958, month: 2, day: 14 },
  dobStatus: 'allstate-record',
  contact: {
    email:         { value: 'gerald.cassidy@example.com', status: 'customer-verified' },
    personalPhone: { value: '610-358-3044',               status: 'customer-verified' },
    workPhone:     { value: null,                          status: 'unverified' },
    preferredPhone: 'personal',
  },
  communication:     { mode: 'direct' },
  requiredSignerIds: ['2e700ebd-e9f2-4e5a-86dd-6e2509b11e01'],
  holdings: [
    {
      id: 'p-cassidy-34526', policyNumber: '01N1E34526',
      productType: 'Universal Life', carrier: 'Lincoln Benefit Life',
      faceAmount: 1150000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Large face amount. Priority servicing confirmation.',
      inRequest: true,
    },
  ],
  queue: 'ready-to-email',
}

// ─────────────────────────────────────────────────────────────────────────────
// Synthetic households (names marked DEMO). Used to show scenarios the real
// records cannot: linked communication, joint signers, context holdings, and
// the various queue states.
// ─────────────────────────────────────────────────────────────────────────────

/** Jo Sample — spouse. Her OWN contact details (never copied onto Sam). */
const joSampleSpouse: Person = {
  id: 'demo-person-jo', firstName: 'Jo', lastName: 'Sample (DEMO)',
  relationship: 'Spouse',
  contact: {
    email:         { value: 'jo.sample@example.com', status: 'customer-verified' },
    personalPhone: { value: '000-000-0002',          status: 'allstate-record' },
    workPhone:     { value: '000-000-0003',          status: 'unverified' },
    preferredPhone: 'personal',
  },
}

const samSampleContact: ContactInfo = {
  email:         { value: null,           status: 'unverified' },
  personalPhone: { value: '000-000-0001', status: 'allstate-record' },
  workPhone:     { value: null,           status: 'unverified' },
  preferredPhone: 'personal',
}

/**
 * Sam Sample (DEMO) — routine communication handled by spouse Jo, but Sam is
 * the sole owner and sole required signer. Communication links to Jo (so we
 * show JO's contact); the signer requirement still points at Sam. In Ready to
 * Email because the routine-contact person (Jo) has a usable email.
 */
export const demoSpouseComm: WorkItem = {
  id:        'demo-sam-sample',
  firstName: 'Sam',
  lastName:  'Sample (DEMO)',
  address:   { line1: '000 Example Ave', city: 'Sampletown', state: 'PA', zip: '00000' },
  dob:       { precision: 'exact', year: 1969, month: 3, day: 2 },
  dobStatus: 'customer-verified',
  contact:   samSampleContact,
  relatedPeople:     [joSampleSpouse],
  communication:     { mode: 'linked', personId: 'demo-person-jo' },
  requiredSignerIds: ['demo-sam-sample'],
  holdings: [
    {
      id: 'demo-sam-h1', policyNumber: 'DEMO-2001',
      productType: 'Universal Life', carrier: 'Sample Carrier',
      faceAmount: 150000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Solely owned by Sam. Routine communication handled by spouse.',
      inRequest: true,
    },
    {
      id: 'demo-sam-h3', policyNumber: 'DEMO-2099',
      productType: 'Fixed Annuity', carrier: 'Sample Carrier',
      faceAmount: null, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Other stewarded holding, shown for relationship context.',
      inRequest: false,
    },
  ],
  queue: 'ready-to-email',
}

/**
 * Jana & Dale Oak (DEMO) — a JOINTLY owned policy requiring BOTH signatures,
 * regardless of who handles routine communication. Jana handles routine
 * contact and has a verified email; Dale has no email, so his signer row shows
 * the missing email plainly rather than borrowing Jana's.
 */
const danaOakSpouse: Person = {
  id: 'demo-person-dale', firstName: 'Dale', lastName: 'Oak (DEMO)',
  relationship: 'Spouse / co-owner',
  contact: {
    email:         { value: null,           status: 'not-found' },
    personalPhone: { value: '000-000-0021', status: 'allstate-record' },
    workPhone:     { value: null,           status: 'unverified' },
    preferredPhone: 'personal',
  },
}

export const demoJointSigners: WorkItem = {
  id:        'demo-jana-oak',
  firstName: 'Jana',
  lastName:  'Oak (DEMO)',
  address:   { line1: '12 Oak Court', city: 'Sampletown', state: 'PA', zip: '00000' },
  dob:       { precision: 'month-year', year: 1972, month: 8 },
  dobStatus: 'allstate-record',
  contact: {
    email:         { value: 'jana.oak@example.com', status: 'customer-verified' },
    personalPhone: { value: '000-000-0020',         status: 'allstate-record' },
    workPhone:     { value: null,                    status: 'unverified' },
    preferredPhone: 'personal',
  },
  relatedPeople:     [danaOakSpouse],
  communication:     { mode: 'direct' },
  requiredSignerIds: ['demo-jana-oak', 'demo-person-dale'],
  holdings: [
    {
      id: 'demo-oak-h1', policyNumber: 'DEMO-3001',
      productType: 'Whole Life', carrier: 'Sample Carrier',
      faceAmount: 300000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Jointly owned by Jana and Dale. Both must sign.',
      inRequest: true,
    },
  ],
  queue: 'waiting-for-form',
}

/**
 * Pat River (DEMO) — email was sent and we are inside the follow-up window.
 * Waiting for Response.
 */
export const demoWaitingResponse: WorkItem = {
  id:        'demo-pat-river',
  firstName: 'Pat',
  lastName:  'River (DEMO)',
  address:   { line1: '8 River Rd', city: 'Sampletown', state: 'PA', zip: '00000' },
  dob:       { precision: 'year-only', year: 1961 },
  dobStatus: 'unverified',
  contact: {
    email:         { value: 'pat.river@example.com', status: 'allstate-record' },
    personalPhone: { value: '000-000-0030',          status: 'allstate-record' },
    workPhone:     { value: null,                     status: 'unverified' },
    preferredPhone: 'personal',
  },
  communication:     { mode: 'direct' },
  requiredSignerIds: ['demo-pat-river'],
  holdings: [
    {
      id: 'demo-river-h1', policyNumber: 'DEMO-4001',
      productType: 'Universal Life', carrier: 'Sample Carrier',
      faceAmount: 75000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Initial outreach sent. Awaiting a reply.',
      inRequest: true,
    },
  ],
  queue: 'waiting-for-response',
  emailSentDate:   '2026-10-01',
  followUpDueDate: '2026-10-08',
}

/**
 * Casey Vale (DEMO) — no usable email or phone at intake. Research Needed.
 */
export const demoResearchNeeded: WorkItem = {
  id:        'demo-casey-vale',
  firstName: 'Casey',
  lastName:  'Vale (DEMO)',
  address:   { line1: null, city: 'Sampletown', state: 'PA', zip: null },
  dob:       { precision: 'year-only', year: 1955 },
  dobStatus: 'unverified',
  contact: {
    email:         { value: null, status: 'not-found' },
    personalPhone: { value: null, status: 'not-found' },
    workPhone:     { value: null, status: 'unverified' },
    preferredPhone: 'personal',
  },
  communication:     { mode: 'direct' },
  requiredSignerIds: ['demo-casey-vale'],
  holdings: [
    {
      id: 'demo-vale-h1', policyNumber: 'DEMO-5001',
      productType: 'Whole Life', carrier: 'Sample Carrier',
      faceAmount: 40000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'No usable contact information on file.',
      inRequest: true,
    },
  ],
  queue: 'research-needed',
  researchReason: 'no-contact',
}

/**
 * Morgan Birch (DEMO) — emailed outreach bounced and there is a usable phone,
 * so the item moved to Ready to Call with a bounce script.
 */
export const demoCallAfterBounce: WorkItem = {
  id:        'demo-morgan-birch',
  firstName: 'Morgan',
  lastName:  'Birch (DEMO)',
  address:   { line1: '5 Birch Way', city: 'Sampletown', state: 'PA', zip: '00000' },
  dob:       { precision: 'exact', year: 1948, month: 11, day: 30 },
  dobStatus: 'allstate-record',
  contact: {
    email:         { value: 'morgan.birch@example.com', status: 'not-found' },
    personalPhone: { value: '000-000-0040',             status: 'allstate-record' },
    workPhone:     { value: '000-000-0041',             status: 'unverified' },
    preferredPhone: 'personal',
  },
  communication:     { mode: 'direct' },
  requiredSignerIds: ['demo-morgan-birch'],
  holdings: [
    {
      id: 'demo-birch-h1', policyNumber: 'DEMO-6001',
      productType: 'Universal Life', carrier: 'Sample Carrier',
      faceAmount: 120000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Email bounced. Phone on file for a call.',
      inRequest: true,
    },
  ],
  queue: 'ready-to-call',
  callReason: 'email-bounced',
}

/**
 * Lee Stone (DEMO) — a scheduled callback is due today. Ready to Call.
 */
export const demoCallbackDue: WorkItem = {
  id:        'demo-lee-stone',
  firstName: 'Lee',
  lastName:  'Stone (DEMO)',
  address:   { line1: '19 Stone St', city: 'Sampletown', state: 'PA', zip: '00000' },
  dob:       { precision: 'month-year', year: 1963, month: 4 },
  dobStatus: 'customer-verified',
  contact: {
    email:         { value: null,           status: 'not-found' },
    personalPhone: { value: '000-000-0050', status: 'customer-verified' },
    workPhone:     { value: null,           status: 'unverified' },
    preferredPhone: 'personal',
  },
  communication:     { mode: 'direct' },
  requiredSignerIds: ['demo-lee-stone'],
  holdings: [
    {
      id: 'demo-stone-h1', policyNumber: 'DEMO-7001',
      productType: 'Whole Life', carrier: 'Sample Carrier',
      faceAmount: 60000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Customer asked us to call back.',
      inRequest: true,
    },
  ],
  queue: 'ready-to-call',
  callReason: 'callback-due',
  callbackDate: '2026-10-05',
}

/**
 * Robin Fay (DEMO) — signed form submitted to the carrier. Waiting for Carrier.
 */
export const demoWaitingCarrier: WorkItem = {
  id:        'demo-robin-fay',
  firstName: 'Robin',
  lastName:  'Fay (DEMO)',
  address:   { line1: '3 Fay Ln', city: 'Sampletown', state: 'PA', zip: '00000' },
  dob:       { precision: 'exact', year: 1952, month: 7, day: 9 },
  dobStatus: 'customer-verified',
  contact: {
    email:         { value: 'robin.fay@example.com', status: 'customer-verified' },
    personalPhone: { value: '000-000-0060',          status: 'customer-verified' },
    workPhone:     { value: null,                     status: 'unverified' },
    preferredPhone: 'personal',
  },
  communication:     { mode: 'direct' },
  requiredSignerIds: ['demo-robin-fay'],
  holdings: [
    {
      id: 'demo-fay-h1', policyNumber: 'DEMO-8001',
      productType: 'Universal Life', carrier: 'Sample Carrier',
      faceAmount: 90000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Form submitted. Awaiting carrier confirmation.',
      inRequest: true,
    },
    {
      id: 'demo-fay-h2', policyNumber: 'DEMO-8002',
      productType: 'Universal Life', carrier: 'Sample Carrier',
      faceAmount: 45000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Covered by the same submitted form.',
      inRequest: true,
    },
  ],
  queue: 'waiting-for-carrier',
  submittedDate: '2026-09-30',
}

/**
 * Sage Wells (DEMO) — carrier came back requesting a correction. Still Waiting
 * for Carrier; the correction is actionable work within the stage.
 */
export const demoCarrierCorrection: WorkItem = {
  id:        'demo-sage-wells',
  firstName: 'Sage',
  lastName:  'Wells (DEMO)',
  address:   { line1: '7 Wells Ave', city: 'Sampletown', state: 'PA', zip: '00000' },
  dob:       { precision: 'exact', year: 1950, month: 1, day: 20 },
  dobStatus: 'customer-verified',
  contact: {
    email:         { value: 'sage.wells@example.com', status: 'customer-verified' },
    personalPhone: { value: '000-000-0070',          status: 'customer-verified' },
    workPhone:     { value: null,                     status: 'unverified' },
    preferredPhone: 'personal',
  },
  communication:     { mode: 'direct' },
  requiredSignerIds: ['demo-sage-wells'],
  holdings: [
    {
      id: 'demo-wells-h1', policyNumber: 'DEMO-9001',
      productType: 'Whole Life', carrier: 'Sample Carrier',
      faceAmount: 110000, insuredName: null,
      coverageStatus: 'Active (Inforce)',
      servicingContext: 'Carrier requested a correction before confirming.',
      inRequest: true,
    },
  ],
  queue: 'waiting-for-carrier',
  submittedDate: '2026-09-25',
  carrierCorrection: 'Carrier needs the owner signature re-dated on page 2. Resubmit with the corrected date.',
}

// ─────────────────────────────────────────────────────────────────────────────
// The board — every work item in the 1035 Workflow for this session.
// ─────────────────────────────────────────────────────────────────────────────

export const allItems: WorkItem[] = [
  // Ready to Email
  ritaEburuoh,
  geraldCassidy,
  demoSpouseComm,
  // Ready to Call
  stephenRemy,
  demoCallAfterBounce,
  demoCallbackDue,
  // Research Needed
  demoResearchNeeded,
  // Waiting for Response
  demoWaitingResponse,
  // Waiting for Form
  demoJointSigners,
  // Waiting for Carrier
  demoWaitingCarrier,
  demoCarrierCorrection,
]

/** Items in a given queue, in board order. */
export function itemsInQueue(items: WorkItem[], queue: QueueId): WorkItem[] {
  return items.filter(i => i.queue === queue)
}

/** Count per queue, for the landing screen. Zero-count queues stay visible. */
export function queueCounts(items: WorkItem[]): Record<QueueId, number> {
  const counts = Object.fromEntries(QUEUE_ORDER.map(q => [q, 0])) as Record<QueueId, number>
  for (const item of items) counts[item.queue] += 1
  return counts
}
