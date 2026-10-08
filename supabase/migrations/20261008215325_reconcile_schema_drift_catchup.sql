create type "public"."agency_tier" as enum ('cornerstone', 'active', 'developing', 'onboarding', 'dormant');

create type "public"."appointment_status" as enum ('scheduled', 'kept', 'missed', 'cancelled', 'rescheduled');

create type "public"."case_status" as enum ('new', 'attempting_contact', 'contacted', 'appointment_set', 'appointment_completed', 'quoted', 'app_submitted', 'pending_underwriting', 'approved', 'placed', 'not_taken', 'declined', 'not_interested', 'lost', 'x_date', 'application', 'pending', 'issued', 'postponed', 'awaiting_transfer', 'incomplete', 'sold', 'working', 'appt_set', 'appt_missed', 'appt_kept');

create type "public"."compliance_type" as enum ('eo_policy', 'state_license', 'carrier_appointment', 'ce_credit', 'finra_registration', 'series_7', 'series_6', 'series_63', 'series_65', 'series_66', 'supervision_log', 'suitability_training', 'annual_compliance_training', 'chfc_coursework');

create type "public"."coverage_status" as enum ('active', 'lapsed', 'surrendered', 'paid_up', 'reduced_paid_up', 'pending', 'terminated');

create type "public"."deliverable_type" as enum ('policy_review', 'right_path_review', 'progress_report', 'needs_analysis', 'life_insurance_summary', 'right_path_introduction', 'ss_timing_report', 'medicare_planning_timeline', 'rmd_planning_summary', 'beneficiary_confirmation', 'appointment_summary', 'suitability_narrative', 'welcome_kit', 'policy_delivery_summary', 'agency_partner_roi_report');

create type "public"."health_changes" as enum ('no_change', 'improved', 'stopped_smoking', 'now_uninsurable', 'excellent', 'declined');

create type "public"."life_event_type" as enum ('marriage', 'divorce', 'new_baby', 'home_purchase', 'home_sale', 'job_change', 'income_change', 'business_start', 'business_sale', 'retirement', 'inheritance', 'death_of_spouse', 'health_change', 'approaching_ss_window', 'approaching_medicare', 'approaching_rmd');

create type "public"."lost_reason" as enum ('never_really_interested', 'has_sufficient_coverage', 'chose_competitor', 'no_response', 'price', 'health_declined', 'not_insureable', 'referred_back_to_agency', 'other', 'carrier_decline', 'client_withdrawal_price', 'client_withdrawal_rating', 'found_better_coverage', 'incomplete_client_ghosted');

create type "public"."opportunity_type" as enum ('rate_improvement', 'tobacco_rerate', 'health_improvement', 'extend_term_coverage', 'conversion', 'carrier_switch', '1035_exchange', 'spouse_to_own_policy', 'multiple_opportunities', 'no_opportunity_optimized', 'annual_review', 'retirement_estate_planning');

create type "public"."product_category" as enum ('life', 'financial');

create type "public"."product_type" as enum ('term', 'ul', 'iul', 'wl', 'vul', 'gul', 'annuity_fixed', 'annuity_variable', 'annuity_fia', 'annuity_rila', 'annuity_spia', 'mutual_fund', 'uit', 'di', 'ltc', 'other');

create type "public"."referral_type" as enum ('mortgage_protection', 'life_review', 'financial_planning', 'business_owner', 'umbrella_flagged', 'wanderer_review', '1035_exchange', 'tobacco_rerate', 'term_expiry', 'annuity_review', 'uit_rollover', 'general');

create type "public"."request_status" as enum ('new', 'form_sent_to_client', 'form_sent_to_carrier', 'pending_client_response', 'awaiting_carrier', 'resolved', 'converted_to_review');

create type "public"."request_type" as enum ('beneficiary_change', 'banking_eft_change', 'face_amount_change', 'policy_loan_withdrawal', 'policy_surrender', 'policy_document_request', 'payment_reinstatement', 'coverage_status_question', 'servicing_agent_form', 'product_switch');

create type "public"."review_status" as enum ('scheduled', 'in_progress', 'complete_no_changes', 'complete_service_request', 'complete_opportunity_identified', 'quoted_follow_up', 'new_policy_replacement', 'new_policy_additional', 'client_declined', 'follow_up_needed');

create type "public"."right_path_tier" as enum ('wanderer', 'explorer', 'pathfinder', 'voyager', 'trailblazer');

create type "public"."team_role" as enum ('principal', 'securities_producer', 'life_producer', 'operations', 'service_admin', 'outbound', 'intern', 'gatekeeper');

create sequence "public"."reviews_id_seq";

create sequence "public"."service_requests_id_seq";

drop trigger if exists "service_policies_set_updated_at" on "public"."service_policies";

drop policy "service_policies_all" on "public"."service_policies";

drop policy "service_policies_select" on "public"."service_policies";

drop policy "agencies_agency_select" on "public"."agencies";

revoke delete on table "public"."customer_prereviews" from "anon";

revoke insert on table "public"."customer_prereviews" from "anon";

revoke select on table "public"."customer_prereviews" from "anon";

revoke update on table "public"."customer_prereviews" from "anon";

revoke delete on table "public"."customer_prereviews" from "authenticated";

revoke insert on table "public"."customer_prereviews" from "authenticated";

revoke select on table "public"."customer_prereviews" from "authenticated";

revoke update on table "public"."customer_prereviews" from "authenticated";

revoke delete on table "public"."customer_prereviews" from "service_role";

revoke insert on table "public"."customer_prereviews" from "service_role";

revoke select on table "public"."customer_prereviews" from "service_role";

revoke update on table "public"."customer_prereviews" from "service_role";

revoke delete on table "public"."policy_documents" from "anon";

revoke insert on table "public"."policy_documents" from "anon";

revoke select on table "public"."policy_documents" from "anon";

revoke update on table "public"."policy_documents" from "anon";

revoke delete on table "public"."policy_documents" from "authenticated";

revoke insert on table "public"."policy_documents" from "authenticated";

revoke select on table "public"."policy_documents" from "authenticated";

revoke update on table "public"."policy_documents" from "authenticated";

revoke delete on table "public"."policy_documents" from "service_role";

revoke insert on table "public"."policy_documents" from "service_role";

revoke select on table "public"."policy_documents" from "service_role";

revoke update on table "public"."policy_documents" from "service_role";

revoke delete on table "public"."policy_review_policies" from "anon";

revoke insert on table "public"."policy_review_policies" from "anon";

revoke select on table "public"."policy_review_policies" from "anon";

revoke update on table "public"."policy_review_policies" from "anon";

revoke delete on table "public"."policy_review_policies" from "authenticated";

revoke insert on table "public"."policy_review_policies" from "authenticated";

revoke select on table "public"."policy_review_policies" from "authenticated";

revoke update on table "public"."policy_review_policies" from "authenticated";

revoke delete on table "public"."policy_review_policies" from "service_role";

revoke insert on table "public"."policy_review_policies" from "service_role";

revoke select on table "public"."policy_review_policies" from "service_role";

revoke update on table "public"."policy_review_policies" from "service_role";

revoke delete on table "public"."stewardship_outreach" from "anon";

revoke insert on table "public"."stewardship_outreach" from "anon";

revoke select on table "public"."stewardship_outreach" from "anon";

revoke update on table "public"."stewardship_outreach" from "anon";

revoke delete on table "public"."stewardship_outreach" from "authenticated";

revoke insert on table "public"."stewardship_outreach" from "authenticated";

revoke select on table "public"."stewardship_outreach" from "authenticated";

revoke update on table "public"."stewardship_outreach" from "authenticated";

revoke delete on table "public"."stewardship_outreach" from "service_role";

revoke insert on table "public"."stewardship_outreach" from "service_role";

revoke select on table "public"."stewardship_outreach" from "service_role";

revoke update on table "public"."stewardship_outreach" from "service_role";

revoke delete on table "public"."stewardship_outreach_policies" from "anon";

revoke insert on table "public"."stewardship_outreach_policies" from "anon";

revoke select on table "public"."stewardship_outreach_policies" from "anon";

revoke update on table "public"."stewardship_outreach_policies" from "anon";

revoke delete on table "public"."stewardship_outreach_policies" from "authenticated";

revoke insert on table "public"."stewardship_outreach_policies" from "authenticated";

revoke select on table "public"."stewardship_outreach_policies" from "authenticated";

revoke update on table "public"."stewardship_outreach_policies" from "authenticated";

revoke delete on table "public"."stewardship_outreach_policies" from "service_role";

revoke insert on table "public"."stewardship_outreach_policies" from "service_role";

revoke select on table "public"."stewardship_outreach_policies" from "service_role";

revoke update on table "public"."stewardship_outreach_policies" from "service_role";

alter table "public"."customer_notes" drop constraint "customer_notes_body_nonempty";

alter table "public"."customer_notes" drop constraint "customer_notes_section_valid";

alter table "public"."cases" drop constraint "cases_lead_source_valid";

drop index if exists "public"."customer_groups_agency_id_idx";

drop index if exists "public"."policy_reviews_customer_idx";

drop index if exists "public"."policy_reviews_resulting_case";

drop index if exists "public"."service_policies_agency_idx";

drop index if exists "public"."service_policies_carrier_idx";

