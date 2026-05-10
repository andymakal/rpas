export const REFERRAL_TYPES = [
  { value: 'mortgage_protection', label: 'Mortgage Protection' },
  { value: 'term_life', label: 'Term Life Insurance' },
  { value: 'life_review', label: 'Life Insurance Review' },
  { value: 'financial_planning', label: 'Financial Planning' },
  { value: 'retirement_planning', label: 'Retirement Planning' },
  { value: 'medicare_planning', label: 'Medicare Planning' },
  { value: 'business_owner', label: 'Business Owner' },
  { value: '1035_exchange', label: '1035 Exchange' },
  { value: 'existing_service', label: 'Existing Client — Service' },
  { value: 'existing_sales', label: 'Existing Client — Additional Coverage' },
] as const

export type ReferralTypeValue = typeof REFERRAL_TYPES[number]['value']

export const PRODUCER_ROUTING: Record<ReferralTypeValue, string> = {
  mortgage_protection: 'intern',
  term_life: 'intern',
  life_review: 'ashley',
  financial_planning: 'dulce',
  retirement_planning: 'dulce',
  medicare_planning: 'dulce',
  business_owner: 'senior',
  '1035_exchange': 'senior_escalate',
  existing_service: 'abigail',
  existing_sales: 'producer',
}

export const PRODUCER_LABELS: Record<string, string> = {
  intern: 'Intern Producer Team',
  dulce: 'Dulce Velazquez',
  ashley: 'Ashley Brown',
  senior: 'Senior Producer',
  senior_escalate: 'Senior Producer + Underwriting',
  abigail: 'Abigail Brown',
  producer: 'Producer Team',
}

export const MARITAL_STATUS_OPTIONS = [
  { value: 'single', label: 'Single' },
  { value: 'married', label: 'Married' },
  { value: 'partner', label: 'Partner' },
  { value: 'divorced', label: 'Divorced' },
  { value: 'separated', label: 'Separated' },
  { value: 'widowed', label: 'Widowed' },
  { value: 'unknown', label: 'Prefer not to say' },
] as const

export const CONTACT_METHOD_OPTIONS = [
  { value: 'phone', label: 'Phone Call' },
  { value: 'text', label: 'Text Message' },
  { value: 'email', label: 'Email' },
] as const

export const CONTACT_TIME_OPTIONS = [
  { value: 'morning', label: 'Morning (8am – Noon)' },
  { value: 'afternoon', label: 'Afternoon (Noon – 5pm)' },
  { value: 'evening', label: 'Evening (5pm – 8pm)' },
] as const

export const US_STATES = [
  { value: 'AL', label: 'Alabama' }, { value: 'AK', label: 'Alaska' },
  { value: 'AZ', label: 'Arizona' }, { value: 'AR', label: 'Arkansas' },
  { value: 'CA', label: 'California' }, { value: 'CO', label: 'Colorado' },
  { value: 'CT', label: 'Connecticut' }, { value: 'DE', label: 'Delaware' },
  { value: 'DC', label: 'Washington D.C.' }, { value: 'FL', label: 'Florida' },
  { value: 'GA', label: 'Georgia' }, { value: 'HI', label: 'Hawaii' },
  { value: 'ID', label: 'Idaho' }, { value: 'IL', label: 'Illinois' },
  { value: 'IN', label: 'Indiana' }, { value: 'IA', label: 'Iowa' },
  { value: 'KS', label: 'Kansas' }, { value: 'KY', label: 'Kentucky' },
  { value: 'LA', label: 'Louisiana' }, { value: 'ME', label: 'Maine' },
  { value: 'MD', label: 'Maryland' }, { value: 'MA', label: 'Massachusetts' },
  { value: 'MI', label: 'Michigan' }, { value: 'MN', label: 'Minnesota' },
  { value: 'MS', label: 'Mississippi' }, { value: 'MO', label: 'Missouri' },
  { value: 'MT', label: 'Montana' }, { value: 'NE', label: 'Nebraska' },
  { value: 'NV', label: 'Nevada' }, { value: 'NH', label: 'New Hampshire' },
  { value: 'NJ', label: 'New Jersey' }, { value: 'NM', label: 'New Mexico' },
  { value: 'NY', label: 'New York' }, { value: 'NC', label: 'North Carolina' },
  { value: 'ND', label: 'North Dakota' }, { value: 'OH', label: 'Ohio' },
  { value: 'OK', label: 'Oklahoma' }, { value: 'OR', label: 'Oregon' },
  { value: 'PA', label: 'Pennsylvania' }, { value: 'RI', label: 'Rhode Island' },
  { value: 'SC', label: 'South Carolina' }, { value: 'SD', label: 'South Dakota' },
  { value: 'TN', label: 'Tennessee' }, { value: 'TX', label: 'Texas' },
  { value: 'UT', label: 'Utah' }, { value: 'VT', label: 'Vermont' },
  { value: 'VA', label: 'Virginia' }, { value: 'WA', label: 'Washington' },
  { value: 'WV', label: 'West Virginia' }, { value: 'WI', label: 'Wisconsin' },
  { value: 'WY', label: 'Wyoming' },
] as const