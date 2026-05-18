-- Fix stage_translations: 'quoted' label was "Working on application" which
-- reads as app-submitted. Updated to "Quote provided" for clarity.
update public.stage_translations
set agency_label = 'Quote provided'
where internal_status = 'quoted';
