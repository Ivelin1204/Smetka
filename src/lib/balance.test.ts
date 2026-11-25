import { describe, expect, it } from 'vitest'
import { BalanceModel } from './balance'
import { findClosingBalance, guessMapping, mapRows, statementBalances, type ParsedTable } from './csv'
import { pdfItemsToTable, type PdfTextItem } from './pdfTable'
import type { BalanceSnapshot } from './types'
import sample from './__fixtures__/sample-statement.items.json'

const snap = (date: string, amount: number, source: BalanceSnapshot['source'] = 'statement', createdAt = 1): BalanceSnapshot => ({ id: date + source, date, amount, source, createdAt })

describe('balance over time', () => {
  const txs = [
    { date: '2026-11-01', amount: -620 },
    { date: '2026-11-10', amount: 1950 },
    { date: '2026-11-12', amount: -11.99 },
    { date: '2026-11-20', amount: -100 },
  ]

  it('rolls forward and backward from a snapshot', () => {
    const m = new BalanceModel(txs, [snap('2026-11-12', 2000)])
    expect(m.on('2026-11-12')).toBe(2000)
    expect(m.on('2026-11-25')).toBe(1900) // −100 on the 20th
    expect(m.on('2026-11-11')).toBe(2011.99) // undo the −11.99 of the 12th
    expect(m.on('2026-10-31')).toBe(681.99) // before the salary and the rent
  })

  it('re-anchors at every snapshot, and a typed-in balance wins on its day', () => {
    const m = new BalanceModel(txs, [snap('2026-11-12', 2000), snap('2026-11-20', 1850), snap('2026-11-20', 1800, 'manual')])
    expect(m.on('2026-11-15')).toBe(2000)
    expect(m.on('2026-11-20')).toBe(1800)
    expect(m.anchorFor('2026-11-24')?.source).toBe('manual')
  })

  it('has nothing to say without a snapshot', () => {
    expect(new BalanceModel(txs, []).on('2026-11-20')).toBeNull()
  })

  it('gives month-end balances', () => {
    const m = new BalanceModel(txs, [snap('2026-11-20', 1900)])
    expect(m.monthly('2026-11', 2, '2026-11-25')).toEqual([
      { month: '2026-10', balance: 681.99 },
      { month: '2026-11', balance: 1900 },
    ])
  })
})

describe('balances from statements', () => {
  it('reads the running balance column of the sample PDF', () => {
    const t = pdfItemsToTable(sample as PdfTextItem[])
    const table: ParsedTable = { source: 'pdf', delimiter: '', headerIndex: 0, headers: t.headers, rows: t.rows }
    const m = guessMapping(table)
    expect(table.headers[m.balance!]).toBe('Салдо')
    const { rows } = mapRows(table, m)
    const days = statementBalances(rows)
    expect(days.length).toBeGreaterThan(40)
    // The statement's own figures must agree with its transactions, day after day.
    const model = new BalanceModel(rows, [{ id: 'x', ...days[0], source: 'statement', createdAt: 1 }])
    // Each leva amount is rounded to euro cents on its own, so a few cents of drift add up over ~90 rows.
    for (const d of days) expect(Math.abs(model.on(d.date)! - d.amount)).toBeLessThan(0.5)
  })

  it('falls back to a closing-balance line', () => {
    const csv: string[][] = [['Крайно салдо:', '', '1 234,56']]
    expect(findClosingBalance(csv)).toBe('1 234,56')
    const rows = [{ line: 1, date: '2026-11-03', description: 'x', amount: -5, originalAmount: -5, originalCurrency: 'EUR' }]
    expect(statementBalances(rows, '1 234,56', ',')).toEqual([{ date: '2026-11-03', amount: 1234.56 }])
  })

  it('reads newest-first exports in time order', () => {
    const rows = [
      { line: 1, date: '2026-11-05', description: 'b', amount: -5, originalAmount: -5, originalCurrency: 'EUR', balance: 95 },
      { line: 2, date: '2026-11-05', description: 'a', amount: -10, originalAmount: -10, originalCurrency: 'EUR', balance: 100 },
      { line: 3, date: '2026-11-01', description: 'z', amount: 110, originalAmount: 110, originalCurrency: 'EUR', balance: 110 },
    ]
    expect(statementBalances(rows)).toEqual([
      { date: '2026-11-01', amount: 110 },
      { date: '2026-11-05', amount: 95 },
    ])
  })
})
