-- Restore customer phone/email/date_of_birth from intake_raw for any records
-- where those fields are currently NULL.
--
-- Background: a UI bug temporarily caused Save Client Info to send null for
-- unchanged fields, overwriting data that came from the original referral form.
-- intake_raw stores the raw form payload (source = 'form'), so we can recover
-- the original values safely.
--
-- Uses COALESCE so we only fill in fields that are currently NULL — we never
-- overwrite data that was intentionally set or already restored manually.

update public.customers c
set
  phone         = coalesce(c.phone,         ir.raw_data ->> 'client_phone'),
  email         = coalesce(c.email,         ir.raw_data ->> 'client_email'),
  date_of_birth = coalesce(
    c.date_of_birth,
    case
      when (ir.raw_data ->> 'client_dob') is not null
       and (ir.raw_data ->> 'client_dob') <> ''
      then (ir.raw_data ->> 'client_dob')::date
    end
  )
from public.intake_raw ir
join public.cases       cs on cs.id = ir.case_id
where cs.customer_id = c.id
  and ir.source       = 'form'
  and ir.processed_at is not null
  and (c.phone is null or c.email is null or c.date_of_birth is null);
