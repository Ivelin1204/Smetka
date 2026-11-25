import { describe, expect, it } from 'vitest'
import { BUILTIN_RULES } from './categories'
import { categorize, extractMerchant, sortRules } from './categorize'
import { decodeBytes, fingerprint, guessMapping, mapRows, parseTable } from './csv'
import { detectDateFormat, parseDate } from './dates'
import { demoBankCsv, generateDemo } from './demo'
import { detectDecimal, parseAmount, toEur } from './money'
import { detectRecurring } from './recurring'
import { budgetStatus, spendByCategory, summarize } from './stats'
import type { Transaction } from './types'

const rules = sortRules(BUILTIN_RULES)

/** Minimal Windows-1251 encoder for Cyrillic test fixtures. */
function cp1251(s: string): ArrayBuffer {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    out[i] = c >= 0x410 && c <= 0x44f ? c - 0x350 : c
  }
  return out.buffer
}

describe('parseAmount', () => {
  it.each([
    ['1 234,56', 1234.56],
    ['1.234,56', 1234.56],
    ['1,234.56', 1234.56],
    ['-12.30', -12.3],
    ['12,30-', -12.3],
    ['(45.00)', -45],
    ['+5 лв.', 5],
    ['€ 19,99', 19.99],
    ['1 050,00', 1050],
    ['1.234', 1234],
    ['abc', null],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(parseAmount(input)).toBe(expected)
  })

  it('respects a decimal hint for ambiguous values', () => {
    expect(parseAmount('1.234', '.')).toBe(1.234)
    expect(parseAmount('1,5', ',')).toBe(1.5)
  })

  it('detects the decimal separator of a column', () => {
    expect(detectDecimal(['12,50', '1 200,00', '3,99'])).toBe(',')
    expect(detectDecimal(['12.50', '1,200.00', '-3.99'])).toBe('.')
  })
})

describe('dates', () => {
  it('parses European, ISO and US formats', () => {
    expect(parseDate('24.11.2026', 'DD.MM.YYYY')).toBe('2026-11-24')
    expect(parseDate('2026-11-24 14:32:10', 'YYYY-MM-DD')).toBe('2026-11-24')
    expect(parseDate('11/24/2026', 'MM/DD/YYYY')).toBe('2026-11-24')
    expect(parseDate('31.02.2026', 'DD.MM.YYYY')).toBeNull()
  })

  it('detects the format and prefers day-first when ambiguous', () => {
    expect(detectDateFormat(['01.11.2026', '15.11.2026'])).toBe('DD.MM.YYYY')
    expect(detectDateFormat(['03/04/2026', '05/06/2026'])).toBe('DD/MM/YYYY')
    expect(detectDateFormat(['03/04/2026', '11/24/2026'])).toBe('MM/DD/YYYY')
  })
})

describe('currency', () => {
  it('converts leva at the fixed euro rate', () => {
    expect(toEur(195.58, 'BGN')).toBe(100)
    expect(toEur(10, 'EUR')).toBe(10)
  })
})

