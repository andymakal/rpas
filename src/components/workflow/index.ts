/**
 * Right Path workflow design system — shared components for operator-facing
 * workflow UI. See .kiro/steering/workflow-visual-rules.md for the standard
 * these implement. Built on Tailwind and shadcn underneath.
 */

export {
  WorkflowSurface,
  WORKFLOW_MAX_WIDTH,
  WorkflowPage,
  WorkflowHeader,
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
