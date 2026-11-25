import Dexie, { type EntityTable } from 'dexie'
import { BUILTIN_RULES } from './lib/categories'
import { categorize, extractMerchant, haystack, patternFromMerchant, ruleMatches, sortRules } from './lib/categorize'
import { fingerprint, hash, type MappedRow } from './lib/csv'
import { generateDemo } from './lib/demo'
import { todayISO } from './lib/dates'
import type { BalanceSnapshot, Budget, ImportRecord, MappingProfile, Rule, Transaction } from './lib/types'

/** Everything lives in the browser (IndexedDB). Nothing is ever uploaded. */
export const db = new Dexie('smetka') as Dexie & {
  transactions: EntityTable<Transaction, 'id'>
  rules: EntityTable<Rule, 'id'>
  profiles: EntityTable<MappingProfile, 'signature'>
  imports: EntityTable<ImportRecord, 'id'>
  budgets: EntityTable<Budget, 'categoryId'>
  balances: EntityTable<BalanceSnapshot, 'id'>
}

db.version(1).stores({
  transactions: 'id, date, categoryId, merchant, importId',
  rules: 'id, origin, categoryId',
  profiles: 'signature',
  imports: 'id, createdAt',
  budgets: 'categoryId',
})
db.version(2).stores({ balances: 'id, date, importId' })

export async function allRules(): Promise<Rule[]> {
  const user = await db.rules.toArray()
  return sortRules([...user, ...BUILTIN_RULES])
}

export interface ImportResult {
  added: number
  duplicates: number
  categorized: number
  importId: string
}

export async function importRows(rows: MappedRow[], fileName: string, errors: number, balances: { date: string; amount: number }[] = []): Promise<ImportResult> {
  const rules = await allRules()
  const ids = fingerprint(rows)
  const importId = 'imp_' + hash(fileName + Date.now())
  const existing = new Set((await db.transactions.bulkGet(ids)).filter(Boolean).map((t) => t!.id))
  const fresh: Transaction[] = []
  const seen = new Set<string>()
  rows.forEach((r, i) => {
    const id = ids[i]
    if (existing.has(id) || seen.has(id)) return
    seen.add(id)
    const c = categorize(r.description, r.amount, rules)
    fresh.push({
      id,
      date: r.date,
      description: r.description,
      merchant: extractMerchant(r.description),
      amount: r.amount,
      originalAmount: r.originalAmount,
      originalCurrency: r.originalCurrency,
      categoryId: c.categoryId,
      categorySource: c.source,
      importId,
    })
  })
  await db.transaction('rw', db.transactions, db.imports, db.balances, async () => {
    await db.transactions.bulkAdd(fresh)
    await db.imports.add({ id: importId, fileName, createdAt: Date.now(), added: fresh.length, duplicates: rows.length - fresh.length, errors })
    // Statement balances are keyed by day, so re-importing an overlapping file just refreshes them.
    await db.balances.bulkPut(balances.map((b) => ({ id: `stmt_${b.date}`, date: b.date, amount: b.amount, source: 'statement' as const, importId, createdAt: Date.now() })))
  })
  return {
    added: fresh.length,
    duplicates: rows.length - fresh.length,
    categorized: fresh.filter((t) => t.categorySource === 'rule').length,
    importId,
  }
}

export async function loadDemo(): Promise<ImportResult> {
  const raw = generateDemo()
  const rows: MappedRow[] = raw.map((r, i) => ({ line: i + 1, ...r, originalAmount: r.amount, originalCurrency: 'EUR' }))
  // Pretend the latest statement said what the account holds today.
  const res = await importRows(rows, 'demo-data', 0, [{ date: todayISO(), amount: 3482.17 }])
  if (!(await db.budgets.count())) {
    await db.budgets.bulkPut([
      { categoryId: 'groceries', limit: 320 },
      { categoryId: 'dining', limit: 150 },
      { categoryId: 'transport', limit: 60 },
      { categoryId: 'shopping', limit: 120 },
      { categoryId: 'subscriptions', limit: 100 },
    ])
  }
  return res
}

export async function setCategory(id: string, categoryId: string) {
  await db.transactions.update(id, { categoryId, categorySource: 'manual' })
}

/** Counts transactions a merchant rule would re-categorize (manual choices are never overwritten). */
export async function previewMerchantRule(merchant: string, exceptId?: string) {
  const pattern = patternFromMerchant(merchant)
  const probe: Rule = { id: '', pattern, categoryId: '', origin: 'user', createdAt: 0 }
  return db.transactions.filter((t) => t.id !== exceptId && t.categorySource !== 'manual' && ruleMatches(probe, haystack(t.description))).count()
}

/** "Teach" the app: create a rule from a merchant and apply it to every non-manual match. */
export async function learnFromMerchant(merchant: string, categoryId: string): Promise<number> {
  const pattern = patternFromMerchant(merchant)
  const rule: Rule = { id: 'user_' + hash(pattern), pattern, categoryId, origin: 'user', createdAt: Date.now() }
  await db.rules.put(rule)
  return reapplyRules()
}

/** Re-runs categorization over everything except manual choices. Returns how many changed. */
export async function reapplyRules(): Promise<number> {
  const rules = await allRules()
  let changed = 0
  await db.transaction('rw', db.transactions, async () => {
    await db.transactions
      .filter((t) => t.categorySource !== 'manual')
      .modify((t) => {
        const c = categorize(t.description, t.amount, rules)
        if (c.categoryId !== t.categoryId || c.source !== t.categorySource) {
          t.categoryId = c.categoryId
          t.categorySource = c.source
          changed++
        }
      })
  })
  return changed
}

export async function deleteRule(id: string) {
  await db.rules.delete(id)
  await reapplyRules()
}

export async function clearAll() {
  await Promise.all([db.transactions.clear(), db.rules.clear(), db.profiles.clear(), db.imports.clear(), db.budgets.clear(), db.balances.clear()])
}

/** The balance the user says the account holds today. */
export async function setManualBalance(amount: number) {
  const date = todayISO()
  await db.balances.put({ id: `manual_${date}`, date, amount, source: 'manual', createdAt: Date.now() })
}

export async function exportBackup(): Promise<string> {
  const [transactions, rules, profiles, imports, budgets, balances] = await Promise.all([
    db.transactions.toArray(),
    db.rules.toArray(),
    db.profiles.toArray(),
    db.imports.toArray(),
    db.budgets.toArray(),
    db.balances.toArray(),
  ])
  return JSON.stringify({ app: 'smetka', version: 2, exportedAt: new Date().toISOString(), transactions, rules, profiles, imports, budgets, balances })
}

export async function restoreBackup(json: string) {
  const data = JSON.parse(json)
  if (data?.app !== 'smetka') throw new Error('not-a-backup')
  await db.transaction('rw', [db.transactions, db.rules, db.profiles, db.imports, db.budgets, db.balances], async () => {
    await clearAll()
    await db.transactions.bulkPut(data.transactions ?? [])
    await db.rules.bulkPut(data.rules ?? [])
    await db.profiles.bulkPut(data.profiles ?? [])
    await db.imports.bulkPut(data.imports ?? [])
    await db.budgets.bulkPut(data.budgets ?? [])
    await db.balances.bulkPut(data.balances ?? [])
  })
}

/** Undo an import: removes exactly the transactions it added. */
export async function deleteImport(importId: string) {
  await db.transaction('rw', db.transactions, db.imports, db.balances, async () => {
    await db.transactions.where('importId').equals(importId).delete()
    await db.balances.where('importId').equals(importId).delete()
    await db.imports.delete(importId)
  })
}
