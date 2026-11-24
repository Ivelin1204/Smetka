import Papa from 'papaparse'
import { detectDateFormat, looksLikeDate, parseDate } from './dates'
import { detectDecimal, EURO_SWITCH_DATE, looksLikeAmount, normalizeCurrency, parseAmount, toEur } from './money'
import type { ColumnMapping } from './types'

export interface DecodedFile {
  text: string
  encoding: 'utf-8' | 'windows-1251'
}

/** Bulgarian banks still export in Windows-1251. Try strict UTF-8 first, fall back to 1251. */
export function decodeBytes(buf: ArrayBuffer): DecodedFile {
  const bytes = new Uint8Array(buf)
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text: text.replace(/^﻿/, ''), encoding: 'utf-8' }
  } catch {
    return { text: new TextDecoder('windows-1251').decode(bytes), encoding: 'windows-1251' }
  }
}

export type TableSource = 'csv' | 'xlsx' | 'pdf'

export interface ParsedTable {
  source: TableSource
  delimiter: string
  headerIndex: number
  headers: string[]
  rows: string[][]
}

/** Parses CSV text. Delimiter is detected; the table itself is located by tableFromRows. */
export function parseTable(text: string): ParsedTable {
  const res = Papa.parse<string[]>(text.trim(), { skipEmptyLines: 'greedy', delimitersToGuess: [';', ',', '\t', '|'] })
  return tableFromRows(res.data as string[][], res.meta.delimiter, 'csv')
}

/**
 * Finds the real header row in a grid of cells — many exports start with a few lines
 * of account info ("Сметка: BG12...", "Период: ...") before the table.
 */
export function tableFromRows(grid: string[][], delimiter: string, source: TableSource): ParsedTable {
  const all = grid.map((r) => r.map((c) => (c ?? '').trim()))

  // The table width is the most common row width (ignoring narrow preamble lines).
  const widths = new Map<number, number>()
  for (const r of all) {
    const w = r.filter(Boolean).length
    if (w >= 3) widths.set(r.length, (widths.get(r.length) ?? 0) + 1)
  }
  const width = [...widths.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0]?.[0] ?? all[0]?.length ?? 0

  let headerIndex = -1
  let dataStart = 0
  for (let i = 0; i < Math.min(all.length, 40); i++) {
    const r = all[i]
    if (r.length < width - 1 || r.filter(Boolean).length < 3) continue
    const hasDate = r.some(looksLikeDate)
    const next = all[i + 1]
    if (!hasDate && next && next.some(looksLikeDate)) {
      headerIndex = i
      dataStart = i + 1
      break
    }
    if (hasDate) {
      // No header row at all: data starts here, headers get synthesized.
      dataStart = i
      break
    }
  }

  const headers =
    headerIndex >= 0
      ? all[headerIndex].map((h, i) => h || `#${i + 1}`)
      : Array.from({ length: width }, (_, i) => `#${i + 1}`)
  const rows = all.slice(dataStart).filter((r) => r.some(Boolean) && r.length >= Math.min(3, width))
  return { source, delimiter, headerIndex, headers, rows }
}

export function headerSignature(headers: string[]): string {
  return headers.map((h) => h.toLowerCase().replace(/\s+/g, ' ').trim()).join('|')
}

const H = {
  date: /^(дата|date|started date|completed date|transaction date|booking date|дата на (операция|транзакция|осчетоводяване)|вальор|value date)/i,
  description: /(описание|description|основание|детайли|details|наименование|reference|payee|merchant|търговец|информация|назначение)/i,
  counterparty: /(контрагент|counterparty|получател|наредител|beneficiary|name)/i,
  amount: /^(сума|amount|стойност|value|сума в валута)/i,
  debit: /(дебит|debit|разход|withdrawal|изходящ|out)/i,
  credit: /(кредит|credit|приход|deposit|входящ|in$)/i,
  direction: /(д\/к|d\/c|вид|type|тип|посока|direction)/i,
  currency: /(валута|currency|ccy)/i,
}

function column(rows: string[][], i: number, n = 40) {
  return rows.slice(0, n).map((r) => r[i] ?? '').filter(Boolean)
}

function ratio(values: string[], test: (s: string) => boolean) {
  return values.length ? values.filter(test).length / values.length : 0
}

