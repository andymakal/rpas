# People We Can't Call — the no-phone outreach branch

Status: DESIGN AGREED with Bob, groundwork to build. This is a branch of step 2
(Reaching the customer) of the Servicing-Agent Capture workflow — the fork where
there is no phone to dial. It is a sibling of "Make the Calls That Are Due" under
the Outreach tile. The placeholder screen and the My Work step already ship (on
the development preview); this document is the plan for turning the placeholder
into the real working screen.

## What it is

A continuous working screen, the same shape as the other outreach screens: open
one customer, do the work, advance to the next. The population is active
outreach customers (not decided, not declined, not engaged, not past the signed
form) with NO usable phone on file. Most of them have an email; the point of the
screen is to recover a way to reach them.

Verified on the development DB for the Q4 1035 Review project (re-verify before
relying): 13 project members have no phone — 12 in `research-needed` each WITH an
email (the working population), and 1 (Vertadean Butler) with no phone, no email,
AND no mailing address. The zero-contact case is explicitly NOT this screen's job
(no channel to fall back to); she stays in Contact Research until any detail is
found. This screen is for no-phone customers who still have an email or a
mailing address.

## The flow when a customer is opened

1. RESEARCH FOR A PHONE FIRST. Show the Gateway look-up (the existing
   `GatewayLookup` Lego, last name + policy numbers) PLUS the other sources Angie
   provided (a website: enter the customer's name and address, read back a phone).
   Phone research is the first line of defense.
2. FOUND A PHONE -> fork into calling. Save the number, then open the SAME guided
   call card used by Calls Due (Reached / Didn't reach / log the attempt) RIGHT
   HERE, so the operator tries the call while on the record. On the next pass the
   customer is in the normal Calls Due queue and never appears on this screen
   again (they now have a phone). This is a deliberate branch, NOT a silent
   re-queue: you stay on the customer and try the call.
3. NO PHONE -> reach by mail. Two generate actions on the same screen (OPTION B,
   decided: send both now rather than an email cadence first — these are the
   hardest-to-reach customers and postal is slow, so get the form into their
   hands by every route at once):
   - GENERATE EMAIL + FORM: the email carries the authorization form EVERY time
     (Bob's decision). Reuses the existing form/email mechanics.
   - GENERATE LETTER + FORM: a postal package.
4. ADVANCE to the next customer. A no-phone customer with no phone ever found
   stays in this population and gets mail/email each pass; they leave only when a
   phone is found (-> calling) or the capture completes.

## Decided (business rules)

- Option B sequencing: generate email AND postal on the first pass; no
  multi-email "did they open it" cadence for now. A cadence can be added later if
  real use shows people respond to a second email. (Bob: hadn't considered the
  time frame; postal is slow, so start it immediately.)
- Every email carries the authorization form.
- Phone research is first; finding a phone forks straight into the calling flow.
- The letter and the form are TWO SEPARATE PDFs in one package, so the letter can
  print on Andy's letterhead and the form on plain paper.
- The zero-contact customer (no phone, no email, no address) is out of scope here
  — Contact Research owns her.
- Email wording will be REWRITTEN (Bob). For the first build, reuse the existing
  `saEmailBody` (honest "restore servicing access, here's the form" framing) as a
  PLACEHOLDER; do NOT claim "we tried to call you" (for these customers we usually
  never had a number). Final customer-facing wording is Bob's to approve before it
  is treated as final.

## Reuse (this is mostly composition, not new plumbing)

Verified present in the repo:
- `GatewayLookup` (`@/components/workflow`) — the research look-up.
- The guided call card from Calls Due (`OutreachCallPanel` / the stewardship task
  driven with `forceCall`) — the found-a-phone fork.
- `ServicingFormDelivery` (`src/app/(internal)/stewardship/panels/`) — filled
  authorization PDF + mailto prepared email + manual attach + postal alternative
  + send confirmation + outreach history + follow-up scheduling.
- `src/lib/servicing-agent-form.ts` — fills the real carrier PDF (ALL2018-4) via
  pdf-lib and already has `buildPostalCoverPage` (the letter). The
  `/api/servicing-agent-change` route already emits the plain form or a postal
  (form + cover) PDF.
- `saEmailBody` and the post-conversation email body (`src/app/(internal)/
  stewardship/shared.tsx`), `openMailto`, the `EmailAttempt` Lego.

New work is small: wire the research-then-fork sequence; a per-screen
"email the form" and "mail the form" action; and split the postal output into two
PDFs (letter, form) instead of one combined file.

## Open — decide before/at build, do NOT silently build

1. PRINTER / PRINT-AND-MAIL QUEUE. Remote staff (e.g. Dulce) have no printer.
   Decision taken: GENERATE the two PDFs now; the routing of a print job to
   whoever does the office mailing (out of Angie's or Andy's office) is a
   SEPARATE follow-up branch — a queue that says "this needs to be printed and
   mailed," cleared by a named mail handler. Not building the queue in this pass;
   just generate the PDFs so the groundwork is laid. Bob: "not worried about it
   right at the moment." Revisit as its own branch (who is the handler, is it a
   real queue or a forward, letterhead vs plain paper per PDF).
2. EMAIL REWRITE + possible multi-email cadence: deferred, Bob to provide wording.

## My Work wiring (already shipped on preview)

"People we can't call" is a STANDING Outreach sub-step directly under "Make the
calls that are due" (its own line, its own page at `/stewardship/unable-to-call`).
Count = active outreach customers with no phone, not engaged, not past the signed
form, eligible-and-unclaimed for the worker. Classified under the Outreach work
class (`outreach:unable-to-call` in `work-classes.ts`). The screen itself is still
the placeholder (lists the population, link to open each customer); the flow above
is the build that replaces it.
