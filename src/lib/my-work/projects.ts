/**
 * MY PROJECTS composition (server-only) — Right Path.
 *
 * Shows the projects the signed-in employee PARTICIPATES in, even when nothing
 * currently requires their attention. For each project it preserves visibility
 * into progress, the responsible people, and bottlenecks — WITHOUT implying that
 * a participant performs every activity. Participation, ownership, and
 * escalation are kept distinct (participation drives this list; escalation is
 * shown separately as the exception path).
 *
 * Reads existing records only: project_participants (membership),
 * project_escalation_contacts (ordered exception path), and the derived 1035
 * workflow (buildProjectWorkflow / summarizeWorkflow) for progress + the current
 * bottleneck. No task database; no duplication of customer activities.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { resolveProducerForUser } from '@/lib/capabilities/resolve'
import { buildProjectWorkflow, summarizeWorkflow, type WorkflowStage } from '@/lib/projects/review-1035'
import { projectHasWorkflow } from '@/lib/projects/workflows'
import { STAGE_LABEL } from '@/lib/my-work/project-labels'

// Re-export so existing server importers of STAGE_LABEL keep working. The
// client imports it from '@/lib/my-work/project-labels' directly (that module
// has no server-only dependency), so STAGE_LABEL no longer drags this
// server-only composition into the client bundle.
export { STAGE_LABEL }

/** One participant or escalation contact, for the "responsible people" view. */
export interface ProjectPerson {
  producerId: string
  name: string
  /** Participation note, or the escalation tier note. */
  note: string | null
  /** The participant's project responsibility (owner, operations_manager, ...).
   * This is a PROJECT responsibility, kept distinct from the producer's job
   * title, their licensing facts, and their routing/capability assignments. */
  role?: string | null
  /** The producer's life-license FACT (a qualification, NOT a responsibility):
   * true = affirmatively held, false = affirmatively not, null = unknown. Shown
   * as a small annotation beside the responsibility, never merged into it. */
  isLifeLicensed?: boolean | null
  /** Set for escalation contacts: 1 = first destination. */
  tier?: number
}

/** The progress + bottleneck summary for a project the employee is in. */
export interface MyProjectCard {
  projectId: string
  name: string
  projectType: string
  status: 'active' | 'completed' | 'archived'
  /** This employee's participation note on the project. */
  myNote: string | null
  /** Total customers in the project. */
  totalCustomers: number
  /** Per-stage counts (progress), from the derived workflow. */
  stageCounts: Record<WorkflowStage, number>
  /** The current bottleneck: the active stage holding the most customers. */
  bottleneck: { stage: WorkflowStage; label: string; count: number } | null
  /** Everyone who participates (not just this employee). */
  participants: ProjectPerson[]
  /** The project owner / operations manager, when recorded (role = 'owner'). */
  owner: ProjectPerson | null
  /** The ordered escalation path for operational exceptions (tier 1 first). */
  escalation: ProjectPerson[]
  /** Route to the project detail / working interface. */
  route: string
  reviewRoute: string | null
}

export interface MyProjectsState {
  employeeName: string | null
  noProfile: boolean
  projects: MyProjectCard[]
}

/** The active (non-terminal) stages that can represent a bottleneck. */
const ACTIVE_STAGES: WorkflowStage[] = ['stewardship', 'operations_prep', 'bob_evaluation']

type ParticipantRow = { producer_id: string; note: string | null; role: string | null; producers: { first_name: string | null; last_name: string | null; is_life_licensed: boolean | null } }
type EscalationRow = { producer_id: string; tier: number; note: string | null; producers: { first_name: string | null; last_name: string | null } }

