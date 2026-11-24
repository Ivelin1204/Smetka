import { describe, expect, it } from 'vitest'
import { BUILTIN_RULES } from './categories'
import { categorize, sortRules } from './categorize'
import { guessMapping, mapRows, type ParsedTable } from './csv'
import { groupLines, pdfItemsToTable, type PdfTextItem } from './pdfTable'
// Real pdf.js output for public/sample-statement.pdf (scripts/make-sample-pdf.py)
import sample from './__fixtures__/sample-statement.items.json'

const items = sample as PdfTextItem[]
const asTable = (t: ReturnType<typeof pdfItemsToTable>): ParsedTable => ({ source: 'pdf', delimiter: '', headerIndex: t.hasHeader ? 0 : -1, headers: t.headers, rows: t.rows })

describe('PDF statement → table', () => {
  const t = pdfItemsToTable(items)

  it('finds the header and every transaction across pages', () => {
    expect(t.pages).toBe(4)
    expect(t.hasHeader).toBe(true)
    expect(t.headers).toEqual(['Дата', 'Вальор', 'Основание на плащането', 'Дебит', 'Кредит', 'Салдо'])
    expect(t.rows).toHaveLength(95)
  })

  it('joins wrapped descriptions and keeps columns apart', () => {
    const salary = t.rows.find((r) => r[2].includes('ЗАПЛАТА'))!
    expect(salary[2]).toBe('ВХОДЯЩ ПРЕВОД ЗАПЛАТА ЗА МЕСЕЦА ОТ ТЕХНО СОФТ ООД ПО ТРУДОВ ДОГОВОР')
    expect(salary[3]).toBe('')
    expect(salary[4]).toBe('3 814,00')
  })

  it('ignores opening balance, totals and page footers', () => {
    const text = t.rows.flat().join(' ')
    expect(text).not.toContain('Начално салдо')
    expect(text).not.toContain('Обороти')
    expect(text).not.toContain('Страница')
  })

  it('maps through the same import pipeline as CSV, converting leva to euro', () => {
    const table = asTable(t)
    const m = guessMapping(table)
    expect(m.amountMode).toBe('split')
    expect(table.headers[m.debit]).toBe('Дебит')
    expect(table.headers[m.credit]).toBe('Кредит')
    const { rows, errors } = mapRows(table, m)
    expect(errors).toHaveLength(0)
    expect(rows).toHaveLength(95)
    const salary = rows.find((r) => r.description.includes('ЗАПЛАТА'))!
    expect(salary.originalCurrency).toBe('BGN')
    expect(salary.amount).toBe(1950.07)
    const rent = rows.find((r) => r.description.includes('НАЕМ'))!
    expect(rent.originalAmount).toBe(-1200)
    const rules = sortRules(BUILTIN_RULES)
    const categorized = rows.filter((r) => categorize(r.description, r.amount, rules).source === 'rule').length
    expect(categorized / rows.length).toBeGreaterThan(0.9)
  })
})

describe('line grouping', () => {
  const item = (str: string, x: number, y = 100, w = str.length * 4): PdfTextItem => ({ str, x, y, w, h: 8, page: 1 })

  it('merges word runs and splits columns by gutter width', () => {
    const [line] = groupLines([item('POS', 100), item('ПЛАЩАНЕ', 114), item('23,40', 400)])
    expect(line.cells.map((c) => c.text)).toEqual(['POS ПЛАЩАНЕ', '23,40'])
  })

  it('splits a date glued to the description', () => {
    const [line] = groupLines([item('03.10.2026 POS LIDL', 40), item('12,00', 400)])
    expect(line.cells.map((c) => c.text)).toEqual(['03.10.2026', 'POS LIDL', '12,00'])
  })

  it('returns no rows for a PDF without a transaction table', () => {
    expect(pdfItemsToTable([item('Здравейте', 40), item('Писмо без таблица', 40, 80)]).rows).toHaveLength(0)
  })
})

// Fictional card statement laid out like the user's bank (scripts/make-test-card-statement.py):
// centred columns, two dates, a time column, a "Вид трансакция" column, two amounts, unsigned values.
import card from './__fixtures__/card-statement.items.json'
import { columnKinds, directionOf } from './csv'
import { extractMerchant } from './categorize'
import { looksLikeAmount } from './money'