drop index if exists "public"."service_policies_rate_class_idx";


  create table "public"."agency_visits" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "agency_id" uuid not null,
    "visit_date" date not null,
    "visit_type" text not null default 'in_person'::text,
    "team_attendee_ids" uuid[],
    "prep_brief_generated" boolean not null default false,
    "prep_brief_content" jsonb,
    "agenda_notes" text,
    "commitments_made" text,
    "outcome_notes" text,
    "follow_up_tasks_created" boolean not null default false,
    "next_visit_scheduled" date
      );


alter table "public"."agency_visits" enable row level security;


  create table "public"."appointments" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "referral_id" uuid,
    "case_id" uuid,
    "household_id" uuid not null,
    "agency_id" uuid,
    "assigned_producer_id" uuid,
    "scheduled_at" timestamp with time zone not null,
    "duration_minutes" integer default 60,
    "location" text,
    "status" public.appointment_status not null default 'scheduled'::public.appointment_status,
    "outcome_notes" text,
    "rescheduled_to" timestamp with time zone,
    "counted_for_agency" boolean not null default false
      );


alter table "public"."appointments" enable row level security;


  create table "public"."client_deliverables" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "household_id" uuid not null,
    "deliverable_type" public.deliverable_type not null,
    "generated_at" timestamp with time zone not null default now(),
    "generated_by" uuid,
    "delivered_at" timestamp with time zone,
    "delivery_method" text,
    "file_url" text,
    "file_name" text,
    "triggered_by_life_event_id" uuid,
    "triggered_by_case_id" uuid,
    "triggered_by_review_date" date,
    "notes" text
      );


alter table "public"."client_deliverables" enable row level security;


  create table "public"."compliance_records" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "team_member_id" uuid not null,
    "record_type" public.compliance_type not null,
    "description" text,
    "state" text,
    "carrier" text,
    "license_number" text,
    "issue_date" date,
    "expiration_date" date,
    "renewal_submitted_date" date,
    "status" text not null default 'active'::text,
    "alert_90_days_sent" boolean not null default false,
    "alert_30_days_sent" boolean not null default false,
    "alert_expired_sent" boolean not null default false,
    "notes" text
      );


alter table "public"."compliance_records" enable row level security;


  create table "public"."financial_accounts" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "household_id" uuid not null,
    "account_number" text,
    "carrier" text not null,
    "product_name" text,
    "product_type" public.product_type not null,
    "account_value" numeric(12,2),
    "account_value_as_of_date" date,
    "surrender_value" numeric(12,2),
    "purchase_date" date,
    "surrender_expiration_date" date,
    "is_exchange_candidate" boolean not null default false,
    "uit_expiration_date" date,
    "commission_option" text,
    "gdc_at_purchase" numeric(5,4),
    "revenue_at_purchase" numeric(12,2),
    "tax_qualification" text,
    "primary_beneficiary" text,
    "contingent_beneficiary" text,
    "beneficiary_confirmed_date" date,
    "written_by_producer_id" uuid,
    "is_active" boolean not null default true,
    "notes" text
      );


alter table "public"."financial_accounts" enable row level security;


  create table "public"."financial_reviews" (
    "id" uuid not null default gen_random_uuid(),
    "review_number" text,
    "customer_id" uuid,
    "status" text not null default 'draft'::text,
    "contracts" jsonb not null default '[]'::jsonb,
    "recommendation_notes" text,
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "is_test" boolean not null default false,
    "documents" jsonb default '[]'::jsonb
      );


alter table "public"."financial_reviews" enable row level security;


  create table "public"."gdc_grid" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "carrier" text not null,
    "product_name" text not null,
    "product_type" public.product_type not null,
    "available_states" text not null default 'CW'::text,
    "age_min" integer,
    "age_max" integer,
    "duration_min_years" integer,
    "duration_max_years" integer,
    "issue_age_band" text,
    "gdc_first_year" numeric(6,4) not null,
    "gdc_excess" numeric(6,4) not null default 0,
    "renewal_yr2_rate" numeric(6,4),
    "renewal_yr3_rate" numeric(6,4),
    "renewal_yr4_5_rate" numeric(6,4),
    "renewal_yr6_10_rate" numeric(6,4),
    "renewal_yr11_plus_rate" numeric(6,4),
    "pg_points" integer,
    "included_in_vc" boolean default false,
    "effective_date" date not null,
    "notes" text,
    "is_active" boolean not null default true
      );


alter table "public"."gdc_grid" enable row level security;


  create table "public"."households" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "first_name" text not null,
    "last_name" text not null,
    "date_of_birth" date,
    "spouse_first_name" text,
    "spouse_last_name" text,
    "spouse_date_of_birth" date,
    "address_line1" text,
    "city" text,
    "state" text,
    "zip" text,
    "phone_primary" text,
    "phone_secondary" text,
    "email_primary" text,
    "email_secondary" text,
    "tier" public.right_path_tier not null default 'wanderer'::public.right_path_tier,
    "tier_set_at" timestamp with time zone default now(),
    "tier_set_by" uuid,
    "primary_agency_id" uuid,
    "assigned_producer_id" uuid,
    "assigned_at" timestamp with time zone,
    "last_review_date" date,
    "next_review_due" date,
    "review_frequency_months" integer not null default 12,
    "ss_planning_window_active" boolean not null default false,
    "medicare_planning_window_active" boolean not null default false,
    "rmd_planning_window_active" boolean not null default false,
    "is_wanderer_origin" boolean not null default false,
    "servicing_agent_confirmed" boolean not null default false,
    "servicing_agent_confirmed_date" date,
    "total_life_face_value" numeric(12,2) not null default 0,
    "total_life_csv" numeric(12,2) not null default 0,
    "total_annual_premium_life" numeric(12,2) not null default 0,
    "total_financial_aum" numeric(12,2) not null default 0,
    "rp_needs_analysis_complete" boolean not null default false,
    "rp_coverage_gaps_documented" boolean not null default false,
    "rp_recommendations_made" boolean not null default false,
    "rp_recommendations_acted_on" boolean not null default false,
    "rp_beneficiaries_confirmed" boolean not null default false,
    "rp_estate_docs_present" boolean not null default false,
    "rp_ss_timing_discussed" boolean not null default false,
    "rp_medicare_timeline_set" boolean not null default false,
    "rp_rmd_planning_initiated" boolean not null default false,
    "rp_completion_score" integer generated always as ((((((((((rp_needs_analysis_complete)::integer + (rp_coverage_gaps_documented)::integer) + (rp_recommendations_made)::integer) + (rp_recommendations_acted_on)::integer) + (rp_beneficiaries_confirmed)::integer) + (rp_estate_docs_present)::integer) + (rp_ss_timing_discussed)::integer) + (rp_medicare_timeline_set)::integer) + (rp_rmd_planning_initiated)::integer)) stored,
    "is_active" boolean not null default true,
    "notes" text
      );


alter table "public"."households" enable row level security;


  create table "public"."life_events" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "household_id" uuid not null,
    "event_type" public.life_event_type not null,
    "event_date" date,
    "logged_by" uuid,
    "review_triggered" boolean not null default false,
    "review_triggered_at" timestamp with time zone,
    "review_completed_at" timestamp with time zone,
    "deliverable_generated" boolean not null default false,
    "outreach_sent_at" timestamp with time zone,
    "notes" text
      );


alter table "public"."life_events" enable row level security;


  create table "public"."notifications" (
    "id" uuid not null default gen_random_uuid(),
    "type" text not null default 'new_referral'::text,
    "title" text not null,
    "body" text,
    "link" text,
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone not null default now()
      );


alter table "public"."notifications" enable row level security;


  create table "public"."platform_settings" (
    "id" uuid not null default gen_random_uuid(),
    "setting_key" text not null,
    "setting_value" text not null,
    "setting_type" text not null default 'string'::text,
    "description" text not null,
    "updated_at" timestamp with time zone not null default now(),
    "updated_by" uuid
      );


alter table "public"."platform_settings" enable row level security;


  create table "public"."policies" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "household_id" uuid not null,
    "agency_id" uuid,
    "policy_number" text,
    "carrier" text not null,
    "product_name" text,
    "product_type" public.product_type not null,
    "coverage_status" public.coverage_status not null default 'active'::public.coverage_status,
    "insured_first_name" text,
    "insured_last_name" text,
    "insured_date_of_birth" date,
    "face_value_amt" numeric(12,2),
    "annual_premium_amt" numeric(12,2),
    "cash_value_amt" numeric(12,2) not null default 0,
    "cash_value_as_of_date" date,
    "policy_loan_balance" numeric(12,2) not null default 0,
    "net_csv" numeric(12,2) generated always as (GREATEST((cash_value_amt - policy_loan_balance), (0)::numeric)) stored,
    "cost_basis" numeric(12,2),
    "term_length_years" integer,
    "issue_date" date,
    "expiration_date" date,
    "conversion_privilege_available" boolean,
    "conversion_privilege_expiry" date,
    "underwriting_class" text,
    "is_tobacco_rated" boolean not null default false,
    "tobacco_product_type" text,
    "last_tobacco_use_date" date,
    "non_tobacco_requalification_candidate" boolean not null default false,
    "priority_score" integer not null default 0,
    "is_1035_candidate" boolean not null default false,
    "is_tobacco_rerate_candidate" boolean not null default false,
    "is_term_expiry_priority" boolean not null default false,
    "last_reviewed_date" date,
    "review_outcome" text,
    "triage_assigned_to" uuid,
    "is_inherited_policy" boolean not null default false,
    "writing_agent_name" text,
    "written_by_producer_id" uuid,
    "policy_written_date" date,
    "notes" text
      );


