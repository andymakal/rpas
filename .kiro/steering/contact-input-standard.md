---
inclusion: always
---

# Customer-contact input standard (phone, email, name)

This is the permanent standard for how customer-contact values are normalized,
validated, stored, and displayed on Right Path. It applies to every NEW or
MODIFIED customer-contact form and the API route that saves it. It does not
require touching screens you are not already changing: do not migrate existing
data and do not refactor unrelated screens to adopt it. When you do touch a
contact field, bring it to this standard.

The single source of truth is `src/lib/contact-input.ts`. Use it rather than
re-deriving phone/email/name logic or copying a local `formatPhone`/`toTitleCase`
helper into a component.

## The utilities

Normalization (form + server), each returning a structured result
`{ status: 'empty' | 'valid' | 'invalid', value, reason }`:

- `normalizePhoneInput(raw)` — accepts pasted input with spaces, punctuation,
  a leading country code of 1, or surrounding explanatory text, and extracts
  exactly 10 US digits when the input is unambiguous. Returns the canonical
  display form as `value`. Anything that is not an unambiguous 10 US digits
  (too few, too many, extra stray digits from pasted text, an extension) is
  `invalid` with a reason. It is NEVER silently truncated or saved.
- `normalizeEmailInput(raw)` — trims and lowercases (reusing `normalizeEmail`
  from `./fmt`), rejects an obviously malformed address as `invalid`.
- `normalizeNameInput(raw)` — collapses internal whitespace and trims while
  PRESERVING intentional capitalization (so "McDonald", "DeLuca",
  "van der Berg" are kept as typed). It does not title-case.

Display:

- `formatPhoneDisplay(raw)` — the IPF phone display standard `(XXX) XXX-XXXX`.
  The one phone formatter in the app. `src/lib/format-phone.ts` re-exports it as
  `formatPhone` for historical imports; new code imports from
  `./contact-input` directly.
- `formatPhoneAsTyped(raw)` — same formatting for an editable field; call it in
  the input `onChange` so the operator always sees the standard format while
  typing.

## Rules

- Phone display is ALWAYS `(XXX) XXX-XXXX`, everywhere, including editable
  fields, served by the shared formatter. No ad-hoc or component-local phone
  formatting.
- Phone STORAGE keeps Right Path's existing convention: the normalized value in
  `(XXX) XXX-XXXX` form (a validated 10-digit US number rendered in the standard
  format). Do NOT introduce digits-only storage; the existing formatted
  convention is correct and consistent across the `phone`/`contact_phone`
  columns, and phone-based matching already compares on stripped digits. Do not
  split a column into two formats and do not run a backfill migration.
- Validation is preserved end to end. A changed contact field with content must
  be `valid` before it can be saved. The form blocks save and shows the reason;
  the API route re-runs the same normalization and returns 400 on `invalid`, so
  bad formatting cannot bypass the UI. An empty value is a valid "clear" (null).
- Email is stored trimmed and lowercased. Names are stored whitespace-collapsed
  with capitalization preserved.
- Save only what changed. Keep each form's existing save-only-changed-fields
  behavior and its workflow (e.g. Save & Next); normalization layers on top of
  it, it does not replace it.

## Reference implementation

`src/app/(internal)/projects/[id]/ContactReviewClient.tsx` (the 1035 Contact
Review form) plus its save route
`src/app/api/projects/[id]/contact-review/[customerId]/route.ts` are the
reference application of this standard: normalize-on-blur, inline validity
message, save blocked on an invalid changed field, server-side enforcement, and
phone shown via the shared formatter.
