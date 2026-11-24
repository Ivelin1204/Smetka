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
