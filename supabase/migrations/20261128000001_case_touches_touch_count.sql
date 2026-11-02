-- case_touches.touch_count — the summable contact count per row.
--
-- A "touch" is a real outbound CONTACT (a communication that actually went
-- out), which is a distinct concept from a recorded attempt. The reporting
-- question "how many touches on this customer in this project" must be a plain
-- SUM, not a parse of note markers at read time, so each row stores its own
-- 0 or 1 decided at the moment it is written.
--
-- The decision is fully determined by touch_type plus the stable outcome
-- markers already written on every row ([reached] / [no-contact] /
-- [channel-unusable...]), so it is expressed ONCE as a GENERATED column. That
-- way every writer (there are many insert sites) gets the correct number with
-- no app-code change, every existing row is backfilled automatically, and the
-- value can never drift from the note it is derived from.
--
-- The rules (matching the agreed definition of a contact):
--   * voicemail / text / email / postal  → 1, UNLESS the note marks the channel
--     as not completed: [no-contact] (e.g. voicemail not left) or
--     [channel-unusable...] (the channel could not deliver) → 0.
--   * call → 1 ONLY when the note carries [reached] (the customer was reached:
--     deferred, agreed, or declined — any actual conversation is a contact).
--     A didn't-reach call and every unmarked legacy call row → 0. We never
--     infer reached-ness for an unmarked historical call.
--   * missed_appointment / research / workflow and anything else → 0 (not an
--     outbound contact).
--
-- An integer (0/1), not a boolean, so a report is SUM(touch_count) with no
-- true/false to translate; it also leaves room should a single row ever stand
-- for more than one contact, though today every row is 0 or 1.

ALTER TABLE public.case_touches
  ADD COLUMN touch_count integer NOT NULL GENERATED ALWAYS AS (
    CASE
      WHEN touch_type IN ('voicemail', 'text', 'email', 'postal')
           AND coalesce(notes, '') !~ '\[no-contact\]'
           AND coalesce(notes, '') !~ '\[channel-unusable'
        THEN 1
      WHEN touch_type = 'call'
           AND coalesce(notes, '') ~ '\[reached\]'
        THEN 1
      ELSE 0
    END
  ) STORED;

COMMENT ON COLUMN public.case_touches.touch_count IS
  'Summable contact count for this row: 1 when the row is a real outbound contact (voicemail/text/email/postal that was completed, or a [reached] call), else 0. Generated from touch_type and the note outcome markers. Report touches as SUM(touch_count).';
