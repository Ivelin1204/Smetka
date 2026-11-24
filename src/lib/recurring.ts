import { categoryKind } from './categories'
import { addDays, daysBetween } from './dates'
import { round2 } from './money'
import type { Transaction } from './types'

export type Cadence = 'weekly' | 'monthly' | 'yearly'

export interface Recurring {
  merchant: string
  categoryId: string
  cadence: Cadence
  amount: number
  yearlyCost: number
  lastDate: string
  nextDate: string
  count: number
  /** True when the last charge is noticeably higher than the usual one */
  priceIncrease: boolean
}

const CADENCES: { cadence: Cadence; days: number; tolerance: number; perYear: number; min: number }[] = [
  { cadence: 'weekly', days: 7, tolerance: 2, perYear: 52, min: 4 },
  { cadence: 'monthly', days: 30.4, tolerance: 5, perYear: 12, min: 3 },
  { cadence: 'yearly', days: 365, tolerance: 12, perYear: 1, min: 2 },
]

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * Finds subscriptions and other repeating charges: same merchant, regular spacing, stable amount.
 * Groceries at Lidl every week don't qualify — the amounts vary too much.
 */
export function detectRecurring(txs: Transaction[], asOf: string): Recurring[] {
  const groups = new Map<string, Transaction[]>()
  for (const t of txs) {
    if (t.amount >= 0 || categoryKind(t.categoryId) !== 'expense') continue
    const key = t.merchant.toUpperCase()
    const g = groups.get(key)
    if (g) g.push(t)
    else groups.set(key, [t])
  }

  const out: Recurring[] = []
  for (const list of groups.values()) {
    if (list.length < 2) continue
    list.sort((a, b) => a.date.localeCompare(b.date))
    const gaps = list.slice(1).map((t, i) => daysBetween(list[i].date, t.date))
    const gap = median(gaps)
    const c = CADENCES.find((c) => Math.abs(gap - c.days) <= c.tolerance)
    if (!c || list.length < c.min) continue
    if (gaps.filter((g) => Math.abs(g - c.days) <= c.tolerance * 1.6).length < gaps.length * 0.75) continue

    const amounts = list.map((t) => -t.amount)
    const typical = median(amounts)
    const stable = amounts.filter((a) => Math.abs(a - typical) / typical <= 0.15).length >= amounts.length * 0.75
    if (!stable) continue

    const last = list[list.length - 1]
    // Dropped subscriptions: nothing seen for more than two cycles.
    if (daysBetween(last.date, asOf) > c.days * 2 + c.tolerance) continue

    const lastAmount = -last.amount
    out.push({
      merchant: last.merchant,
      categoryId: last.categoryId,
      cadence: c.cadence,
      amount: round2(lastAmount),
      yearlyCost: round2(lastAmount * c.perYear),
      lastDate: last.date,
      nextDate: addDays(last.date, Math.round(c.days)),
      count: list.length,
      priceIncrease: lastAmount > typical * 1.04 && lastAmount - typical >= 0.5,
    })
  }
  return out.sort((a, b) => b.yearlyCost - a.yearlyCost)
}