describe('CSV import', () => {
  it('decodes Windows-1251 files', () => {
    const { text, encoding } = decodeBytes(cp1251('Дата;Описание;Сума'))
    expect(encoding).toBe('windows-1251')
    expect(text).toBe('Дата;Описание;Сума')
  })

  it('handles a Bulgarian bank export with preamble, Д/К column and decimal commas', () => {
    const csv = [
      'Извлечение по сметка;;;;',
      'Титуляр: ТЕСТ;;;;',
      'Дата;Описание;Сума;Д/К;Валута',
      '03.11.2026;POS ПЛАЩАНЕ LIDL BULGARIA EOOD;23,40;Д;EUR',
      '25.11.2026;ВХОДЯЩ ПРЕВОД ЗАПЛАТА;1 950,00;К;EUR',
      '28.12.2025;ПЛАЩАНЕ ЕЛЕКТРОХОЛД;97,79;Д;BGN',
      ';Общо операции: 3;;;',
    ].join('\n')
    const table = parseTable(csv)
    expect(table.delimiter).toBe(';')
    expect(table.headers[0]).toBe('Дата')
    const m = guessMapping(table)
    expect(m).toMatchObject({ date: 0, description: 1, amount: 2, amountMode: 'direction', direction: 3, currency: 4, decimal: ',' })
    const { rows, errors } = mapRows(table, m)
    expect(errors).toHaveLength(0)
    expect(rows.map((r) => r.amount)).toEqual([-23.4, 1950, -50])
    expect(rows[2].originalCurrency).toBe('BGN')
  })

  it('handles a Revolut-style export with signed amounts', () => {
    const csv = [
      'Type,Product,Started Date,Completed Date,Description,Amount,Fee,Currency,State,Balance',
      'CARD_PAYMENT,Current,2026-11-02 10:12:01,2026-11-03 09:00:00,Spotify,-7.99,0.00,EUR,COMPLETED,812.01',
      'TOPUP,Current,2026-11-04 18:00:00,2026-11-04 18:00:05,Top-up by *1234,200.00,0.00,EUR,COMPLETED,1012.01',
    ].join('\n')
    const table = parseTable(csv)
    const m = guessMapping(table)
    expect(m.amountMode).toBe('signed')
    expect(table.headers[m.date]).toBe('Started Date')
    expect(table.headers[m.description]).toBe('Description')
    expect(table.headers[m.amount]).toBe('Amount')
    const { rows } = mapRows(table, m)
    expect(rows.map((r) => [r.date, r.amount])).toEqual([
      ['2026-11-02', -7.99],
      ['2026-11-04', 200],
    ])
  })

  it('handles separate debit and credit columns', () => {
    const csv = ['Дата,Основание,Дебит,Кредит', '01.10.2026,Наем,620.00,', '25.10.2026,Заплата,,1950.00'].join('\n')
    const table = parseTable(csv)
    const m = guessMapping(table)
    expect(m.amountMode).toBe('split')
    expect(mapRows(table, m).rows.map((r) => r.amount)).toEqual([-620, 1950])
  })

  it('converts pre-2026 leva automatically when there is no currency column', () => {
    const csv = ['Дата;Описание;Сума', '30.12.2025;Покупка;-19,56', '02.01.2026;Покупка;-10,00'].join('\n')
    const table = parseTable(csv)
    const m = guessMapping(table)
    expect(m.currencyMode).toBe('auto-euro-switch')
    expect(mapRows(table, m).rows.map((r) => r.amount)).toEqual([-10, -10])
  })

  it('gives identical rows distinct but stable fingerprints', () => {
    const row = { line: 1, date: '2026-11-03', description: 'COSTA COFFEE', amount: -2.5, originalAmount: -2.5, originalCurrency: 'EUR' }
    const a = fingerprint([row, row])
    const b = fingerprint([row, row, { ...row, date: '2026-11-04' }])
    expect(a[0]).not.toBe(a[1])
    expect(b.slice(0, 2)).toEqual(a)
  })

  it('round-trips the demo bank CSV', () => {
    const table = parseTable(demoBankCsv('2026-11-24'))
    const { rows, errors } = mapRows(table, guessMapping(table))
    expect(errors).toHaveLength(0)
    expect(rows.length).toBeGreaterThan(40)
    expect(rows.some((r) => r.amount > 1000)).toBe(true)
  })
})

describe('categorization', () => {
  it.each([
    ['POS ПЛАЩАНЕ LIDL BULGARIA EOOD SOFIA BGR 4567XXXXXX1234', -23, 'groceries'],
    ['ПЛАЩАНЕ ЕЛЕКТРОХОЛД ПРОДАЖБИ ЕАД', -60, 'utilities'],
    ['ВХОДЯЩ ПРЕВОД ЗАПЛАТА ЗА МЕСЕЦА', 1950, 'salary'],
    ['ПЛАЩАНЕ ФАКТУРА А1', -25, 'telecom'],
    ['BOLT.EU/R TALLINN EE', -8, 'transport'],
    ['TEGLENE SEVNICA', -50, 'other'],
    ['НЕЩО НЕПОЗНАТО', 15, 'income-other'],
  ])('%s → %s', (desc, amount, expected) => {
    expect(categorize(desc, amount, rules).categoryId).toBe(expected)
  })

  it('lets user rules override built-in ones', () => {
    const user = sortRules([...BUILTIN_RULES, { id: 'u1', pattern: 'LIDL', categoryId: 'dining', origin: 'user', createdAt: 1 }])
    expect(categorize('POS LIDL SOFIA', -10, user).categoryId).toBe('dining')
  })

  it('extracts readable merchant names', () => {
    expect(extractMerchant('POS ПЛАЩАНЕ LIDL BULGARIA EOOD SOFIA BGR 4567XXXXXX1234')).toBe('Lidl')
    expect(extractMerchant('SPOTIFY P2F8A9 STOCKHOLM SE 4567XXXXXX1234')).toBe('Spotify')
    expect(extractMerchant('NETFLIX.COM AMSTERDAM NL 4567XXXXXX1234')).toBe('Netflix')
    expect(extractMerchant('BOLT.EU/R TALLINN EE')).toBe('Bolt')
    expect(extractMerchant('ИЗХОДЯЩ ПРЕВОД КЪМ ИВАН ПЕТРОВ НАЕМ')).toBe('Иван Петров Наем')
  })
})

