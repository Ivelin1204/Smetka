import type { DateFormat } from './types'

export const DATE_FORMATS: DateFormat[] = ['DD.MM.YYYY', 'YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY', 'DD-MM-YYYY']

const PATTERNS: Record<DateFormat, RegExp> = {
  'DD.MM.YYYY': /^(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2})/,
  'YYYY-MM-DD': /^(\d{4})-(\d{1,2})-(\d{1,2})/,
  'DD/MM/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/,
  'MM/DD/YYYY': /^(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})/,
  'DD-MM-YYYY': /^(\d{1,2})-(\d{1,2})-(\d{4})/,
}

function pad(n: number) {
  return String(n).padStart(2, '0')
}

function valid(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || y < 1970 || y > 2100) return false
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= dim
}

/** Parses a date cell into YYYY-MM-DD. Time parts ("14:32:10") are ignored. */
export function parseDate(input: string, format: DateFormat): string | null {
  const s = (input ?? '').trim().replace(/\s+г\.?$/i, '')
  const m = s.match(PATTERNS[format])
  if (!m) return null
  let y: number, mo: number, d: number
  const a = Number(m[1]), b = Number(m[2]), c = Number(m[3])
  switch (format) {
    case 'YYYY-MM-DD':
      ;[y, mo, d] = [a, b, c]
      break
    case 'MM/DD/YYYY':
      ;[mo, d, y] = [a, b, c]
      break
    default:
      ;[d, mo, y] = [a, b, c]
  }
  if (y < 100) y += 2000
  if (!valid(y, mo, d)) return null
  return `${y}-${pad(mo)}-${pad(d)}`
}

/** Picks the format that parses the most samples. Ties favour day-first (European) formats. */
export function detectDateFormat(samples: string[]): DateFormat | null {
  const clean = samples.map((s) => s.trim()).filter(Boolean)
  if (!clean.length) return null
  let best: DateFormat | null = null
  let bestScore = 0
  for (const f of DATE_FORMATS) {
    const score = clean.filter((s) => parseDate(s, f) !== null).length
    if (score > bestScore) {
      best = f
      bestScore = score
    }
  }
  return bestScore / clean.length >= 0.6 ? best : null
}

export function looksLikeDate(s: string): boolean {
  return DATE_FORMATS.some((f) => parseDate(s, f) !== null)
}

export function monthKey(isoDate: string): string {
  return isoDate.slice(0, 7)
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000)
}

export function addDays(iso: string, days: number): string {
  const d = new Date(Date.parse(iso) + days * 86_400_000)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}