alter table "public"."policies" enable row level security;


  create table "public"."reciprocal_referrals" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "household_id" uuid not null,
    "agency_id" uuid not null,
    "referred_by" uuid,
    "referral_date" date not null default CURRENT_DATE,
    "referral_reason" text,
    "product_need" text,
    "outcome" text,
    "notes" text
      );


alter table "public"."reciprocal_referrals" enable row level security;


  create table "public"."reviews" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "review_id" text not null,
    "household_id" uuid not null,
    "policy_id" uuid,
    "agency_id" uuid,
    "lsp_id" uuid,
    "referral_id" uuid,
    "assigned_to" uuid,
    "date_received" date not null default CURRENT_DATE,
    "review_date" date,
    "follow_up_date" date,
    "current_carrier" text,
    "product_type_label" text,
    "issue_date" date,
    "term_length" text,
    "face_amount" numeric(12,2),
    "annual_premium" numeric(12,2),
    "premium_mode" text,
    "rate_class" text,
    "health_status" text,
    "health_changes" public.health_changes default 'no_change'::public.health_changes,
    "next_premium_due" date,
    "cash_value" numeric(12,2),
    "cash_surrender_value" numeric(12,2),
    "loan_amount" numeric(12,2),
    "cost_basis" numeric(12,2),
    "servicing_agent_authorized" boolean not null default false,
    "primary_beneficiary" text,
    "contingent_beneficiary" text,
    "beneficiary_last_updated" date,
    "policy_year" integer,
    "years_remaining" integer,
    "expiration_date" date,
    "client_age_at_issue" integer,
    "current_client_age" integer,
    "recommendation_1" text,
    "recommendation_2" text,
    "recommendation_3" text,
    "conversion_notes" text,
    "opportunity_found" boolean not null default false,
    "opportunity_type" public.opportunity_type,
    "new_premium_estimate" numeric(12,2),
    "new_face_amount_estimate" numeric(12,2),
    "review_status" public.review_status not null default 'scheduled'::public.review_status,
    "resulting_case_id" uuid,
    "resulting_service_request_id" uuid,
    "pdf_generated" boolean not null default false,
    "pdf_generated_at" timestamp with time zone,
    "pdf_url" text,
    "notes" text
      );


alter table "public"."reviews" enable row level security;


  create table "public"."team_members" (
    "id" uuid not null default gen_random_uuid(),
    "created_at" timestamp with time zone not null default now(),
    "updated_at" timestamp with time zone not null default now(),
    "first_name" text not null,
    "last_name" text not null,
    "email" text not null,
    "phone" text,
    "role" public.team_role not null,
    "is_active" boolean not null default true,
    "is_producer" boolean not null default false,
    "mdrt_ytd_gdc" numeric(12,2) not null default 0,
    "mdrt_ytd_revenue" numeric(12,2) not null default 0,
    "mdrt_target_level" text not null default 'mdrt'::text,
    "auth_user_id" uuid,
    "access_level" text not null default 'team'::text,
    "commission_scale" text not null default 'C'::text
      );


alter table "public"."team_members" enable row level security;

alter table "public"."agencies" add column "is_securities_licensed" boolean not null default false;

alter table "public"."agencies" add column "parent_agency_id" uuid;

alter table "public"."case_household_members" enable row level security;

alter table "public"."case_pending_requirements" add column "completed_at" date;

alter table "public"."case_pending_requirements" add column "ordered_at" date;

alter table "public"."case_pending_requirements" add column "scheduled_at" date;

alter table "public"."case_status_history" enable row level security;

alter table "public"."case_touches" add column "touched_by" text;

alter table "public"."case_touches" enable row level security;

alter table "public"."cases" add column "consent_given_at" timestamp with time zone;

alter table "public"."cases" add column "exchange_carrier" text;

alter table "public"."cases" add column "exchange_cash_value" numeric(12,2);

alter table "public"."cases" add column "exchange_cost_basis" numeric(12,2);

alter table "public"."cases" add column "exchange_net_transfer" numeric(12,2);

alter table "public"."cases" add column "exchange_policy_number" text;

alter table "public"."cases" add column "exchange_product_type" text;

alter table "public"."cases" add column "exchange_surrender_charges" numeric(12,2);

alter table "public"."cases" add column "is_1035" boolean default false;

alter table "public"."cases" add column "suspected_duplicate_customer_id" uuid;

alter table "public"."customer_groups" enable row level security;

alter table "public"."customers" add column "address_line1" text;

alter table "public"."customers" add column "drive_folder_url" text;

alter table "public"."customers" add column "fact_finder" jsonb;

alter table "public"."customers" add column "fact_finder_verified_at" timestamp with time zone;

alter table "public"."customers" add column "fact_finder_verified_by" text;

alter table "public"."customers" add column "gender" text;

alter table "public"."customers" add column "health_notes" text;

alter table "public"."customers" add column "height_ft" smallint;

alter table "public"."customers" add column "height_in" smallint;

alter table "public"."customers" add column "household_id" uuid;

alter table "public"."customers" add column "is_deceased" boolean not null default false;

alter table "public"."customers" add column "is_emoney_client" boolean not null default false;

alter table "public"."customers" add column "is_former_client" boolean not null default false;

alter table "public"."customers" add column "is_prospect" boolean not null default false;

alter table "public"."customers" add column "marital_status" text;

alter table "public"."customers" add column "sms_opt_out" boolean not null default false;

alter table "public"."customers" add column "source_client_id" text;

alter table "public"."customers" add column "spanish_speaking" boolean not null default false;

alter table "public"."customers" add column "tobacco_use" text;

alter table "public"."customers" add column "weight_lbs" smallint;

alter table "public"."gdc_records" add column "producer_id" uuid;

alter table "public"."gdc_records" add column "writing_agent_number" text;

alter table "public"."pending_requirements" add column "has_date_fields" boolean not null default false;

alter table "public"."producers" enable row level security;

alter table "public"."service_policies" add column "account_value" numeric(14,2);

alter table "public"."service_policies" add column "account_value_as_of" date;

alter table "public"."service_policies" add column "contingent_beneficiary" text;

alter table "public"."service_policies" add column "plan_type" text;

alter table "public"."service_policies" add column "product_category" text;

alter table "public"."service_policies" add column "rmd_annual" numeric(14,2);

alter table "public"."service_policies" add column "rmd_autopay" boolean not null default false;

alter table "public"."service_policies" add column "rmd_year" integer;

alter table "public"."service_policies" add column "source_carrier_raw" text;

alter table "public"."service_policies" add column "surrender_end_date" date;

alter table "public"."service_policies" add column "type_data" jsonb;

alter table "public"."service_policies" alter column "annual_premium" set data type numeric using "annual_premium"::numeric;

alter table "public"."service_policies" alter column "face_amount" set data type numeric using "face_amount"::numeric;

alter table "public"."spiff_records" enable row level security;

CREATE UNIQUE INDEX agency_visits_pkey ON public.agency_visits USING btree (id);

CREATE UNIQUE INDEX appointments_pkey ON public.appointments USING btree (id);

CREATE INDEX case_status_history_case_id_idx ON public.case_status_history USING btree (case_id);

CREATE UNIQUE INDEX client_deliverables_pkey ON public.client_deliverables USING btree (id);

CREATE UNIQUE INDEX compliance_records_pkey ON public.compliance_records USING btree (id);

CREATE INDEX customers_former_client_idx ON public.customers USING btree (is_former_client) WHERE (is_former_client = true);

CREATE INDEX customers_is_prospect_idx ON public.customers USING btree (is_prospect) WHERE (is_prospect = true);

CREATE INDEX customers_prospect_idx ON public.customers USING btree (is_prospect) WHERE (is_prospect = true);

CREATE UNIQUE INDEX customers_source_client_id_key ON public.customers USING btree (source_client_id) WHERE (source_client_id IS NOT NULL);

CREATE UNIQUE INDEX financial_accounts_pkey ON public.financial_accounts USING btree (id);

CREATE INDEX financial_reviews_customer_id_idx ON public.financial_reviews USING btree (customer_id);

CREATE UNIQUE INDEX financial_reviews_pkey ON public.financial_reviews USING btree (id);

CREATE UNIQUE INDEX gdc_grid_pkey ON public.gdc_grid USING btree (id);

CREATE UNIQUE INDEX households_pkey ON public.households USING btree (id);

CREATE INDEX idx_accounts_exchange_candidate ON public.financial_accounts USING btree (is_exchange_candidate) WHERE (is_exchange_candidate = true);

CREATE INDEX idx_accounts_household ON public.financial_accounts USING btree (household_id);

CREATE INDEX idx_accounts_surrender ON public.financial_accounts USING btree (surrender_expiration_date) WHERE (surrender_expiration_date IS NOT NULL);

CREATE INDEX idx_accounts_uit_expiry ON public.financial_accounts USING btree (uit_expiration_date) WHERE (uit_expiration_date IS NOT NULL);

CREATE INDEX idx_appts_household ON public.appointments USING btree (household_id);

CREATE INDEX idx_appts_producer ON public.appointments USING btree (assigned_producer_id);

CREATE INDEX idx_appts_referral ON public.appointments USING btree (referral_id);

CREATE INDEX idx_appts_scheduled ON public.appointments USING btree (scheduled_at);

CREATE INDEX idx_appts_status ON public.appointments USING btree (status);

CREATE INDEX idx_customers_customer_group_id ON public.customers USING btree (customer_group_id);

CREATE INDEX idx_customers_household_id ON public.customers USING btree (household_id);

CREATE INDEX idx_households_agency ON public.households USING btree (primary_agency_id);

