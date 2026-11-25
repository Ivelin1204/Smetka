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
      // Bulgarian style leaves 4-digit numbers ungrouped ("1950,00"); group them like the input does.
      useGrouping: 'always',
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
    return new Intl.NumberFormat(locale, { style: 'currency', currency, useGrouping: 'always' }).format(n).replace('-', '−')
  } catch {
    return `${n.toFixed(2)} ${currency}`
  }
}

/**
 * Amount entry the way banking apps and card terminals do it: digits come in from the right, starting
 * with the cents — "1" → 0,01, "12" → 0,12, "129168" → 1 291,68. No separator to type; Backspace
 * drops the last digit.
 */
export interface MoneyEntry {
  negative: boolean
  /** All digits typed, cents included; '' = empty */
  digits: string
}

export type MoneyOp = { type: 'insert'; text: string } | { type: 'delete' } | { type: 'clear' }

export const EMPTY_ENTRY: MoneyEntry = { negative: false, digits: '' }

export function entryFromText(text: string, dec: ',' | '.'): MoneyEntry {
  const n = parseAmount(text, dec)
  if (/^\s*[-−]\s*$/.test(text)) return { negative: true, digits: '' } // a lone minus, typed first
  if (n == null || n === 0) return EMPTY_ENTRY
  const cents = Math.round(Math.abs(n) * 100)
  return { negative: n < 0, digits: String(cents) }
}

export function entryToText(e: MoneyEntry, dec: ',' | '.', group: string): string {
  if (!e.digits) return e.negative ? '-' : ''
  const padded = e.digits.padStart(3, '0')
  const units = padded.slice(0, -2).replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, group)
  return (e.negative ? '-' : '') + units + dec + padded.slice(-2)
}

export function applyMoneyOp(e: MoneyEntry, op: MoneyOp): MoneyEntry {
  if (op.type === 'clear') return EMPTY_ENTRY
  if (op.type === 'delete') return e.digits ? { ...e, digits: e.digits.slice(0, -1) } : EMPTY_ENTRY
  let { negative, digits } = e
  for (const ch of op.text) {
    if (/\d/.test(ch)) {
      if (!digits && ch === '0') continue // leading zeros change nothing
      if (digits.length < 12) digits += ch
    } else if (ch === '-' || ch === '−') negative = !negative
    // "," and "." are ignored: the cents are always the last two digits.
  }
  return { negative, digits }
}