export async function getMyProjects(authUserId: string): Promise<MyProjectsState> {
  const supabase = createAdminClient()
  const producer = await resolveProducerForUser(authUserId)
  if (!producer) {
    return { employeeName: null, noProfile: true, projects: [] }
  }

  // Projects this employee participates in.
  const { data: myMemberships } = await supabase
    .from('project_participants')
    .select('project_id, note')
    .eq('producer_id', producer.id)

  const myProjectIds = (myMemberships ?? []).map((m: { project_id: string }) => m.project_id)
  if (myProjectIds.length === 0) {
    return {
      employeeName: `${producer.first_name ?? ''} ${producer.last_name ?? ''}`.trim() || null,
      noProfile: false,
      projects: [],
    }
  }
  const myNoteByProject = new Map(
    (myMemberships ?? []).map((m: { project_id: string; note: string | null }) => [m.project_id, m.note]),
  )

  // Project headers.
  const { data: projRows } = await supabase
    .from('projects')
    .select('id, name, status, project_types ( name )')
    .in('id', myProjectIds)
    .order('created_at', { ascending: false })

  // All participants + escalation for these projects, in one read each.
  const [{ data: allParticipants }, { data: allEscalation }] = await Promise.all([
    supabase
      .from('project_participants')
      .select('project_id, producer_id, note, role, producers ( first_name, last_name, is_life_licensed )')
      .in('project_id', myProjectIds),
    supabase
      .from('project_escalation_contacts')
      .select('project_id, producer_id, tier, note, producers ( first_name, last_name )')
      .in('project_id', myProjectIds)
      .order('tier', { ascending: true }),
  ])

  const participantsByProject = new Map<string, ProjectPerson[]>()
  for (const p of (allParticipants ?? []) as unknown as (ParticipantRow & { project_id: string })[]) {
    const list = participantsByProject.get(p.project_id) ?? []
    list.push({
      producerId: p.producer_id,
      name: `${p.producers?.first_name ?? ''} ${p.producers?.last_name ?? ''}`.trim() || 'Team member',
      note: p.note,
      role: p.role,
      isLifeLicensed: p.producers?.is_life_licensed ?? null,
    })
    participantsByProject.set(p.project_id, list)
  }

  const escalationByProject = new Map<string, ProjectPerson[]>()
  for (const e of (allEscalation ?? []) as unknown as (EscalationRow & { project_id: string })[]) {
    const list = escalationByProject.get(e.project_id) ?? []
    list.push({
      producerId: e.producer_id,
      name: `${e.producers?.first_name ?? ''} ${e.producers?.last_name ?? ''}`.trim() || 'Team member',
      note: e.note,
      tier: e.tier,
    })
    escalationByProject.set(e.project_id, list)
  }

  const projects: MyProjectCard[] = []
  for (const pr of (projRows ?? []) as unknown as {
    id: string
    name: string
    status: string
    project_types: { name: string } | { name: string }[] | null
  }[]) {
    const pt = Array.isArray(pr.project_types) ? pr.project_types[0] : pr.project_types
    const projectType = pt?.name ?? ''
    // Whether this project runs the derived review workflow is decided by the
    // WORKFLOW WIRING (does it contain review_preparation?), not the type name.
    // Fallback (pre-migration): the prior /1035/ type-name test, so behavior is
    // unchanged until the migration lands. No records are created here.
    const hasReviewWorkflow = await projectHasWorkflow(
      supabase, pr.id, 'review_preparation', /1035/.test(projectType),
    )

    // Progress + bottleneck from the derived project workflow (the SAME read the
    // project surface uses). For projects without the review workflow the
    // derived stage model does not apply; show totals only.
    let stageCounts: Record<WorkflowStage, number> = {
      stewardship: 0, operations_prep: 0, bob_evaluation: 0, ready_for_outreach: 0, complete: 0,
    }
    let total = 0
    if (hasReviewWorkflow) {
      const workflow = await buildProjectWorkflow(supabase, pr.id)
      const summary = summarizeWorkflow(workflow)
      stageCounts = summary.by
      total = summary.total
    } else {
      const { count } = await supabase
        .from('project_customers')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', pr.id)
      total = count ?? 0
    }

    // The bottleneck is the active stage holding the most customers.
    let bottleneck: MyProjectCard['bottleneck'] = null
    for (const stage of ACTIVE_STAGES) {
      const count = stageCounts[stage]
      if (count > 0 && (!bottleneck || count > bottleneck.count)) {
        bottleneck = { stage, label: STAGE_LABEL[stage], count }
      }
    }

    projects.push({
      projectId: pr.id,
      name: pr.name,
      projectType,
      status: pr.status as MyProjectCard['status'],
      myNote: myNoteByProject.get(pr.id) ?? null,
      totalCustomers: total,
      stageCounts,
      bottleneck,
      participants: participantsByProject.get(pr.id) ?? [],
      owner: (participantsByProject.get(pr.id) ?? []).find((x) => x.role === 'owner') ?? null,
      escalation: escalationByProject.get(pr.id) ?? [],
      route: `/projects/${pr.id}`,
      reviewRoute: hasReviewWorkflow && pr.status !== 'archived' ? `/projects/${pr.id}/review` : null,
    })
  }

  return {
    employeeName: `${producer.first_name ?? ''} ${producer.last_name ?? ''}`.trim() || null,
    noProfile: false,
    projects,
  }
}