CREATE INDEX idx_households_assigned_producer ON public.households USING btree (assigned_producer_id);

CREATE INDEX idx_households_dob ON public.households USING btree (date_of_birth);

CREATE INDEX idx_households_last_name ON public.households USING btree (last_name);

CREATE INDEX idx_households_tier ON public.households USING btree (tier);

CREATE INDEX idx_policies_1035_candidate ON public.policies USING btree (is_1035_candidate) WHERE (is_1035_candidate = true);

CREATE INDEX idx_policies_agency ON public.policies USING btree (agency_id);

CREATE INDEX idx_policies_csv ON public.policies USING btree (net_csv DESC) WHERE (net_csv > (0)::numeric);

CREATE INDEX idx_policies_expiry ON public.policies USING btree (expiration_date) WHERE (expiration_date IS NOT NULL);

CREATE INDEX idx_policies_household ON public.policies USING btree (household_id);

CREATE INDEX idx_policies_priority ON public.policies USING btree (priority_score DESC);

CREATE INDEX idx_policies_product_type ON public.policies USING btree (product_type);

CREATE INDEX idx_policies_tobacco ON public.policies USING btree (is_tobacco_rerate_candidate) WHERE (is_tobacco_rerate_candidate = true);

CREATE INDEX idx_reviews_agency ON public.reviews USING btree (agency_id);

CREATE INDEX idx_reviews_assigned ON public.reviews USING btree (assigned_to);

CREATE INDEX idx_reviews_date ON public.reviews USING btree (date_received DESC);

CREATE INDEX idx_reviews_household ON public.reviews USING btree (household_id);

CREATE INDEX idx_reviews_opportunity ON public.reviews USING btree (opportunity_found) WHERE (opportunity_found = true);

CREATE INDEX idx_reviews_policy ON public.reviews USING btree (policy_id);

CREATE INDEX idx_reviews_status ON public.reviews USING btree (review_status);

CREATE UNIQUE INDEX life_events_pkey ON public.life_events USING btree (id);

CREATE UNIQUE INDEX notifications_pkey ON public.notifications USING btree (id);

CREATE UNIQUE INDEX platform_settings_pkey ON public.platform_settings USING btree (id);

CREATE UNIQUE INDEX platform_settings_setting_key_key ON public.platform_settings USING btree (setting_key);

CREATE UNIQUE INDEX policies_pkey ON public.policies USING btree (id);

CREATE INDEX policy_reviews_open_date_idx ON public.policy_reviews USING btree (scheduled_date) WHERE ((is_test = false) AND (status = 'prep'::text));

CREATE INDEX policy_reviews_scheduled_date_idx ON public.policy_reviews USING btree (scheduled_date) WHERE (is_test = false);

CREATE UNIQUE INDEX producers_auth_user_id_key ON public.producers USING btree (auth_user_id);

CREATE UNIQUE INDEX reciprocal_referrals_pkey ON public.reciprocal_referrals USING btree (id);

CREATE UNIQUE INDEX reviews_pkey ON public.reviews USING btree (id);

CREATE UNIQUE INDEX reviews_review_id_key ON public.reviews USING btree (review_id);

CREATE INDEX service_policies_customer_idx ON public.service_policies USING btree (customer_id) WHERE (customer_id IS NOT NULL);

CREATE INDEX service_policies_face_amount_idx ON public.service_policies USING btree (face_amount DESC NULLS LAST) WHERE (is_test = false);

CREATE UNIQUE INDEX service_policies_policy_number_unique ON public.service_policies USING btree (policy_number);

CREATE INDEX service_policies_product_type_idx ON public.service_policies USING btree (product_type) WHERE (product_type IS NOT NULL);

CREATE INDEX service_policies_sa_status_idx ON public.service_policies USING btree (sa_status) WHERE (is_test = false);

CREATE UNIQUE INDEX team_members_email_key ON public.team_members USING btree (email);

CREATE UNIQUE INDEX team_members_pkey ON public.team_members USING btree (id);

alter table "public"."agency_visits" add constraint "agency_visits_pkey" PRIMARY KEY using index "agency_visits_pkey";

alter table "public"."appointments" add constraint "appointments_pkey" PRIMARY KEY using index "appointments_pkey";

alter table "public"."client_deliverables" add constraint "client_deliverables_pkey" PRIMARY KEY using index "client_deliverables_pkey";

alter table "public"."compliance_records" add constraint "compliance_records_pkey" PRIMARY KEY using index "compliance_records_pkey";

alter table "public"."financial_accounts" add constraint "financial_accounts_pkey" PRIMARY KEY using index "financial_accounts_pkey";

alter table "public"."financial_reviews" add constraint "financial_reviews_pkey" PRIMARY KEY using index "financial_reviews_pkey";

alter table "public"."gdc_grid" add constraint "gdc_grid_pkey" PRIMARY KEY using index "gdc_grid_pkey";

alter table "public"."households" add constraint "households_pkey" PRIMARY KEY using index "households_pkey";

alter table "public"."life_events" add constraint "life_events_pkey" PRIMARY KEY using index "life_events_pkey";

alter table "public"."notifications" add constraint "notifications_pkey" PRIMARY KEY using index "notifications_pkey";

alter table "public"."platform_settings" add constraint "platform_settings_pkey" PRIMARY KEY using index "platform_settings_pkey";

alter table "public"."policies" add constraint "policies_pkey" PRIMARY KEY using index "policies_pkey";

alter table "public"."reciprocal_referrals" add constraint "reciprocal_referrals_pkey" PRIMARY KEY using index "reciprocal_referrals_pkey";

alter table "public"."reviews" add constraint "reviews_pkey" PRIMARY KEY using index "reviews_pkey";

alter table "public"."team_members" add constraint "team_members_pkey" PRIMARY KEY using index "team_members_pkey";

alter table "public"."agencies" add constraint "agencies_parent_agency_id_fkey" FOREIGN KEY (parent_agency_id) REFERENCES public.agencies(id) not valid;

alter table "public"."agencies" validate constraint "agencies_parent_agency_id_fkey";

alter table "public"."appointments" add constraint "appointments_assigned_producer_id_fkey" FOREIGN KEY (assigned_producer_id) REFERENCES public.team_members(id) not valid;

alter table "public"."appointments" validate constraint "appointments_assigned_producer_id_fkey";

alter table "public"."appointments" add constraint "appointments_household_id_fkey" FOREIGN KEY (household_id) REFERENCES public.households(id) not valid;

alter table "public"."appointments" validate constraint "appointments_household_id_fkey";

alter table "public"."cases" add constraint "cases_suspected_duplicate_customer_id_fkey" FOREIGN KEY (suspected_duplicate_customer_id) REFERENCES public.customers(id) ON DELETE SET NULL not valid;

alter table "public"."cases" validate constraint "cases_suspected_duplicate_customer_id_fkey";

alter table "public"."cases" add constraint "cases_table_rating_check" CHECK (((table_rating >= 1) AND (table_rating <= 8))) not valid;

alter table "public"."cases" validate constraint "cases_table_rating_check";

alter table "public"."client_deliverables" add constraint "client_deliverables_generated_by_fkey" FOREIGN KEY (generated_by) REFERENCES public.team_members(id) not valid;

alter table "public"."client_deliverables" validate constraint "client_deliverables_generated_by_fkey";

alter table "public"."client_deliverables" add constraint "client_deliverables_household_id_fkey" FOREIGN KEY (household_id) REFERENCES public.households(id) not valid;

alter table "public"."client_deliverables" validate constraint "client_deliverables_household_id_fkey";

alter table "public"."compliance_records" add constraint "compliance_records_status_check" CHECK ((status = ANY (ARRAY['active'::text, 'expired'::text, 'pending_renewal'::text, 'terminated'::text, 'suspended'::text]))) not valid;

alter table "public"."compliance_records" validate constraint "compliance_records_status_check";

alter table "public"."compliance_records" add constraint "compliance_records_team_member_id_fkey" FOREIGN KEY (team_member_id) REFERENCES public.team_members(id) not valid;

alter table "public"."compliance_records" validate constraint "compliance_records_team_member_id_fkey";

alter table "public"."customer_notes" add constraint "customer_notes_body_check" CHECK ((length(TRIM(BOTH FROM body)) > 0)) not valid;

alter table "public"."customer_notes" validate constraint "customer_notes_body_check";

alter table "public"."customer_notes" add constraint "customer_notes_section_check" CHECK ((section = ANY (ARRAY['triage'::text, 'producer'::text, 'underwriting'::text]))) not valid;

alter table "public"."customer_notes" validate constraint "customer_notes_section_check";

alter table "public"."customers" add constraint "customers_household_id_fkey" FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE SET NULL not valid;

alter table "public"."customers" validate constraint "customers_household_id_fkey";

alter table "public"."financial_accounts" add constraint "financial_accounts_commission_option_check" CHECK ((commission_option = ANY (ARRAY['A'::text, 'B'::text, 'C'::text, 'D'::text, 'E'::text, 'standard'::text]))) not valid;

alter table "public"."financial_accounts" validate constraint "financial_accounts_commission_option_check";

alter table "public"."financial_accounts" add constraint "financial_accounts_household_id_fkey" FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE not valid;

alter table "public"."financial_accounts" validate constraint "financial_accounts_household_id_fkey";

alter table "public"."financial_accounts" add constraint "financial_accounts_written_by_producer_id_fkey" FOREIGN KEY (written_by_producer_id) REFERENCES public.team_members(id) not valid;