describe('card statement PDF', () => {
  const t = pdfItemsToTable(card as PdfTextItem[])
  const table = asTable(t)
  const m = guessMapping(table)
  const { rows, errors } = mapRows(table, m)

  it('puts centred and wrapped headers over the right columns', () => {
    expect(t.headers).toEqual(['Дата на трансакция', 'Час', 'Описание', 'Вид трансакция', 'Сума в оригинална валута', 'Валута', 'Дата на осчетоводяване', 'Сума във валута на сметката (EUR)'])
    expect(t.rows[0]).toEqual(['24.11.2026', '15:55', 'LIDAL BALGARIYA EOOD-PLEVEN-BG', 'Покупка', '4,33', 'EUR', '25.11.2026', '4,33'])
  })

  it('picks the transaction date, the description (not the time) and the account-currency amount', () => {
    expect(table.headers[m.date]).toBe('Дата на трансакция')
    expect(table.headers[m.description]).toBe('Описание')
    expect(m.descriptionExtra).toEqual([])
    expect(table.headers[m.amount]).toBe('Сума във валута на сметката (EUR)')
    expect(m.currencyMode).toBe('EUR')
  })

  it('reads the transaction type: purchases out, refunds and card payments in', () => {
    expect(m.amountMode).toBe('direction')
    expect(table.headers[m.direction]).toBe('Вид трансакция')
    expect(errors).toHaveLength(0)
    const by = (s: string) => rows.filter((r) => r.description.includes(s)).map((r) => r.amount)
    expect(by('LIDAL')).toEqual([-4.33])
    expect(by('ANTHROPIC')).toEqual([-21.6]) // 25 USD, charged as 21.60 EUR
    expect(by('BILLA')).toEqual([-4.81, 3.2, -2.66])
    expect(by('BANKOMAT')).toEqual([-50])
    expect(by('KARTOVA')).toEqual([300])
  })

  it('names merchants the way people would', () => {
    expect(extractMerchant('LIDAL BALGARIYA EOOD-PLEVEN-BG')).toBe('Lidal')
    expect(extractMerchant('BILLA 316 02-PLOVDIV-BG')).toBe('Billa')
    expect(extractMerchant('ANTHROPIC CLAUDE SUB-DUBLIN 4-IE')).toBe('Anthropic Claude')
  })

  it('categorizes transliterated merchant names', () => {
    const rules = sortRules(BUILTIN_RULES)
    const cat = (s: string) => categorize(rows.find((r) => r.description.includes(s))!.description, -1, rules).categoryId
    expect(cat('LIDAL')).toBe('groceries')
    expect(cat('LUKOYL')).toBe('fuel')
    expect(cat('BANKOMAT')).toBe('cash')
  })
})

describe('column meaning', () => {
  it.each([
    ['Д', 'debit'],
    ['К', 'credit'],
    ['Покупка', 'debit'],
    ['Теглене в брой', 'debit'],
    ['Възстановяване', 'credit'],
    ['Плащане към картата', 'credit'],
    ['Входящ превод', 'credit'],
    ['15:55', null],
  ])('%s → %s', (v, expected) => expect(directionOf(v)).toBe(expected))

  it('never mistakes a date for an amount', () => {
    expect(looksLikeAmount('25.11.2026')).toBe(false)
    expect(looksLikeAmount('15:55')).toBe(false)
    expect(looksLikeAmount('1 234,56')).toBe(true)
  })

  it('treats an all-positive single amount column as spending', () => {
    const table: ParsedTable = { source: 'csv', delimiter: ';', headerIndex: 0, headers: ['Дата', 'Търговец', 'Сума'], rows: [['01.11.2026', 'LIDL', '12,40'], ['02.11.2026', 'SHELL', '60,00'], ['03.11.2026', 'GLOVO', '18,90']] }
    const m = guessMapping(table)
    expect(m.invertSign).toBe(true)
    expect(mapRows(table, m).rows.map((r) => r.amount)).toEqual([-12.4, -60, -18.9])
  })
})

describe('description stays clean', () => {
  const table: ParsedTable = {
    source: 'pdf',
    delimiter: '',
    headerIndex: 0,
    headers: ['Дата', 'Дата', 'Описание', 'Сума'],
    rows: [
      ['25.11.2026', '24.11.2026 15:55', 'LIDAL BALGARIYA EOOD-PLEVEN-BG', '-4,33'],
      ['25.11.2026', '24.11.2026 15:54', 'KARGO OIL-PLEVEN-BG', '-39,99'],
    ],
  }

  it('never joins a date or time into the description, even if chosen as extra', () => {
    const m = { ...guessMapping(table), descriptionExtra: [1] }
    expect(mapRows(table, m).rows.map((r) => r.description)).toEqual(['LIDAL BALGARIYA EOOD-PLEVEN-BG', 'KARGO OIL-PLEVEN-BG'])
  })

  it('knows which columns hold dates, text and amounts', () => {
    const k = columnKinds(table)
    expect(k.map((c) => c.date)).toEqual([true, true, false, false])
    expect(k.map((c) => c.text)).toEqual([false, false, true, false])
    expect(k.map((c) => c.amount)).toEqual([false, false, false, true])
  })
})