/** Best-effort guess of what each column means, using header names first and cell content second. */
export function guessMapping(table: ParsedTable): ColumnMapping {
  const { headers, rows } = table
  const n = headers.length
  const idx = (re: RegExp, except: number[] = []) => headers.findIndex((h, i) => !except.includes(i) && re.test(h))
  const contentIdx = (test: (s: string) => boolean, except: number[] = [], min = 0.8) => {
    for (let i = 0; i < n; i++) if (!except.includes(i) && ratio(column(rows, i), test) >= min) return i
    return -1
  }

  let date = idx(H.date)
  if (date < 0 || ratio(column(rows, date), looksLikeDate) < 0.6) date = contentIdx(looksLikeDate)

  let debit = idx(H.debit, [date])
  let credit = idx(H.credit, [date, debit])
  let amount = idx(H.amount, [date, debit, credit])
  const currency = idx(H.currency, [date, amount, debit, credit])
  const direction = idx(H.direction, [date, amount, debit, credit, currency])

  if (amount >= 0 && ratio(column(rows, amount), looksLikeAmount) < 0.6) amount = -1
  if (debit >= 0 && ratio(column(rows, debit), (s) => looksLikeAmount(s)) < 0.2) debit = -1
  if (credit >= 0 && ratio(column(rows, credit), (s) => looksLikeAmount(s)) < 0.2) credit = -1

  let amountMode: ColumnMapping['amountMode'] = 'signed'
  if (amount < 0 && debit >= 0 && credit >= 0) amountMode = 'split'
  else {
    if (amount < 0) amount = contentIdx(looksLikeAmount, [date, currency], 0.8)
    if (direction >= 0 && amount >= 0) {
      const vals = column(rows, direction)
      const unsigned = column(rows, amount).every((v) => !v.trim().startsWith('-'))
      if (unsigned && vals.length && new Set(vals.map((v) => v.toUpperCase())).size <= 4) amountMode = 'direction'
    }
  }

  const used = [date, amount, debit, credit, currency, direction]
  let description = idx(H.description, used)
  if (description < 0) {
    // Longest average text column wins.
    let best = -1
    let bestLen = 0
    for (let i = 0; i < n; i++) {
      if (used.includes(i)) continue
      const vals = column(rows, i)
      const avg = vals.reduce((s, v) => s + v.length, 0) / (vals.length || 1)
      if (avg > bestLen && ratio(vals, looksLikeAmount) < 0.5) {
        best = i
        bestLen = avg
      }
    }
    description = best
  }
  const counterparty = idx(H.counterparty, [...used, description])

  const amountSamples = [amount, debit, credit].filter((i) => i >= 0).flatMap((i) => column(rows, i, 80))
  return {
    date,
    description,
    descriptionExtra: counterparty >= 0 ? [counterparty] : [],
    amountMode,
    amount,
    debit,
    credit,
    direction,
    debitMarkers: ['Д', 'D', 'DT', 'DEBIT', 'ДЕБИТ', 'DR', '-', 'OUT', 'РАЗХОД'],
    currency,
    currencyMode: currency >= 0 ? 'column' : 'auto-euro-switch',
    dateFormat: detectDateFormat(column(rows, date, 80)) ?? 'DD.MM.YYYY',
    decimal: detectDecimal(amountSamples),
    invertSign: false,
  }
}

export interface MappedRow {
  line: number
  date: string
  description: string
  amount: number
  originalAmount: number
  originalCurrency: string
}

export interface RowError {
  line: number
  reason: 'date' | 'amount' | 'empty'
  raw: string[]
}

export function mapRows(table: ParsedTable, m: ColumnMapping): { rows: MappedRow[]; errors: RowError[] } {
  const rows: MappedRow[] = []
  const errors: RowError[] = []
  const debitSet = new Set(m.debitMarkers.map((s) => s.toUpperCase()))

  table.rows.forEach((raw, i) => {
    const line = table.headerIndex + 2 + i
    const date = parseDate(raw[m.date] ?? '', m.dateFormat)
    if (!date) {
      // Footer rows like "Общо:" — skip silently if there's no date-ish content at all.
      if (!raw.some(looksLikeDate)) return
      errors.push({ line, reason: 'date', raw })
      return
    }

    let value: number | null = null
    if (m.amountMode === 'split') {
      const d = parseAmount(raw[m.debit], m.decimal)
      const c = parseAmount(raw[m.credit], m.decimal)
      if (d == null && c == null) value = null
      else value = (c ? Math.abs(c) : 0) - (d ? Math.abs(d) : 0)
    } else {
      value = parseAmount(raw[m.amount], m.decimal)
      if (value != null && m.amountMode === 'direction') {
        const dir = (raw[m.direction] ?? '').trim().toUpperCase()
        value = debitSet.has(dir) ? -Math.abs(value) : Math.abs(value)
      }
    }
    if (value == null) {
      errors.push({ line, reason: 'amount', raw })
      return
    }
    if (m.invertSign) value = -value

    // Counterparty first: it names the merchant more cleanly than the payment reference.
    const parts = [...m.descriptionExtra.map((j) => raw[j]), raw[m.description]].map((s) => (s ?? '').trim()).filter(Boolean)
    const description = [...new Set(parts)].join(' · ') || '—'

    let currency = 'EUR'
    if (m.currencyMode === 'column') currency = normalizeCurrency(raw[m.currency])
    else if (m.currencyMode === 'BGN') currency = 'BGN'
    else if (m.currencyMode === 'auto-euro-switch') currency = date < EURO_SWITCH_DATE ? 'BGN' : 'EUR'

    rows.push({ line, date, description, amount: toEur(value, currency), originalAmount: value, originalCurrency: currency })
  })
  return { rows, errors }
}

/** 53-bit FNV-1a style hash, good enough for fingerprints. */
export function hash(str: string): string {
  let h1 = 0xdeadbeef ^ str.length
  let h2 = 0x41c6ce57 ^ str.length
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * Fingerprints rows so the same transaction gets the same id across overlapping exports.
 * Identical rows in one file (two 2.50 coffees on the same day) are told apart by their order.
 */
export function fingerprint(rows: MappedRow[]): string[] {
  const seen = new Map<string, number>()
  return rows.map((r) => {
    const base = `${r.date}|${r.originalAmount.toFixed(2)}|${r.description.toUpperCase().replace(/\s+/g, ' ')}`
    const n = seen.get(base) ?? 0
    seen.set(base, n + 1)
    return 'tx_' + hash(`${base}#${n}`)
  })
}