alter table "public"."financial_accounts" validate constraint "financial_accounts_written_by_producer_id_fkey";

alter table "public"."financial_reviews" add constraint "financial_reviews_customer_id_fkey" FOREIGN KEY (customer_id) REFERENCES public.customers(id) not valid;

alter table "public"."financial_reviews" validate constraint "financial_reviews_customer_id_fkey";

alter table "public"."gdc_records" add constraint "gdc_records_producer_id_fkey" FOREIGN KEY (producer_id) REFERENCES public.producers(id) ON DELETE SET NULL not valid;

alter table "public"."gdc_records" validate constraint "gdc_records_producer_id_fkey";

alter table "public"."households" add constraint "households_assigned_producer_id_fkey" FOREIGN KEY (assigned_producer_id) REFERENCES public.team_members(id) not valid;

alter table "public"."households" validate constraint "households_assigned_producer_id_fkey";

alter table "public"."households" add constraint "households_tier_set_by_fkey" FOREIGN KEY (tier_set_by) REFERENCES public.team_members(id) not valid;

alter table "public"."households" validate constraint "households_tier_set_by_fkey";

alter table "public"."life_events" add constraint "life_events_household_id_fkey" FOREIGN KEY (household_id) REFERENCES public.households(id) not valid;

alter table "public"."life_events" validate constraint "life_events_household_id_fkey";

alter table "public"."life_events" add constraint "life_events_logged_by_fkey" FOREIGN KEY (logged_by) REFERENCES public.team_members(id) not valid;

alter table "public"."life_events" validate constraint "life_events_logged_by_fkey";

alter table "public"."platform_settings" add constraint "platform_settings_setting_key_key" UNIQUE using index "platform_settings_setting_key_key";

alter table "public"."platform_settings" add constraint "platform_settings_setting_type_check" CHECK ((setting_type = ANY (ARRAY['string'::text, 'number'::text, 'boolean'::text, 'json'::text]))) not valid;

alter table "public"."platform_settings" validate constraint "platform_settings_setting_type_check";

alter table "public"."platform_settings" add constraint "platform_settings_updated_by_fkey" FOREIGN KEY (updated_by) REFERENCES public.team_members(id) not valid;

alter table "public"."platform_settings" validate constraint "platform_settings_updated_by_fkey";

alter table "public"."policies" add constraint "policies_household_id_fkey" FOREIGN KEY (household_id) REFERENCES public.households(id) ON DELETE CASCADE not valid;

alter table "public"."policies" validate constraint "policies_household_id_fkey";

alter table "public"."policies" add constraint "policies_triage_assigned_to_fkey" FOREIGN KEY (triage_assigned_to) REFERENCES public.team_members(id) not valid;

alter table "public"."policies" validate constraint "policies_triage_assigned_to_fkey";

alter table "public"."policies" add constraint "policies_written_by_producer_id_fkey" FOREIGN KEY (written_by_producer_id) REFERENCES public.team_members(id) not valid;

alter table "public"."policies" validate constraint "policies_written_by_producer_id_fkey";

alter table "public"."producers" add constraint "producers_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE SET NULL not valid;

alter table "public"."producers" validate constraint "producers_auth_user_id_fkey";

alter table "public"."producers" add constraint "producers_auth_user_id_key" UNIQUE using index "producers_auth_user_id_key";

alter table "public"."reciprocal_referrals" add constraint "reciprocal_referrals_household_id_fkey" FOREIGN KEY (household_id) REFERENCES public.households(id) not valid;

alter table "public"."reciprocal_referrals" validate constraint "reciprocal_referrals_household_id_fkey";

alter table "public"."reciprocal_referrals" add constraint "reciprocal_referrals_referred_by_fkey" FOREIGN KEY (referred_by) REFERENCES public.team_members(id) not valid;

alter table "public"."reciprocal_referrals" validate constraint "reciprocal_referrals_referred_by_fkey";

alter table "public"."reviews" add constraint "reviews_assigned_to_fkey" FOREIGN KEY (assigned_to) REFERENCES public.team_members(id) not valid;

alter table "public"."reviews" validate constraint "reviews_assigned_to_fkey";

alter table "public"."reviews" add constraint "reviews_household_id_fkey" FOREIGN KEY (household_id) REFERENCES public.households(id) not valid;

alter table "public"."reviews" validate constraint "reviews_household_id_fkey";

alter table "public"."reviews" add constraint "reviews_policy_id_fkey" FOREIGN KEY (policy_id) REFERENCES public.policies(id) not valid;

alter table "public"."reviews" validate constraint "reviews_policy_id_fkey";

alter table "public"."reviews" add constraint "reviews_review_id_key" UNIQUE using index "reviews_review_id_key";

alter table "public"."service_policies" add constraint "service_policies_policy_number_unique" UNIQUE using index "service_policies_policy_number_unique";

alter table "public"."team_members" add constraint "team_members_access_level_check" CHECK ((access_level = ANY (ARRAY['admin'::text, 'team'::text, 'portal'::text]))) not valid;

alter table "public"."team_members" validate constraint "team_members_access_level_check";

alter table "public"."team_members" add constraint "team_members_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) not valid;

alter table "public"."team_members" validate constraint "team_members_auth_user_id_fkey";

alter table "public"."team_members" add constraint "team_members_commission_scale_check" CHECK ((commission_scale = ANY (ARRAY['A'::text, 'B'::text, 'C'::text]))) not valid;

alter table "public"."team_members" validate constraint "team_members_commission_scale_check";

alter table "public"."team_members" add constraint "team_members_email_key" UNIQUE using index "team_members_email_key";

alter table "public"."team_members" add constraint "team_members_mdrt_target_level_check" CHECK ((mdrt_target_level = ANY (ARRAY['mdrt'::text, 'cot'::text, 'tot'::text]))) not valid;

alter table "public"."team_members" validate constraint "team_members_mdrt_target_level_check";

alter table "public"."cases" add constraint "cases_lead_source_valid" CHECK ((lead_source = ANY (ARRAY['agency_referral'::text, 'allstate_web'::text, 'review_generated'::text, 'self_generated'::text, 'mortgage_protection'::text, 'term_life'::text, 'life_review'::text, 'financial_planning'::text, 'retirement_planning'::text, 'medicare_planning'::text, 'business_owner'::text, '1035_exchange'::text, 'existing_service'::text, 'existing_sales'::text, 'life_quote'::text, 'policy_review'::text, 'general'::text]))) not valid;

alter table "public"."cases" validate constraint "cases_lead_source_valid";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.calculate_case_revenue(p_producer_id uuid, p_product_category public.product_category, p_is_solo boolean, p_gdc_rate numeric, p_gdc_excess_rate numeric DEFAULT 0, p_target_premium numeric DEFAULT NULL::numeric, p_excess_premium numeric DEFAULT NULL::numeric, p_annual_premium numeric DEFAULT NULL::numeric, p_deposit_amount numeric DEFAULT NULL::numeric)
 RETURNS TABLE(est_gdc numeric, est_revenue numeric, revenue_pct numeric)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_scale         TEXT;
  v_category      TEXT;
  v_channel       TEXT;
  v_setting_key   TEXT;
  v_revenue_pct   NUMERIC;
  v_gdc           NUMERIC := 0;
BEGIN
  -- Get producer's commission scale
  SELECT commission_scale INTO v_scale
  FROM team_members WHERE id = p_producer_id;

  v_scale    := COALESCE(v_scale, 'C'); -- Default Scale C if not found
  v_category := CASE p_product_category WHEN 'life' THEN 'life' ELSE 'financial' END;
  v_channel  := CASE p_is_solo WHEN TRUE THEN 'solo' ELSE 'partnered' END;

  -- Build settings key: e.g., 'scale_C_life_partnered'
  v_setting_key := 'scale_' || v_scale || '_' || v_category || '_' || v_channel;

  -- Look up revenue percentage
  SELECT setting_value::NUMERIC INTO v_revenue_pct
  FROM platform_settings WHERE setting_key = v_setting_key;

  v_revenue_pct := COALESCE(v_revenue_pct, 0.63); -- Safety default

  -- Calculate GDC based on product type
  IF p_product_category = 'life' THEN
    IF p_target_premium IS NOT NULL THEN
      -- IUL/UL: target at full rate, excess at excess rate
      v_gdc := (p_target_premium * p_gdc_rate) +
                (COALESCE(p_excess_premium, 0) * COALESCE(p_gdc_excess_rate, 0));
    ELSIF p_annual_premium IS NOT NULL THEN
      v_gdc := p_annual_premium * p_gdc_rate;
    END IF;
  ELSE
    -- Financial: deposit amount at GDC rate
    IF p_deposit_amount IS NOT NULL THEN
      v_gdc := p_deposit_amount * p_gdc_rate;
    END IF;
  END IF;

  RETURN QUERY SELECT
    ROUND(v_gdc, 2),
    ROUND(v_gdc * v_revenue_pct, 2),
    v_revenue_pct;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_case_revenue(p_product_type public.product_type, p_gdc_rate numeric, p_gdc_excess_rate numeric, p_target_premium numeric DEFAULT NULL::numeric, p_excess_premium numeric DEFAULT NULL::numeric, p_annual_premium numeric DEFAULT NULL::numeric, p_deposit_amount numeric DEFAULT NULL::numeric)
 RETURNS TABLE(est_gdc numeric, est_revenue numeric)
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_revenue_pct NUMERIC;
  v_gdc NUMERIC := 0;
