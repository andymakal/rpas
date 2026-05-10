import { z } from 'zod'

export const referralSchema = z.object({
  agency_id: z.string().min(1, 'Please select your agency'),
  lsp_name: z.string().min(2, 'Enter your first and last name'),
  client_first_name: z.string().min(1, 'First name is required'),
  client_last_name: z.string().min(1, 'Last name is required'),
  client_phone: z.string().regex(/^\+?[\d\s\-(). ]{10,}$/, 'Enter a valid phone number'),
  client_email: z.string().email('Enter a valid email address').optional().or(z.literal('')),
  client_dob: z.string().optional(),
  client_marital_status: z.string().optional(),
  client_address: z.string().min(1, 'Address is required'),
  client_city: z.string().min(1, 'City is required'),
  client_state: z.string().min(2, 'State is required'),
  client_zip: z.string().regex(/^\d{5}(-\d{4})?$/, 'Enter a valid ZIP code'),
  referral_type: z.string().min(1, 'Please select a referral type'),
  is_existing_client: z.boolean().default(false),
  preferred_contact: z.enum(['phone', 'text', 'email']).optional(),
  best_contact_time: z.enum(['morning', 'afternoon', 'evening']).optional(),
  notes: z.string().max(500, 'Keep notes under 500 characters').optional(),
  life_insurance_outside_work: z.boolean().default(false),
  job_change_last_5_years: z.boolean().default(false),
  review_401k: z.boolean().default(false),
  retirement_prep: z.boolean().default(false),
})

export type ReferralFormData = z.infer<typeof referralSchema>

export const step1Schema = referralSchema.pick({ agency_id: true, lsp_name: true })

export const step2Schema = referralSchema.pick({
  client_first_name: true, client_last_name: true, client_phone: true,
  client_email: true, client_dob: true, client_marital_status: true,
  client_address: true, client_city: true, client_state: true, client_zip: true,
})

export const step3Schema = referralSchema.pick({
  referral_type: true, is_existing_client: true,
  preferred_contact: true, best_contact_time: true, notes: true,
  life_insurance_outside_work: true, job_change_last_5_years: true,
  review_401k: true, retirement_prep: true,
})