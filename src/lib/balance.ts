import { daysInMonth, monthKey, shiftMonth } from './dates'
import { round2 } from './money'
import type { BalanceSnapshot, Transaction } from './types'

/**
 * The account balance on any day, from a few known points ("snapshots") plus the transactions:
 *   after a snapshot:  balance = snapshot + everything that happened after it, up to that day
 *   before the first:  balance = first snapshot − everything between that day and the snapshot
 * Every snapshot re-anchors the line, so a missing transaction only skews the days until the next one.
 */
export class BalanceModel {
  private days: string[] = []
  private prefix: number[] = []
  private anchors: BalanceSnapshot[] = []

  constructor(txs: Pick<Transaction, 'date' | 'amount'>[], snapshots: BalanceSnapshot[]) {
    const net = new Map<string, number>()
    for (const t of txs) net.set(t.date, (net.get(t.date) ?? 0) + t.amount)
    this.days = [...net.keys()].sort()
    let run = 0
    this.prefix = this.days.map((d) => (run += net.get(d)!))

    // One anchor per day: what the user typed in beats a statement; otherwise the newest wins.
    const byDay = new Map<string, BalanceSnapshot>()
    for (const s of snapshots) {
      const cur = byDay.get(s.date)
      const better = !cur || (s.source === 'manual' && cur.source !== 'manual') || (s.source === cur.source && s.createdAt > cur.createdAt)
      if (better) byDay.set(s.date, s)
    }
    this.anchors = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
  }

  get hasData() {
    return this.anchors.length > 0
  }

  /** Sum of transactions on days ≤ date */
  private cumulative(date: string): number {
    let lo = 0
    let hi = this.days.length - 1
    let ans = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (this.days[mid] <= date) (ans = mid), (lo = mid + 1)
      else hi = mid - 1
    }
    return ans < 0 ? 0 : this.prefix[ans]
  }

  /** The snapshot a given day is computed from */
  anchorFor(date: string): BalanceSnapshot | null {
    if (!this.anchors.length) return null
    let found: BalanceSnapshot | null = null
    for (const a of this.anchors) {
      if (a.date <= date) found = a
      else break
    }
    return found ?? this.anchors[0]
  }

  /** End-of-day balance in EUR, or null without any snapshot */
  on(date: string): number | null {
    const a = this.anchorFor(date)
    if (!a) return null
    return round2(a.amount + this.cumulative(date) - this.cumulative(a.date))
  }

  /** Balance at the end of each month (or on `today` for the current month) */
  monthly(endMonth: string, count: number, today: string, firstMonth?: string): { month: string; balance: number }[] {
    const out: { month: string; balance: number }[] = []
    for (let i = count - 1; i >= 0; i--) {
      const m = shiftMonth(endMonth, -i)
      if (firstMonth && m < firstMonth) continue
      const day = m === monthKey(today) ? today : `${m}-${String(daysInMonth(m)).padStart(2, '0')}`
      const b = this.on(day)
      if (b != null) out.push({ month: m, balance: b })
    }
    return out
  }
}