BEGIN
  SELECT setting_value::NUMERIC INTO v_revenue_pct
  FROM platform_settings WHERE setting_key = 'revenue_retention_pct';

  IF p_product_type IN ('iul', 'ul', 'wl', 'gul', 'vul') THEN
    -- Life insurance: target premium at full GDC, excess at excess rate
    IF p_target_premium IS NOT NULL THEN
      v_gdc := (p_target_premium * p_gdc_rate) +
                (COALESCE(p_excess_premium, 0) * COALESCE(p_gdc_excess_rate, 0));
    ELSIF p_annual_premium IS NOT NULL THEN
      -- No target/excess split available â€” use full premium at first-year rate
      v_gdc := p_annual_premium * p_gdc_rate;
    END IF;
  ELSIF p_product_type LIKE 'annuity%' THEN
    -- Annuity: deposit amount at GDC rate
    IF p_deposit_amount IS NOT NULL THEN
      v_gdc := p_deposit_amount * p_gdc_rate;
    END IF;
  ELSIF p_product_type = 'term' THEN
    -- Term: annual premium at GDC rate
    IF p_annual_premium IS NOT NULL THEN
      v_gdc := p_annual_premium * p_gdc_rate;
    END IF;
  END IF;

  RETURN QUERY SELECT v_gdc, v_gdc * v_revenue_pct;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.calculate_policy_priority_score(policy_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_score INTEGER := 0;
  v_net_csv NUMERIC;
  v_is_tobacco BOOLEAN;
  v_years_to_expiry INTEGER;
  v_insured_age     INTEGER;
  v_csv_threshold NUMERIC;
  v_expiry_urgent INTEGER;
BEGIN
  -- Get configurable thresholds from settings
  SELECT setting_value::NUMERIC INTO v_csv_threshold
  FROM platform_settings WHERE setting_key = 'wanderer_csv_priority_threshold';

  SELECT setting_value::INTEGER INTO v_expiry_urgent
  FROM platform_settings WHERE setting_key = 'wanderer_term_expiry_urgent_yrs';

  -- Get policy data
  SELECT
    net_csv,
    is_tobacco_rated,
    CASE WHEN expiration_date IS NULL THEN NULL
         ELSE EXTRACT(YEAR FROM AGE(expiration_date, CURRENT_DATE))::INTEGER END,
    CASE WHEN insured_date_of_birth IS NULL THEN NULL
         ELSE EXTRACT(YEAR FROM AGE(CURRENT_DATE, insured_date_of_birth))::INTEGER END
  INTO v_net_csv, v_is_tobacco, v_years_to_expiry, v_insured_age
  FROM policies
  WHERE id = policy_id;

  -- Score: 3 points for 1035 candidate ($10K+ net CSV)
  IF v_net_csv >= v_csv_threshold THEN
    v_score := v_score + 3;
  END IF;

  -- Score: 2 points for tobacco-rated
  IF v_is_tobacco THEN
    v_score := v_score + 2;
  END IF;

  -- Score: 2 points for expiring term within threshold years
  IF v_years_to_expiry IS NOT NULL AND v_years_to_expiry <= v_expiry_urgent AND v_years_to_expiry >= 0 THEN
    v_score := v_score + 2;
  END IF;

  -- Score: 1 point for SS planning window (age 58-65)
  IF v_insured_age BETWEEN 58 AND 65 THEN
    v_score := v_score + 1;
  END IF;

  -- Score: 1 point for RMD window (age 70+)
  IF v_insured_age >= 70 THEN
    v_score := v_score + 1;
  END IF;

  RETURN v_score;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_review_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.review_id := 'RV-' ||
    EXTRACT(YEAR FROM NOW())::TEXT || '-' ||
    LPAD(nextval('reviews_id_seq')::TEXT, 3, '0');
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.generate_service_request_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.request_id := 'SR-' ||
    EXTRACT(YEAR FROM NOW())::TEXT || '-' ||
    LPAD(nextval('service_requests_id_seq')::TEXT, 3, '0');
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_access_level()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT access_level FROM team_members
  WHERE auth_user_id = auth.uid()
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.get_user_agency_id()
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
  SELECT l.agency_id FROM lsps l
  WHERE l.auth_user_id = auth.uid()
  LIMIT 1;
$function$
;

CREATE OR REPLACE FUNCTION public.lookup_gdc_rate(p_carrier text, p_product_name text, p_product_type public.product_type, p_insured_age integer DEFAULT NULL::integer, p_duration_years integer DEFAULT NULL::integer)
 RETURNS TABLE(gdc_rate numeric, gdc_excess_rate numeric)
 LANGUAGE plpgsql
AS $function$
BEGIN
  RETURN QUERY
  SELECT g.gdc_first_year, g.gdc_excess
  FROM gdc_grid g
  WHERE
    g.carrier = p_carrier
    AND g.product_name = p_product_name
    AND g.is_active = TRUE
    AND (g.age_min IS NULL OR p_insured_age IS NULL OR p_insured_age >= g.age_min)
    AND (g.age_max IS NULL OR p_insured_age IS NULL OR p_insured_age <= g.age_max)
    AND (g.duration_min_years IS NULL OR p_duration_years IS NULL OR p_duration_years >= g.duration_min_years)
    AND (g.duration_max_years IS NULL OR p_duration_years IS NULL OR p_duration_years <= g.duration_max_years)
  ORDER BY g.effective_date DESC
  LIMIT 1;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.notify_tier_change()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.tier != NEW.tier THEN
    -- Log tier change in stage history (using a notification pattern)
    -- In production: trigger a Supabase edge function to notify team
    RAISE NOTICE 'TIER CHANGE: Household % moved from % to %. Reassignment may be needed.',
      NEW.id, OLD.tier, NEW.tier;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_planning_windows()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ss_start INTEGER;
  v_ss_end INTEGER;
  v_medicare INTEGER;
  v_rmd INTEGER;
BEGIN
  SELECT setting_value::INTEGER INTO v_ss_start FROM platform_settings WHERE setting_key = 'planning_window_ss_start_age';
  SELECT setting_value::INTEGER INTO v_ss_end FROM platform_settings WHERE setting_key = 'planning_window_ss_end_age';
  SELECT setting_value::INTEGER INTO v_medicare FROM platform_settings WHERE setting_key = 'planning_window_medicare_age';
  SELECT setting_value::INTEGER INTO v_rmd FROM platform_settings WHERE setting_key = 'planning_window_rmd_age';

  UPDATE households SET
    ss_planning_window_active = (EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth))::INT BETWEEN v_ss_start AND v_ss_end),
    medicare_planning_window_active = (EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth))::INT >= v_medicare),
    rmd_planning_window_active = (EXTRACT(YEAR FROM AGE(CURRENT_DATE, date_of_birth))::INT >= v_rmd);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.refresh_policy_priority_scores()
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE policies SET
    priority_score = calculate_policy_priority_score(id),
    is_1035_candidate = (net_csv >= (
      SELECT setting_value::NUMERIC FROM platform_settings
      WHERE setting_key = 'wanderer_csv_priority_threshold'
    )),
    is_tobacco_rerate_candidate = is_tobacco_rated,
    is_term_expiry_priority = (
      expiration_date IS NOT NULL AND
      EXTRACT(YEAR FROM AGE(expiration_date, CURRENT_DATE))::INTEGER <= (
        SELECT setting_value::INTEGER FROM platform_settings
        WHERE setting_key = 'wanderer_term_expiry_urgent_yrs'
      ) AND
      expiration_date > CURRENT_DATE
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_case_stage_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF OLD.status != NEW.status THEN
    NEW.stage_updated_at = NOW();
    -- Append to stage history JSONB
    NEW.stage_history = COALESCE(OLD.stage_history, '[]'::JSONB) ||
      jsonb_build_object(
        'stage', NEW.status,
        'timestamp', NOW(),
        'previous', OLD.status
      );
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  claims  jsonb;
  member  record;
begin
  select agency_id
    into member
    from public.agency_members
   where user_id = (event ->> 'user_id')::uuid
   limit 1;

  claims := event -> 'claims';

  if member.agency_id is not null then
    claims := jsonb_set(claims, '{agency_id}', to_jsonb(member.agency_id));
    claims := jsonb_set(claims, '{app_role}',  '"agency"');
  else
    claims := jsonb_set(claims, '{agency_id}', 'null');
    claims := jsonb_set(claims, '{app_role}',  '"admin"');
  end if;

  return jsonb_set(event, '{claims}', claims);
end;
$function$
;

grant delete on table "public"."agency_visits" to "anon";

grant insert on table "public"."agency_visits" to "anon";

grant references on table "public"."agency_visits" to "anon";

grant select on table "public"."agency_visits" to "anon";

grant trigger on table "public"."agency_visits" to "anon";

grant truncate on table "public"."agency_visits" to "anon";

grant update on table "public"."agency_visits" to "anon";

grant delete on table "public"."agency_visits" to "authenticated";

grant insert on table "public"."agency_visits" to "authenticated";

grant references on table "public"."agency_visits" to "authenticated";

grant select on table "public"."agency_visits" to "authenticated";

grant trigger on table "public"."agency_visits" to "authenticated";

grant truncate on table "public"."agency_visits" to "authenticated";

grant update on table "public"."agency_visits" to "authenticated";

grant delete on table "public"."agency_visits" to "service_role";

grant insert on table "public"."agency_visits" to "service_role";

grant references on table "public"."agency_visits" to "service_role";

grant select on table "public"."agency_visits" to "service_role";

grant trigger on table "public"."agency_visits" to "service_role";

grant truncate on table "public"."agency_visits" to "service_role";

grant update on table "public"."agency_visits" to "service_role";

grant delete on table "public"."appointments" to "anon";

grant insert on table "public"."appointments" to "anon";

grant references on table "public"."appointments" to "anon";

grant select on table "public"."appointments" to "anon";

grant trigger on table "public"."appointments" to "anon";

grant truncate on table "public"."appointments" to "anon";

grant update on table "public"."appointments" to "anon";

grant delete on table "public"."appointments" to "authenticated";

grant insert on table "public"."appointments" to "authenticated";

grant references on table "public"."appointments" to "authenticated";

grant select on table "public"."appointments" to "authenticated";

grant trigger on table "public"."appointments" to "authenticated";

grant truncate on table "public"."appointments" to "authenticated";

grant update on table "public"."appointments" to "authenticated";

grant delete on table "public"."appointments" to "service_role";

grant insert on table "public"."appointments" to "service_role";

grant references on table "public"."appointments" to "service_role";

grant select on table "public"."appointments" to "service_role";

grant trigger on table "public"."appointments" to "service_role";

grant truncate on table "public"."appointments" to "service_role";

grant update on table "public"."appointments" to "service_role";

grant delete on table "public"."client_deliverables" to "anon";

grant insert on table "public"."client_deliverables" to "anon";

grant references on table "public"."client_deliverables" to "anon";

grant select on table "public"."client_deliverables" to "anon";

grant trigger on table "public"."client_deliverables" to "anon";

grant truncate on table "public"."client_deliverables" to "anon";

grant update on table "public"."client_deliverables" to "anon";

grant delete on table "public"."client_deliverables" to "authenticated";

grant insert on table "public"."client_deliverables" to "authenticated";

grant references on table "public"."client_deliverables" to "authenticated";

grant select on table "public"."client_deliverables" to "authenticated";

grant trigger on table "public"."client_deliverables" to "authenticated";

grant truncate on table "public"."client_deliverables" to "authenticated";

grant update on table "public"."client_deliverables" to "authenticated";

grant delete on table "public"."client_deliverables" to "service_role";

grant insert on table "public"."client_deliverables" to "service_role";

grant references on table "public"."client_deliverables" to "service_role";

grant select on table "public"."client_deliverables" to "service_role";

grant trigger on table "public"."client_deliverables" to "service_role";

grant truncate on table "public"."client_deliverables" to "service_role";

grant update on table "public"."client_deliverables" to "service_role";

grant delete on table "public"."compliance_records" to "anon";

grant insert on table "public"."compliance_records" to "anon";

grant references on table "public"."compliance_records" to "anon";

grant select on table "public"."compliance_records" to "anon";

grant trigger on table "public"."compliance_records" to "anon";

grant truncate on table "public"."compliance_records" to "anon";

grant update on table "public"."compliance_records" to "anon";

grant delete on table "public"."compliance_records" to "authenticated";

grant insert on table "public"."compliance_records" to "authenticated";

grant references on table "public"."compliance_records" to "authenticated";

grant select on table "public"."compliance_records" to "authenticated";

grant trigger on table "public"."compliance_records" to "authenticated";

grant truncate on table "public"."compliance_records" to "authenticated";

grant update on table "public"."compliance_records" to "authenticated";

grant delete on table "public"."compliance_records" to "service_role";

grant insert on table "public"."compliance_records" to "service_role";

grant references on table "public"."compliance_records" to "service_role";

grant select on table "public"."compliance_records" to "service_role";

grant trigger on table "public"."compliance_records" to "service_role";

grant truncate on table "public"."compliance_records" to "service_role";

grant update on table "public"."compliance_records" to "service_role";

grant delete on table "public"."financial_accounts" to "anon";

grant insert on table "public"."financial_accounts" to "anon";

grant references on table "public"."financial_accounts" to "anon";

grant select on table "public"."financial_accounts" to "anon";

grant trigger on table "public"."financial_accounts" to "anon";

grant truncate on table "public"."financial_accounts" to "anon";

grant update on table "public"."financial_accounts" to "anon";

grant delete on table "public"."financial_accounts" to "authenticated";

grant insert on table "public"."financial_accounts" to "authenticated";

grant references on table "public"."financial_accounts" to "authenticated";

grant select on table "public"."financial_accounts" to "authenticated";

grant trigger on table "public"."financial_accounts" to "authenticated";

grant truncate on table "public"."financial_accounts" to "authenticated";

grant update on table "public"."financial_accounts" to "authenticated";

grant delete on table "public"."financial_accounts" to "service_role";

grant insert on table "public"."financial_accounts" to "service_role";

grant references on table "public"."financial_accounts" to "service_role";

grant select on table "public"."financial_accounts" to "service_role";

grant trigger on table "public"."financial_accounts" to "service_role";

grant truncate on table "public"."financial_accounts" to "service_role";

grant update on table "public"."financial_accounts" to "service_role";

grant delete on table "public"."financial_reviews" to "anon";

grant insert on table "public"."financial_reviews" to "anon";

grant references on table "public"."financial_reviews" to "anon";

grant select on table "public"."financial_reviews" to "anon";

grant trigger on table "public"."financial_reviews" to "anon";

grant truncate on table "public"."financial_reviews" to "anon";

grant update on table "public"."financial_reviews" to "anon";

grant delete on table "public"."financial_reviews" to "authenticated";

grant insert on table "public"."financial_reviews" to "authenticated";

grant references on table "public"."financial_reviews" to "authenticated";

grant select on table "public"."financial_reviews" to "authenticated";

grant trigger on table "public"."financial_reviews" to "authenticated";

grant truncate on table "public"."financial_reviews" to "authenticated";

grant update on table "public"."financial_reviews" to "authenticated";

grant delete on table "public"."financial_reviews" to "service_role";

grant insert on table "public"."financial_reviews" to "service_role";

grant references on table "public"."financial_reviews" to "service_role";

grant select on table "public"."financial_reviews" to "service_role";

grant trigger on table "public"."financial_reviews" to "service_role";

grant truncate on table "public"."financial_reviews" to "service_role";

grant update on table "public"."financial_reviews" to "service_role";

grant delete on table "public"."gdc_grid" to "anon";

grant insert on table "public"."gdc_grid" to "anon";

grant references on table "public"."gdc_grid" to "anon";

grant select on table "public"."gdc_grid" to "anon";

grant trigger on table "public"."gdc_grid" to "anon";

grant truncate on table "public"."gdc_grid" to "anon";

grant update on table "public"."gdc_grid" to "anon";

grant delete on table "public"."gdc_grid" to "authenticated";

grant insert on table "public"."gdc_grid" to "authenticated";

grant references on table "public"."gdc_grid" to "authenticated";

grant select on table "public"."gdc_grid" to "authenticated";

grant trigger on table "public"."gdc_grid" to "authenticated";

grant truncate on table "public"."gdc_grid" to "authenticated";

grant update on table "public"."gdc_grid" to "authenticated";

grant delete on table "public"."gdc_grid" to "service_role";

grant insert on table "public"."gdc_grid" to "service_role";

grant references on table "public"."gdc_grid" to "service_role";

grant select on table "public"."gdc_grid" to "service_role";

grant trigger on table "public"."gdc_grid" to "service_role";

grant truncate on table "public"."gdc_grid" to "service_role";

grant update on table "public"."gdc_grid" to "service_role";

grant delete on table "public"."households" to "anon";

grant insert on table "public"."households" to "anon";

grant references on table "public"."households" to "anon";

grant select on table "public"."households" to "anon";

grant trigger on table "public"."households" to "anon";

grant truncate on table "public"."households" to "anon";

grant update on table "public"."households" to "anon";

grant delete on table "public"."households" to "authenticated";

grant insert on table "public"."households" to "authenticated";

grant references on table "public"."households" to "authenticated";

grant select on table "public"."households" to "authenticated";

grant trigger on table "public"."households" to "authenticated";

grant truncate on table "public"."households" to "authenticated";

grant update on table "public"."households" to "authenticated";

grant delete on table "public"."households" to "service_role";

grant insert on table "public"."households" to "service_role";

grant references on table "public"."households" to "service_role";

grant select on table "public"."households" to "service_role";

grant trigger on table "public"."households" to "service_role";

grant truncate on table "public"."households" to "service_role";

grant update on table "public"."households" to "service_role";

grant delete on table "public"."life_events" to "anon";

grant insert on table "public"."life_events" to "anon";

grant references on table "public"."life_events" to "anon";

grant select on table "public"."life_events" to "anon";

grant trigger on table "public"."life_events" to "anon";

grant truncate on table "public"."life_events" to "anon";

grant update on table "public"."life_events" to "anon";

grant delete on table "public"."life_events" to "authenticated";

grant insert on table "public"."life_events" to "authenticated";

grant references on table "public"."life_events" to "authenticated";

grant select on table "public"."life_events" to "authenticated";

grant trigger on table "public"."life_events" to "authenticated";

grant truncate on table "public"."life_events" to "authenticated";

grant update on table "public"."life_events" to "authenticated";

grant delete on table "public"."life_events" to "service_role";

grant insert on table "public"."life_events" to "service_role";

grant references on table "public"."life_events" to "service_role";

grant select on table "public"."life_events" to "service_role";

grant trigger on table "public"."life_events" to "service_role";

grant truncate on table "public"."life_events" to "service_role";

grant update on table "public"."life_events" to "service_role";

grant delete on table "public"."notifications" to "anon";

grant insert on table "public"."notifications" to "anon";

grant references on table "public"."notifications" to "anon";

grant select on table "public"."notifications" to "anon";

grant trigger on table "public"."notifications" to "anon";

grant truncate on table "public"."notifications" to "anon";

grant update on table "public"."notifications" to "anon";

grant delete on table "public"."notifications" to "authenticated";

grant insert on table "public"."notifications" to "authenticated";

grant references on table "public"."notifications" to "authenticated";

grant select on table "public"."notifications" to "authenticated";

grant trigger on table "public"."notifications" to "authenticated";

grant truncate on table "public"."notifications" to "authenticated";

grant update on table "public"."notifications" to "authenticated";

grant delete on table "public"."notifications" to "service_role";

grant insert on table "public"."notifications" to "service_role";

grant references on table "public"."notifications" to "service_role";

grant select on table "public"."notifications" to "service_role";

grant trigger on table "public"."notifications" to "service_role";

grant truncate on table "public"."notifications" to "service_role";

grant update on table "public"."notifications" to "service_role";

grant delete on table "public"."platform_settings" to "anon";

grant insert on table "public"."platform_settings" to "anon";

grant references on table "public"."platform_settings" to "anon";

grant select on table "public"."platform_settings" to "anon";

grant trigger on table "public"."platform_settings" to "anon";

grant truncate on table "public"."platform_settings" to "anon";

grant update on table "public"."platform_settings" to "anon";

grant delete on table "public"."platform_settings" to "authenticated";

grant insert on table "public"."platform_settings" to "authenticated";

grant references on table "public"."platform_settings" to "authenticated";

grant select on table "public"."platform_settings" to "authenticated";

grant trigger on table "public"."platform_settings" to "authenticated";

grant truncate on table "public"."platform_settings" to "authenticated";

grant update on table "public"."platform_settings" to "authenticated";

grant delete on table "public"."platform_settings" to "service_role";

grant insert on table "public"."platform_settings" to "service_role";

grant references on table "public"."platform_settings" to "service_role";

grant select on table "public"."platform_settings" to "service_role";

grant trigger on table "public"."platform_settings" to "service_role";

grant truncate on table "public"."platform_settings" to "service_role";

grant update on table "public"."platform_settings" to "service_role";

grant delete on table "public"."policies" to "anon";

grant insert on table "public"."policies" to "anon";

grant references on table "public"."policies" to "anon";

grant select on table "public"."policies" to "anon";

grant trigger on table "public"."policies" to "anon";

grant truncate on table "public"."policies" to "anon";

grant update on table "public"."policies" to "anon";

grant delete on table "public"."policies" to "authenticated";

grant insert on table "public"."policies" to "authenticated";

grant references on table "public"."policies" to "authenticated";

grant select on table "public"."policies" to "authenticated";

grant trigger on table "public"."policies" to "authenticated";

grant truncate on table "public"."policies" to "authenticated";

grant update on table "public"."policies" to "authenticated";

grant delete on table "public"."policies" to "service_role";

grant insert on table "public"."policies" to "service_role";

grant references on table "public"."policies" to "service_role";

grant select on table "public"."policies" to "service_role";

grant trigger on table "public"."policies" to "service_role";

grant truncate on table "public"."policies" to "service_role";

grant update on table "public"."policies" to "service_role";

grant delete on table "public"."reciprocal_referrals" to "anon";

grant insert on table "public"."reciprocal_referrals" to "anon";

grant references on table "public"."reciprocal_referrals" to "anon";

grant select on table "public"."reciprocal_referrals" to "anon";

grant trigger on table "public"."reciprocal_referrals" to "anon";

grant truncate on table "public"."reciprocal_referrals" to "anon";

grant update on table "public"."reciprocal_referrals" to "anon";

grant delete on table "public"."reciprocal_referrals" to "authenticated";

grant insert on table "public"."reciprocal_referrals" to "authenticated";

grant references on table "public"."reciprocal_referrals" to "authenticated";

grant select on table "public"."reciprocal_referrals" to "authenticated";

grant trigger on table "public"."reciprocal_referrals" to "authenticated";

grant truncate on table "public"."reciprocal_referrals" to "authenticated";

grant update on table "public"."reciprocal_referrals" to "authenticated";

grant delete on table "public"."reciprocal_referrals" to "service_role";

grant insert on table "public"."reciprocal_referrals" to "service_role";

grant references on table "public"."reciprocal_referrals" to "service_role";

grant select on table "public"."reciprocal_referrals" to "service_role";

grant trigger on table "public"."reciprocal_referrals" to "service_role";

grant truncate on table "public"."reciprocal_referrals" to "service_role";

grant update on table "public"."reciprocal_referrals" to "service_role";

grant delete on table "public"."reviews" to "anon";

grant insert on table "public"."reviews" to "anon";

grant references on table "public"."reviews" to "anon";

grant select on table "public"."reviews" to "anon";

grant trigger on table "public"."reviews" to "anon";

grant truncate on table "public"."reviews" to "anon";

grant update on table "public"."reviews" to "anon";

grant delete on table "public"."reviews" to "authenticated";

grant insert on table "public"."reviews" to "authenticated";

grant references on table "public"."reviews" to "authenticated";

grant select on table "public"."reviews" to "authenticated";

grant trigger on table "public"."reviews" to "authenticated";

grant truncate on table "public"."reviews" to "authenticated";

grant update on table "public"."reviews" to "authenticated";

grant delete on table "public"."reviews" to "service_role";

grant insert on table "public"."reviews" to "service_role";

grant references on table "public"."reviews" to "service_role";

grant select on table "public"."reviews" to "service_role";

grant trigger on table "public"."reviews" to "service_role";

grant truncate on table "public"."reviews" to "service_role";

grant update on table "public"."reviews" to "service_role";

grant delete on table "public"."team_members" to "anon";

grant insert on table "public"."team_members" to "anon";

grant references on table "public"."team_members" to "anon";

grant select on table "public"."team_members" to "anon";

grant trigger on table "public"."team_members" to "anon";

grant truncate on table "public"."team_members" to "anon";

grant update on table "public"."team_members" to "anon";

grant delete on table "public"."team_members" to "authenticated";

grant insert on table "public"."team_members" to "authenticated";

grant references on table "public"."team_members" to "authenticated";

grant select on table "public"."team_members" to "authenticated";

grant trigger on table "public"."team_members" to "authenticated";

grant truncate on table "public"."team_members" to "authenticated";

grant update on table "public"."team_members" to "authenticated";

grant delete on table "public"."team_members" to "service_role";

grant insert on table "public"."team_members" to "service_role";

grant references on table "public"."team_members" to "service_role";

grant select on table "public"."team_members" to "service_role";

grant trigger on table "public"."team_members" to "service_role";

grant truncate on table "public"."team_members" to "service_role";

grant update on table "public"."team_members" to "service_role";


  create policy "admin_team_agency_visits"
  on "public"."agency_visits"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "team_all_appointments"
  on "public"."appointments"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "admin_team_deliverables"
  on "public"."client_deliverables"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "admin_write_compliance"
  on "public"."compliance_records"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = 'admin'::text));



  create policy "team_read_compliance"
  on "public"."compliance_records"
  as permissive
  for select
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "admin_team_financial_accounts"
  on "public"."financial_accounts"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "admin_write_gdc"
  on "public"."gdc_grid"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = 'admin'::text));



  create policy "team_read_gdc"
  on "public"."gdc_grid"
  as permissive
  for select
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "admin_team_households"
  on "public"."households"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "admin_team_life_events"
  on "public"."life_events"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "admin_write_settings"
  on "public"."platform_settings"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = 'admin'::text));



  create policy "team_read_settings"
  on "public"."platform_settings"
  as permissive
  for select
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "admin_team_policies"
  on "public"."policies"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "admin_team_reciprocal"
  on "public"."reciprocal_referrals"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "team_all_reviews"
  on "public"."reviews"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = ANY (ARRAY['admin'::text, 'team'::text])));



  create policy "admin_write_team_members"
  on "public"."team_members"
  as permissive
  for all
  to public
