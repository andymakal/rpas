export const RATE_CLASSES = [
  'Preferred Plus',
  'Preferred',
  'Standard Plus',
  'Standard',
  'Non-Tobacco Preferred',
  'Non-Tobacco Standard',
  'Tobacco Preferred',
  'Tobacco Standard',
  'Table 2',
  'Table 4',
  'Table 6',
  'Table 8',
  'Table 10',
  'Table 12',
] as const

export type RateClass = typeof RATE_CLASSES[number]
