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
 * Amount entry the way banking apps do it: ",00" is always shown, digits go in front of the separator,
 * and typing "," (or ".") moves on to the cents, which fill from the left ("5" → ",50", then "6" → ",56").
 */
export interface MoneyEntry {
  negative: boolean
  /** whole units, digits only, may be '' */
  units: string
  /** always two digits */
  cents: string
  /** how many cent digits have been typed; -1 while still typing whole units */
  centsTyped: number
}

export type MoneyOp = { type: 'insert'; text: string } | { type: 'delete' } | { type: 'clear' }

export const EMPTY_ENTRY: MoneyEntry = { negative: false, units: '', cents: '00', centsTyped: -1 }

export function entryFromText(text: string, dec: ',' | '.'): MoneyEntry {
  if (!text.trim()) return EMPTY_ENTRY
  const negative = /^\s*[-−]/.test(text)
  const at = text.lastIndexOf(dec)
  const units = (at >= 0 ? text.slice(0, at) : text).replace(/\D/g, '').replace(/^0+(?=\d)/, '')
  const cents = (at >= 0 ? text.slice(at + 1).replace(/\D/g, '') : '').padEnd(2, '0').slice(0, 2)
  return { negative, units, cents, centsTyped: -1 }
}

export function entryToText(e: MoneyEntry, dec: ',' | '.', group: string): string {
  if (!e.units && e.cents === '00' && e.centsTyped < 0 && !e.negative) return ''
  const units = (e.units.replace(/^0+(?=\d)/, '') || '0').replace(/\B(?=(\d{3})+(?!\d))/g, group)
  return (e.negative ? '-' : '') + units + dec + e.cents
}

export function applyMoneyOp(e: MoneyEntry, op: MoneyOp): MoneyEntry {
  if (op.type === 'clear') return EMPTY_ENTRY
  const next = { ...e }
  if (op.type === 'delete') {
    if (next.centsTyped > 0) {
      // Clear the cent digit left of the caret and step back over it.
      next.centsTyped--
      next.cents = next.centsTyped === 0 ? '0' + next.cents[1] : next.cents[0] + '0'
    } else if (next.centsTyped === 0) next.centsTyped = -1
    else if (next.units) next.units = next.units.slice(0, -1)
    else next.negative = false
    return next
  }
  for (const ch of op.text) {
    if (/\d/.test(ch)) {
      if (next.centsTyped < 0) {
        if (next.units.length < 10) next.units = (next.units === '0' ? '' : next.units) + ch
      } else if (next.centsTyped < 2) {
        // Overwrite the cent digit at the caret: ",5|0" + "7" → ",57"
        next.cents = next.centsTyped === 0 ? ch + next.cents[1] : next.cents[0] + ch
        next.centsTyped++
      }
    } else if ((ch === ',' || ch === '.') && next.centsTyped < 0) {
      next.centsTyped = 0
      next.cents = '00'
    } else if (ch === '-' || ch === '−') next.negative = !next.negative
  }
  return next
}

/** Where the caret goes in the text for an entry: before the separator, or inside the cents. */
export function caretFor(e: MoneyEntry, text: string, dec: ',' | '.'): number {
  const sep = text.lastIndexOf(dec)
  if (sep < 0) return text.length
  return e.centsTyped < 0 ? sep : sep + 1 + Math.min(e.centsTyped, 2)
}

/** The user put the caret somewhere (click, tap, arrow keys): after the separator means editing cents. */
export function entryAtCaret(e: MoneyEntry, text: string, caret: number, dec: ',' | '.'): MoneyEntry {
  const sep = text.lastIndexOf(dec)
  if (sep < 0 || caret <= sep) return { ...e, centsTyped: -1 }
  return { ...e, centsTyped: Math.min(2, caret - sep - 1) }
}
