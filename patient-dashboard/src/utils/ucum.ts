// UCUM unit code → human-readable display string.
// FHIR Quantity.unit can carry either a UCUM code (the canonical machine form)
// or already-formatted text. We normalize the common UCUM cases for display.
const UCUM_DISPLAY: Record<string, string> = {
  '[lb_av]': 'lb',
  lb_av: 'lb',
  '[in_i]': 'in',
  in_i: 'in',
  '[degF]': '°F',
  degF: '°F',
  Cel: '°C',
  degC: '°C',
  'kg/m2': 'kg/m²',
  'kg.m-2': 'kg/m²',
  'mm[Hg]': 'mmHg',
  '[mm_i]': 'mm',
  '/min': '/min',
  per_min: '/min',
  per: '/',
  '%': '%',
  cm: 'cm',
  kg: 'kg',
  g: 'g',
  L: 'L',
  mL: 'mL',
  'mg/dL': 'mg/dL',
  'mmol/L': 'mmol/L',
  '10*3/uL': '×10³/µL',
  '10*6/uL': '×10⁶/µL',
}

export function formatUnit(unit: string | undefined): string {
  if (!unit) return ''
  return UCUM_DISPLAY[unit] ?? unit
}

export function formatQuantity(value: number | undefined, unit: string | undefined): string | null {
  if (value === undefined || value === null) return null
  const display = formatUnit(unit)
  if (!display) return String(value)
  // No space between number and degree marker; space otherwise.
  if (display.startsWith('°') || display === '%') return `${value}${display}`
  return `${value} ${display}`
}
