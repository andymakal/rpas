-- Reusable digit-normalized phone matching for customer search.
--
-- The shared customer search (/api/customers/search) matches a pasted phone
-- number against customers.phone. Phone is STORED in display form, mostly
-- "(XXX) XXX-XXXX" but with some legacy variants (e.g. "610-259-1731"). A
-- PostgREST `ilike('phone', '%<digits>%')` cannot match a punctuation-free
-- paste like "2155550100" against a stored "(215) 555-0100" because the
-- formatting characters break the substring. This function strips both sides
-- to digits and compares, so any common paste format from Hearsay (with or
-- without punctuation or a leading US country code) finds the customer.
--
-- Returns matching customer ids only; each search mode resolves its own fields,
-- is_test / exclude filters, ordering, and limit on top of these ids, so no
-- existing search behavior or workflow filtering changes.
--
-- Duplicate numbers are intentionally supported: this returns every customer
-- whose number matches, never a single assumed-unique row.
create or replace function public.search_customer_ids_by_phone(p_raw text)
returns table(id uuid)
language sql
stable
as $function$
  with norm as (
    -- Strip the query to digits, then drop a single leading US country code
    -- of 1 only in the unambiguous 11-digit "1 + 10" case (mirrors the app's
    -- normalizePhone convention). Partial digit runs are kept as-is so a
    -- 7+ digit fragment still matches as a substring.
    select case
      when length(d) = 11 and left(d, 1) = '1' then substring(d from 2)
      else d
    end as digits
    from (select regexp_replace(coalesce(p_raw, ''), '\D', '', 'g') as d) s
  )
  select c.id
  from public.customers c, norm
  where norm.digits <> ''
    and c.is_test = false
    and regexp_replace(coalesce(c.phone, ''), '\D', '', 'g') ilike '%' || norm.digits || '%'
$function$;

comment on function public.search_customer_ids_by_phone(text) is
  'Returns ids of non-test customers whose stored phone, compared digit-to-digit (format-insensitive, leading US country-code 1 dropped), contains the digits of the given raw query. Backs digit-normalized phone matching in the shared customer search.';

grant execute on function public.search_customer_ids_by_phone(text) to authenticated, service_role;
