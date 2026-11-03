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

export { CallButton } from './CallButton'
export { SkipForNowButton } from './SkipForNowButton'
export { CallContextCard } from './CallContextCard'
export { CallMentorCap } from './CallMentorCap'
export { TalkPathCard } from './TalkPathCard'
export {
  CallOutcomeChoice,
  type CallOutcomeChoiceValue,
  type CallOutcomeLabels,
} from './CallOutcomeChoice'
export { HistoryNotesField } from './HistoryNotesField'
export { Divider, DividerStack } from './Divider'

export {
  OTHER_REASON,
  ChannelReasonPicker,
  ChannelYesNo,
  ChannelSection,
  resolveChannelOutcome,
  type ChannelOutcome,
  type ChannelStatus,
  type ChannelReason,
} from './ChannelAttempt'
export {
  VoicemailAttempt,
  useVoicemailDraft,
  voicemailOutcome,
  VOICEMAIL_REASONS,
  type VoicemailDraft,
} from './VoicemailAttempt'
export {
  TextAttempt,
  useTextDraft,
  textOutcome,
  TEXT_REASONS,
  type TextDraft,
  type TextUnavailableReason,
} from './TextAttempt'
export {
  EmailAttempt,
  useFollowUpEmailDraft,
  emailOutcome,
  EMAIL_REASONS,
  type FollowUpEmailDraft,
} from './EmailAttempt'

export { type TaskColumnRatio } from './TaskColumns'

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

export { DoneSkipActions } from './DoneSkipActions'

export { CopyField } from './CopyField'

export { BinaryChoice, type BinaryOption } from './BinaryChoice'

export { VerifyServicingAgentCard } from './VerifyServicingAgentCard'

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

export {
  EmailDisplay,
  EmailEditor,
  EmailFields,
  useEmailDraft,
  type EmailDraft,
  type EmailDraftApi,
  type EmailRecord,
  type EmailEditResult,
} from './ContactEmail'

export {
  PhoneDisplay,
  PhoneEditor,
  PhoneFields,
  usePhoneDraft,
  type PhoneDraft,
  type PhoneDraftApi,
  type PhoneRecord,
  type PhoneEditResult,
} from './ContactPhone'

export {
  DobDisplay,
  DobEditor,
  DobFields,
  useDobDraft,
  type DobDraftApi,
  type DobRecord,
  type DobEditResult,
} from './ContactDob'

export {
  AddressDisplay,
  AddressEditor,
  AddressFields,
  useAddressDraft,
  addressLines,
  addressUsable,
  type AddressDraft,
  type AddressDraftApi,
  type AddressRecord,
  type AddressEditResult,
} from './ContactAddress'

export {
  AlertBanner,
  AlertEditor,
  AlertField,
  useAlertDraft,
  type AlertDraftApi,
  type AlertRecord,
  type AlertEditResult,
} from './ContactAlert'

export {
  CallbackPrecisionFields,
  useCallbackPrecisionDraft,
  type CallbackPrecisionDraftApi,
} from './CallbackPrecision'
