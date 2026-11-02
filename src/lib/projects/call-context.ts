/**
 * Call-context resolver (server-safe reads) — Right Path.
 *
 * The guided outbound call PANEL (OutreachCallPanel) is one reusable Lego panel.
 * What differs from one situation to the next is a small bundle of CONTENT: the
 * REASON the purple cap reveals ("why you're calling, on this workflow"), the
 * opening TALK PATH, and the MENTORING prose. This module resolves that bundle
 * for the situation a customer is actually in — the (project type, current
 * phase) coordinate — from the project_workflow_call_context catalog, and fills
 * the caller/customer identity exactly as the panel does today.
 *
 * Division of labor, unchanged: this is CONTENT resolution only. Which phase a
 * customer is in (resolveCurrentPhase) and whether they may advance
 * (completion_mode) are decided elsewhere; ZEN still owns the judgment calls.
 * This module turns the resolved coordinate into the words the panel renders.
 *
 * Fallback contract: when the catalog has no row for a coordinate, this returns
 * the BUILT-IN DEFAULT (the servicing-agent wording the panel shipped with), so
 * a situation not yet in the catalog never regresses — it reads exactly as it
 * does today.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { SERVICING_CALL_SCRIPTS, interpolate } from '@/lib/templates'

/** A talk-path script key the catalog may name. Mirrors SERVICING_CALL_SCRIPTS. */
export type TalkPathScriptKey = keyof typeof SERVICING_CALL_SCRIPTS

/** The resolved content the call panel's Legos consume. */
export interface CallContextContent {
  /** The purple-cap "why you're calling" reason, identity filled. */
  reason: string
  /** The opening talk path to read, caller/customer identity filled. */
  talkPath: string
  /** Optional coaching prose shown as Mentoring; null when none. */
  mentoring: string | null
  /** True when this came from the catalog; false when the built-in default was
   * used (no catalog row for the coordinate). Presentation/diagnostics only. */
  fromCatalog: boolean
}

/** The identity tokens the content is filled with, matching the panel. */
export interface CallContextIdentity {
  /** The customer's first name, or null when unknown. */
  firstName: string | null
  /** The signed-in caller's first name; falls back to "our office". */
  senderName: string | null
  /** The caller's callback number for scripts that state it; may be empty. */
  callbackPhone: string | null
}

/**
 * The built-in default content — the servicing-agent outreach wording the panel
 * shipped with (OutreachCallPanel.callMentorBody + the 'opening' script). Used
 * when the catalog has no row for the coordinate, so uncatalogued situations
 * read exactly as today. Kept here, beside the resolver, as the single default.
 */
const DEFAULT_REASON =
  "Our office lost access to {first_name}\u2019s life insurance policy when Allstate\u2019s life business " +
  'moved to Everlake, because we are not listed as the servicing agent. The servicing-agent ' +
  'authorization simply restores our access to help with questions and servicing. It does not ' +
  'change the policy or coverage, and it needs a wet (ink) signature.'

interface CallContextRow {
  reason_body: string
  talk_path_script_key: string
  mentoring_body: string | null
}

/**
 * Fill the identity tokens into a body/script. {first_name} falls back to a
 * neutral "the customer"/"there" rather than printing a raw placeholder, and
 * {sender_name}/{phone} fall back the same way the panel does.
 */
function fill(
  template: string,
  identity: CallContextIdentity,
  opts?: { neutralFirstName?: string },
): string {
  return interpolate(template, {
    first_name: identity.firstName ?? (opts?.neutralFirstName ?? 'the customer'),
    sender_name: identity.senderName ?? 'our office',
    phone: identity.callbackPhone ?? '',
  })
}

/**
 * Resolve the talk path for a script key, interpolated. Falls back to the
 * 'opening' script when the key is not one the app owns, so a stale/misspelled
 * catalog key can never blank the talk path.
 */
function resolveTalkPath(scriptKey: string, identity: CallContextIdentity): string {
  const script =
    (scriptKey in SERVICING_CALL_SCRIPTS)
      ? SERVICING_CALL_SCRIPTS[scriptKey as TalkPathScriptKey]
      : SERVICING_CALL_SCRIPTS.opening
  // The opening talk track reads cleanly with "there" when the first name is
  // unknown, matching callOpeningScript in the panel.
  return fill(script.body, identity, { neutralFirstName: 'there' })
}

/** The built-in default bundle, identity filled. */
function defaultContent(identity: CallContextIdentity): CallContextContent {
  return {
    reason: fill(DEFAULT_REASON, identity),
    talkPath: resolveTalkPath('opening', identity),
    mentoring: null,
    fromCatalog: false,
  }
}

/**
 * Resolve the call-context content for a (project type, phase) coordinate.
 *
 * Reads the single catalog row keyed by (projectTypeId, workflowId). When a row
 * exists, its reason/mentoring bodies and named talk-path script are filled with
 * the identity and returned. When no row exists — or the catalog table is not
 * present on this environment yet, or the read errors — the built-in default is
 * returned, so the panel always has usable content and a pre-migration
 * environment is never broken.
 *
 * `workflowId` is null when the customer has no current phase (finished the
 * spine); the default is returned in that case too.
 */
export async function resolveCallContext(
  supabase: SupabaseClient,
  args: {
    projectTypeId: string | null
    workflowId: string | null
    identity: CallContextIdentity
  },
): Promise<CallContextContent> {
  const { projectTypeId, workflowId, identity } = args
  if (!projectTypeId || !workflowId) return defaultContent(identity)

  const { data, error } = await supabase
    .from('project_workflow_call_context')
    .select('reason_body, talk_path_script_key, mentoring_body')
    .eq('project_type_id', projectTypeId)
    .eq('workflow_id', workflowId)
    .limit(1)
    .maybeSingle()

  // Table absent (unmigrated), read error, or no catalog row: built-in default.
  if (error || !data) return defaultContent(identity)

  const row = data as CallContextRow
  return {
    reason: fill(row.reason_body, identity),
    talkPath: resolveTalkPath(row.talk_path_script_key, identity),
    mentoring: row.mentoring_body ? fill(row.mentoring_body, identity) : null,
    fromCatalog: true,
  }
}
