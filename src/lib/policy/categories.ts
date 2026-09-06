export type PolicyCategory =
  | 'term_life'
  | 'permanent_life'
  | 'annuity'
  | 'disability'
  | 'ltc'
  | 'medicare'
  | 'investment'
  | 'other'

export type TypeDataField = {
  key:          string
  label:        string
  type:         'text' | 'number' | 'currency' | 'select' | 'boolean'
  options?:     string[]
  placeholder?: string
}

// Keys map directly to DB column names (or 'insured_name' as a composite special case).
// A key present in standardFields means "show this field"; the value is the display label.
export type StandardFields = Partial<{
  insured_name:         string
  face_amount:          string
  death_benefit_amount: string
  cash_value_amount:    string
  cost_basis:           string
  annual_premium:       string
  premium_mode:         string
  term_length:          string
  rate_class:           string
  riders:               string
  primary_beneficiary:  string
}>

export type CategoryConfig = {
  label:          string
  color:          string   // Tailwind classes for the category badge
  standardFields: StandardFields
  typeDataFields: TypeDataField[]
}

export const CATEGORY_CONFIGS: Record<PolicyCategory, CategoryConfig> = {
  term_life: {
    label: 'Term Life',
    color: 'bg-blue-900/40 text-blue-300 border-blue-800',
    standardFields: {
      insured_name:        'Insured',
      face_amount:         'Face Amount',
      annual_premium:      'Annual Premium',
      premium_mode:        'Premium Mode',
      term_length:         'Term Length',
      rate_class:          'Rate Class',
      riders:              'Riders',
      primary_beneficiary: 'Primary Beneficiary',
    },
    typeDataFields: [],
  },

  permanent_life: {
    label: 'Permanent Life',
    color: 'bg-teal-900/40 text-teal-300 border-teal-800',
    standardFields: {
      insured_name:         'Insured',
      face_amount:          'Face Amount',
      death_benefit_amount: 'Death Benefit',
      cash_value_amount:    'Cash Value',
      cost_basis:           'Cost Basis',
      annual_premium:       'Annual Premium',
      premium_mode:         'Premium Mode',
      rate_class:           'Rate Class',
      riders:               'Riders',
      primary_beneficiary:  'Primary Beneficiary',
    },
    typeDataFields: [
      {
        key: 'loan_balance', label: 'Policy Loan Balance', type: 'currency',
        placeholder: '—',
      },
      {
        key: 'dividend_option', label: 'Dividend Option', type: 'select',
        options: ['Paid-Up Additions', 'Cash', 'Premium Reduction', 'Reduced Paid-Up', 'Accumulate at Interest'],
      },
    ],
  },

  annuity: {
    label: 'Annuity',
    color: 'bg-violet-900/40 text-violet-300 border-violet-800',
    standardFields: {
      cash_value_amount:   'Account Value',
      cost_basis:          'Cost Basis',
      annual_premium:      'Annual Contribution',
      premium_mode:        'Contribution Mode',
      primary_beneficiary: 'Primary Beneficiary',
    },
    typeDataFields: [
      {
        key: 'annuity_type', label: 'Annuity Type', type: 'select',
        options: ['Fixed', 'Fixed Indexed', 'Variable', 'SPIA', 'MYGA', 'DIA'],
      },
      {
        key: 'account_type', label: 'Account Type', type: 'select',
        options: ['Non-Qualified', 'Traditional IRA', 'Roth IRA', 'SEP IRA', 'SIMPLE IRA', 'Inherited IRA'],
      },
      { key: 'surrender_period',     label: 'Surrender Period',       type: 'text',    placeholder: 'e.g. 7 years' },
      { key: 'surrender_percentage', label: 'Current Surrender %',    type: 'number',  placeholder: 'e.g. 4' },
      { key: 'rmd_required',         label: 'RMD Required',           type: 'boolean' },
      { key: 'rmd_amount',           label: 'Annual RMD Amount',      type: 'currency', placeholder: '—' },
    ],
  },

  disability: {
    label: 'Disability Income',
    color: 'bg-amber-900/40 text-amber-300 border-amber-800',
    standardFields: {
      insured_name:   'Insured',
      annual_premium: 'Annual Premium',
      premium_mode:   'Premium Mode',
      riders:         'Riders',
    },
    typeDataFields: [
      { key: 'monthly_benefit', label: 'Monthly Benefit',    type: 'currency', placeholder: '—' },
      {
        key: 'elimination_period', label: 'Elimination Period', type: 'select',
        options: ['30 days', '60 days', '90 days', '180 days', '365 days'],
      },
      {
        key: 'benefit_period', label: 'Benefit Period', type: 'select',
        options: ['2 years', '5 years', '10 years', 'To Age 65', 'To Age 67'],
      },
      {
        key: 'definition', label: 'Definition of Disability', type: 'select',
        options: ['Own Occupation', 'Any Occupation', 'Modified Own Occupation', 'Transitional'],
      },
      { key: 'non_cancelable',  label: 'Non-Cancelable',    type: 'boolean' },
      { key: 'occupation_class', label: 'Occupation Class', type: 'text', placeholder: 'e.g. 4A' },
    ],
  },

  ltc: {
    label: 'Long-Term Care',
    color: 'bg-rose-900/40 text-rose-300 border-rose-800',
    standardFields: {
      annual_premium:      'Annual Premium',
      premium_mode:        'Premium Mode',
      riders:              'Riders',
      primary_beneficiary: 'Primary Beneficiary',
    },
    typeDataFields: [
      { key: 'monthly_benefit', label: 'Monthly Benefit',      type: 'currency', placeholder: '—' },
      { key: 'daily_benefit',   label: 'Daily Benefit',        type: 'currency', placeholder: '—' },
      { key: 'pool_of_money',   label: 'Pool of Money',        type: 'currency', placeholder: '—' },
      {
        key: 'elimination_period', label: 'Elimination Period', type: 'select',
        options: ['30 days', '60 days', '90 days', '180 days'],
      },
      {
        key: 'benefit_period', label: 'Benefit Period', type: 'select',
        options: ['2 years', '3 years', '5 years', 'Unlimited'],
      },
      {
        key: 'inflation_protection', label: 'Inflation Protection', type: 'select',
        options: ['None', '3% Simple', '5% Compound', 'CPI-U'],
      },
      { key: 'shared_care', label: 'Shared Care Rider', type: 'boolean' },
    ],
  },

  medicare: {
    label: 'Medicare',
    color: 'bg-sky-900/40 text-sky-300 border-sky-800',
    standardFields: {
      annual_premium: 'Annual Premium',
      premium_mode:   'Premium Mode',
    },
    typeDataFields: [
      {
        key: 'plan_type', label: 'Plan Type', type: 'select',
        options: ['Medicare Supplement', 'Medicare Advantage', 'Part D', 'Medicare MSA'],
      },
      {
        key: 'plan_letter', label: 'Plan Letter (Supplement)', type: 'select',
        options: ['A', 'B', 'C', 'D', 'F', 'G', 'G+', 'K', 'L', 'M', 'N'],
      },
      {
        key: 'network_type', label: 'Network Type (Advantage)', type: 'select',
        options: ['HMO', 'PPO', 'PFFS', 'SNP', 'MSA'],
      },
      { key: 'effective_date', label: 'Effective Date', type: 'text', placeholder: 'MM/DD/YYYY' },
    ],
  },

  investment: {
    label: 'Investment / Brokerage',
    color: 'bg-emerald-900/40 text-emerald-300 border-emerald-800',
    standardFields: {
      cash_value_amount:   'Account Value',
      cost_basis:          'Cost Basis',
      annual_premium:      'Annual Contribution',
      primary_beneficiary: 'Primary Beneficiary',
    },
    typeDataFields: [
      {
        key: 'account_type', label: 'Account Type', type: 'select',
        options: ['Traditional IRA', 'Roth IRA', 'SEP IRA', 'SIMPLE IRA', '401(k)', '403(b)', 'Taxable Brokerage', '529 / Education'],
      },
      { key: 'custodian', label: 'Custodian', type: 'text', placeholder: 'e.g. Fidelity' },
    ],
  },

  other: {
    label: 'Other',
    color: 'bg-slate-700 text-slate-300 border-slate-600',
    standardFields: {
      insured_name:         'Insured',
      face_amount:          'Face Amount',
      death_benefit_amount: 'Death Benefit',
      cash_value_amount:    'Cash Value',
      cost_basis:           'Cost Basis',
      annual_premium:       'Annual Premium',
      premium_mode:         'Premium Mode',
      term_length:          'Term Length',
      rate_class:           'Rate Class',
      riders:               'Riders',
      primary_beneficiary:  'Primary Beneficiary',
    },
    typeDataFields: [],
  },
}

export const CATEGORY_OPTIONS: { value: PolicyCategory; label: string }[] = [
  { value: 'term_life',      label: 'Term Life' },
  { value: 'permanent_life', label: 'Permanent Life  (WL · UL · IUL · VUL)' },
  { value: 'annuity',        label: 'Annuity' },
  { value: 'disability',     label: 'Disability Income' },
  { value: 'ltc',            label: 'Long-Term Care' },
  { value: 'medicare',       label: 'Medicare' },
  { value: 'investment',     label: 'Investment / Brokerage' },
  { value: 'other',          label: 'Other' },
]