function demoTransactions(today = '2026-11-24'): Transaction[] {
  const raw = generateDemo(today)
  const rows = raw.map((r, i) => ({ line: i, ...r, originalAmount: r.amount, originalCurrency: 'EUR' }))
  const ids = fingerprint(rows)
  return rows.map((r, i) => {
    const c = categorize(r.description, r.amount, rules)
    return { id: ids[i], date: r.date, description: r.description, merchant: extractMerchant(r.description), amount: r.amount, originalAmount: r.amount, originalCurrency: 'EUR', categoryId: c.categoryId, categorySource: c.source, importId: 'demo' }
  })
}

describe('insights on demo data', () => {
  const txs = demoTransactions()

  it('finds subscriptions but not groceries', () => {
    const rec = detectRecurring(txs, '2026-11-24')
    const names = rec.map((r) => r.merchant.toUpperCase())
    expect(names.some((n) => n.startsWith('NETFLIX'))).toBe(true)
    expect(names.some((n) => n.startsWith('SPOTIFY'))).toBe(true)
    expect(names.some((n) => n.startsWith('LIDL'))).toBe(false)
    expect(rec.find((r) => r.merchant.toUpperCase().startsWith('SPOTIFY'))?.priceIncrease).toBe(true)
  })

  it('summarizes a month and ignores transfers', () => {
    const s = summarize(txs, '2026-10')
    expect(s.income).toBeGreaterThanOrEqual(1950)
    expect(s.expenses).toBeGreaterThan(1000)
    expect(s.expenses).toBeLessThan(2600)
  })

  it('projects budgets to month end', () => {
    const spend = spendByCategory(txs, '2026-11')
    const [b] = budgetStatus([{ categoryId: 'groceries', limit: 50 }], spend, '2026-11', 24)
    expect(b.status).toBe('over')
    expect(b.projected).toBeGreaterThan(b.spent)
  })
})

import { applyMoneyOp, EMPTY_ENTRY, entryFromText, entryToText, type MoneyEntry } from './money'

describe('typing amounts like a banking app', () => {
  const type = (keys: string, from: MoneyEntry = EMPTY_ENTRY, dec: ',' | '.' = ',', group = ' ') => {
    let e = from
    for (const k of keys) e = applyMoneyOp(e, k === '⌫' ? { type: 'delete' } : { type: 'insert', text: k })
    return entryToText(e, dec, group)
  }

  it.each([
    ['1', '1,00'],
    ['1291', '1 291,00'],
    ['1291,6', '1 291,60'],
    ['1291,68', '1 291,68'],
    ['1291.68', '1 291,68'],
    ['1291,689', '1 291,68'],
    [',5', '0,50'],
    ['007', '7,00'],
    ['1291,68⌫', '1 291,60'],
    ['1291,6⌫⌫', '1 291,00'],
    ['1291⌫', '129,00'],
    ['1⌫', ''],
    ['-250', '-250,00'],
  ])('%s → %s', (keys, expected) => expect(type(keys)).toBe(expected))

  it('typing after "," keeps working on cents, deleting past it goes back to units', () => {
    expect(type('12,⌫3')).toBe('123,00')
  })

  it('uses English separators in English', () => {
    expect(type('1291.5', EMPTY_ENTRY, '.', ',')).toBe('1,291.50')
  })

  it('reads an existing amount back', () => {
    expect(entryToText(entryFromText('3 482,17', ','), ',', ' ')).toBe('3 482,17')
    expect(parseAmount(entryToText(entryFromText('2750.4', '.'), ',', ' '))).toBe(2750.4)
  })
})
