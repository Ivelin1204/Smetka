import { categoryKind } from './categories'
import { daysInMonth, monthKey, shiftMonth } from './dates'
import { round2 } from './money'
import type { Budget, Transaction } from './types'

export interface MonthSummary {
  month: string
  income: number
  expenses: number
  net: number
  savingsRate: number
}

export function summarize(txs: Transaction[], month: string): MonthSummary {
  let income = 0
  let expenses = 0
  for (const t of txs) {
    if (monthKey(t.date) !== month) continue
    const kind = categoryKind(t.categoryId)
    if (kind === 'transfer') continue
    if (kind === 'income') income += t.amount
    else expenses -= t.amount // refunds (positive) reduce spending
  }
  income = round2(income)
  expenses = round2(Math.max(0, expenses))
  return { month, income, expenses, net: round2(income - expenses), savingsRate: income > 0 ? (income - expenses) / income : 0 }
}

export function monthlySeries(txs: Transaction[], endMonth: string, count: number): MonthSummary[] {
  return Array.from({ length: count }, (_, i) => summarize(txs, shiftMonth(endMonth, i - count + 1)))
}

export interface CategorySpend {
  categoryId: string
  amount: number
  previous: number
  count: number
}

export function spendByCategory(txs: Transaction[], month: string): CategorySpend[] {
  const prev = shiftMonth(month, -1)
  const map = new Map<string, CategorySpend>()
  for (const t of txs) {
    const m = monthKey(t.date)
    if ((m !== month && m !== prev) || categoryKind(t.categoryId) !== 'expense') continue
    let e = map.get(t.categoryId)
    if (!e) map.set(t.categoryId, (e = { categoryId: t.categoryId, amount: 0, previous: 0, count: 0 }))
    if (m === month) {
      e.amount -= t.amount
      e.count++
    } else e.previous -= t.amount
  }
  return [...map.values()]
    .map((e) => ({ ...e, amount: round2(Math.max(0, e.amount)), previous: round2(Math.max(0, e.previous)) }))
    .filter((e) => e.amount > 0 || e.previous > 0)
    .sort((a, b) => b.amount - a.amount)
}

/** Cumulative spending by day of month — this month against last month. */
export function cumulativeSpend(txs: Transaction[], month: string, upToDay: number) {
  const prev = shiftMonth(month, -1)
  const days = Math.max(daysInMonth(month), daysInMonth(prev))
  const cur = new Array(days + 1).fill(0)
  const last = new Array(days + 1).fill(0)
  for (const t of txs) {
    if (categoryKind(t.categoryId) !== 'expense') continue
    const m = monthKey(t.date)
    const d = Number(t.date.slice(8, 10))
    if (m === month) cur[d] -= t.amount
    else if (m === prev) last[d] -= t.amount
  }
  const out: { day: number; current: number | null; previous: number | null }[] = []
  let a = 0
  let b = 0
  for (let d = 1; d <= days; d++) {
    a += cur[d]
    b += last[d]
    out.push({
      day: d,
      current: d <= upToDay && d <= daysInMonth(month) ? round2(a) : null,
      previous: d <= daysInMonth(prev) ? round2(b) : null,
    })
  }
  return out
}

export interface BudgetStatus {
  categoryId: string
  limit: number
  spent: number
  projected: number
  status: 'ok' | 'warning' | 'over'
}

/** Linear month-end projection. `dayOfMonth` is today for the current month, or the month length for past months. */
export function budgetStatus(budgets: Budget[], spend: CategorySpend[], month: string, dayOfMonth: number): BudgetStatus[] {
  const dim = daysInMonth(month)
  const elapsed = Math.min(Math.max(dayOfMonth, 1), dim)
  return budgets
    .filter((b) => b.limit > 0)
    .map((b) => {
      const spent = spend.find((s) => s.categoryId === b.categoryId)?.amount ?? 0
      const projected = elapsed >= dim ? spent : round2((spent / elapsed) * dim)
      const status: BudgetStatus['status'] = spent > b.limit ? 'over' : projected > b.limit ? 'warning' : 'ok'
      return { categoryId: b.categoryId, limit: b.limit, spent, projected, status }
    })
    .sort((a, b) => b.spent / b.limit - a.spent / a.limit)
}

/** Suggested budget: average of the last three complete months, rounded up to a friendly number. */
export function suggestBudget(txs: Transaction[], categoryId: string, month: string): number {
  const totals = [1, 2, 3].map((k) => {
    const m = shiftMonth(month, -k)
    return txs.filter((t) => t.categoryId === categoryId && monthKey(t.date) === m).reduce((s, t) => s - t.amount, 0)
  })
  const avg = totals.reduce((a, b) => a + b, 0) / 3
  if (avg <= 0) return 0
  const step = avg > 500 ? 50 : avg > 100 ? 10 : 5
  return Math.ceil(avg / step) * step
}
