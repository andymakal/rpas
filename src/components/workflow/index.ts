/**
 * Right Path workflow design system — shared components for operator-facing
 * workflow UI. See .kiro/steering/workflow-visual-rules.md for the standard
 * these implement. Built on Tailwind and shadcn underneath.
 */

export {
  WorkflowSurface,
  WORKFLOW_MAX_WIDTH,
  WorkflowPage,
  WorkflowPageHeader,
  WorkflowTitle,
  WorkflowBackLink,
  OperationalTag,
  type OperationalTone,
  FieldStatusDot,
  type FieldStatusTone,
  TaskShell,
  ContextLabel,
  ActionPanel,
  PrimaryAction,
  WorkflowButton,
  NextNote,
  ExternalActionConfirm,
  SpokenScriptCard,
} from './primitives'

export {
  QueueSection,
  QueueRow,
  QueueListHeader,
  CustomerQueueCard,
  QueueEmptyState,
} from './queues'

export {
  ContextHeader,
  type ContextField,
  VerificationKey,
  SlimTaskHeader,
  AssistantPanel,
} from './panels'

export { GatewayLookup } from './GatewayLookup'

export {
  PolicySummaryCard,
  PolicySummaryList,
  type PolicySummary,
} from './PolicySummaryCard'

export {
  CustomerHistoryCard,
  NextHistoryEntry,
} from './CustomerHistoryCard'

export {
  CustomerContactCard,
  CustomerNameHeading,
  type CustomerContact,
  type ContactPersistPayload,
  type ContactCardAppearance,
  type ColorChoice,
  type WeightChoice,
  type VerifiedPlacement,
  type EditPlacement,
  type AlignChoice,
} from './CustomerContactCard'

export {
  PersonNameDisplay,
  PersonNameEditor,
  PersonNameFields,
  usePersonNameDraft,
  nameFromDraft,
  type PersonNameDraft,
  type PersonNameDraftApi,
} from './PersonName'