using ((public.get_user_access_level() = 'admin'::text));



  create policy "team_read_own_member"
  on "public"."team_members"
  as permissive
  for select
  to public
using (((auth_user_id = auth.uid()) OR (public.get_user_access_level() = 'admin'::text)));



  create policy "agencies_agency_select"
  on "public"."agencies"
  as permissive
  for select
  to authenticated
using ((public.jwt_is_admin() OR ((id = public.jwt_agency_id()) AND (is_test = false))));


CREATE TRIGGER trg_appointments_updated_at BEFORE UPDATE ON public.appointments FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_compliance_records_updated_at BEFORE UPDATE ON public.compliance_records FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_financial_accounts_updated_at BEFORE UPDATE ON public.financial_accounts FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_household_tier_change AFTER UPDATE OF tier ON public.households FOR EACH ROW EXECUTE FUNCTION public.notify_tier_change();

CREATE TRIGGER trg_households_updated_at BEFORE UPDATE ON public.households FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_policies_updated_at BEFORE UPDATE ON public.policies FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_generate_review_id BEFORE INSERT ON public.reviews FOR EACH ROW WHEN (((new.review_id IS NULL) OR (new.review_id = ''::text))) EXECUTE FUNCTION public.generate_review_id();

CREATE TRIGGER trg_reviews_updated_at BEFORE UPDATE ON public.reviews FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER trg_team_members_updated_at BEFORE UPDATE ON public.team_members FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();


