import { looksLikeDate } from './dates'
import type { DecimalSep } from './types'

/** Fixed, irrevocable rate set by the EU Council (8 July 2025). Bulgaria adopted the euro on 1 Jan 2026. */
export const BGN_PER_EUR = 1.95583
export const EURO_SWITCH_DATE = '2026-01-01'

export function toEur(amount: number, currency: string): number {
  const c = normalizeCurrency(currency)
  if (c === 'BGN') return round2(amount / BGN_PER_EUR)
  return round2(amount)
}

export function normalizeCurrency(raw: string | undefined | null): string {
  const s = (raw ?? '').trim().toUpperCase()
  if (!s) return 'EUR'
  if (s === 'ЛВ' || s === 'ЛВ.' || s === 'BGN' || s === 'LV' || s === 'LEV' || s === 'ЛЕВА') return 'BGN'
  if (s === '€' || s === 'EUR' || s === 'ЕВРО' || s === 'EURO') return 'EUR'
  return s
}

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}

const NOISE = /[\s  '’]|лв\.?|bgn|eur|€|\$|usd/gi

/**
 * Parses amounts the way Bulgarian (and other European) bank exports write them:
 * "1 234,56", "1.234,56", "1,234.56", "-12.30", "12,30-", "(12.30)", "+5 лв.".
 * Returns null when the cell holds no number.
 */
export function parseAmount(input: string | undefined | null, decimal?: DecimalSep): number | null {
  if (input == null) return null
  let s = String(input).trim()
  if (!s) return null
  let negative = false
  if (/^\(.*\)$/.test(s)) {
    negative = true
    s = s.slice(1, -1)
  }
  s = s.replace(NOISE, '')
  if (s.endsWith('-')) {
    negative = !negative
    s = s.slice(0, -1)
  }
  if (s.startsWith('-')) {
    negative = !negative
    s = s.slice(1)
  } else if (s.startsWith('+')) {
    s = s.slice(1)
  }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null

  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  let dec: DecimalSep | null = null
  if (lastComma >= 0 && lastDot >= 0) {
    dec = lastComma > lastDot ? ',' : '.'
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep: DecimalSep = lastComma >= 0 ? ',' : '.'
    const idx = Math.max(lastComma, lastDot)
    const digitsAfter = s.length - idx - 1
    const occurrences = s.split(sep).length - 1
    if (occurrences > 1) dec = null // only thousands separators
    else if (decimal) dec = decimal === sep ? sep : null
    else dec = digitsAfter === 3 ? null : sep
  }

  let normalized: string
  if (dec === ',') normalized = s.replace(/\./g, '').replace(',', '.')
  else if (dec === '.') normalized = s.replace(/,/g, '')
  else normalized = s.replace(/[.,]/g, '')

  const n = Number(normalized)
  if (!Number.isFinite(n)) return null
  return negative ? -n : n
}

/** Guesses the decimal separator from a column of sample values. */
export function detectDecimal(samples: string[]): DecimalSep {
  let comma = 0
  let dot = 0
  for (const raw of samples) {
    const s = raw.replace(NOISE, '')
    const m = s.match(/[.,](\d{1,2})-?\)?$/)
    if (m) {
      if (s[s.length - m[0].length] === ',') comma++
      else dot++
    }
  }
  return comma > dot ? ',' : '.'
}

export function looksLikeAmount(s: string): boolean {
  const t = s.trim()
  if (!t || t.length > 24) return false
  // "25.11.2026" parses as 25112026 — a date is never an amount.
  if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(t) || looksLikeDate(t)) return false
  if (/[a-zа-я]{4,}/i.test(t.replace(/лв|bgn|eur/gi, ''))) return false
  return parseAmount(t) !== null
}

const fmtCache = new Map<string, Intl.NumberFormat>()
export function formatMoney(n: number, locale: string, opts: { sign?: boolean; compact?: boolean } = {}): string {
  const key = `${locale}|${opts.compact ? 1 : 0}`
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: 'EUR',
      maximumFractionDigits: opts.compact ? 0 : 2,
      minimumFractionDigits: opts.compact ? 0 : 2,
    })
    fmtCache.set(key, f)
  }
  const s = f.format(Math.abs(n))
  if (opts.sign) return (n < 0 ? '−' : n > 0 ? '+' : '') + s
  return n < 0 ? '−' + s : s
}

/** The amount as the bank wrote it, e.g. "−1 200,00 лв." — shown next to the converted euro value. */
export function formatOriginal(n: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(n).replace('-', '−')
  } catch {
    return `${n.toFixed(2)} ${currency}`
  }
}
