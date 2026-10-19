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
import { projectHasWorkflow, isPermanentPolicyReviewTypeName } from '@/lib/projects/workflows'
import { getProjectTeam, type ProjectPerson } from '@/lib/projects/team'
import { STAGE_LABEL } from '@/lib/my-work/project-labels'

// Re-export so existing server importers of STAGE_LABEL keep working. The
// client imports it from '@/lib/my-work/project-labels' directly (that module
// has no server-only dependency), so STAGE_LABEL no longer drags this
// server-only composition into the client bundle.
export { STAGE_LABEL }

// The project team shape lives in the shared team module (the single reader /
// writer of project_participants + project_escalation_contacts). Re-exported
// here so existing importers of ProjectPerson keep working.
export type { ProjectPerson }

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

  // Team (participants + ordered escalation) for each project, read through the
  // shared team module so this view and the Project Overview Team section agree.
  const participantsByProject = new Map<string, ProjectPerson[]>()
  const escalationByProject = new Map<string, ProjectPerson[]>()
  await Promise.all(
    myProjectIds.map(async (pid) => {
      const team = await getProjectTeam(supabase, pid)
      participantsByProject.set(pid, team.participants)
      escalationByProject.set(pid, team.escalation)
    }),
  )

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
    // Fallback (pre-migration): the prior type-name test (now matching the
    // renamed "Permanent Policy Review" type as well as the legacy "1035" name),
    // so behavior is unchanged until the migration lands. No records created.
    const hasReviewWorkflow = await projectHasWorkflow(
      supabase, pr.id, 'review_preparation', isPermanentPolicyReviewTypeName(projectType),
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
