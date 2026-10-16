-- =============================================================================
-- Track the introductory-email recipient so a replaced address re-offers it
-- Migration: 20261105000001_intro_email_recipient.sql
--
-- The introductory servicing-agent authorization email is the first-touch
-- action for a customer not yet contacted. Until now the only durable record of
-- that send was `email_sent_at` (a timestamp). That is not enough to satisfy the
-- business rule that replacing a customer's email — when the earlier
-- introduction went to the OLD address — makes the introduction available again
-- for the NEW address: the system could not tell WHICH address the introduction
-- went to.
--
-- This adds one durable fact, `intro_email_recipient`, stamped with the email
-- address the introductory/authorization email was actually sent to at the
-- moment of sending. Reads compare it to the customer's current usable email: a
-- match means the introduction has been delivered to the address on file (no
-- re-offer); a mismatch, while the item is still in the pre-authorization
-- funnel, means the introduction was delivered to an address the customer no
-- longer has, so it becomes available again for the new address. Once the
-- customer has progressed past authorization (awaiting the signed form or the
-- carrier), the introduction is never re-offered — that is a chase, not a
-- restart.
--
-- This complements, and does not replace, the communication history: the send
-- is still recorded as a case_touches row, now carrying the recipient address so
-- history is explicit about who each email reached.
--
-- SAFE REPLAY: add-column IF NOT EXISTS; nullable with no default, so existing
-- rows are unaffected (null = no introduction recorded yet, same as before).
-- =============================================================================

alter table public.stewardship_outreach
  add column if not exists intro_email_recipient text;

comment on column public.stewardship_outreach.intro_email_recipient is
  'The email address the introductory/authorization email was actually sent to, '
  'stamped at send time. A mismatch with the customer''s current usable email, '
  'while still in the pre-authorization funnel, re-offers the introductory email '
  'for the new address. Null when no introduction has been sent.';

notify pgrst, 'reload schema';
