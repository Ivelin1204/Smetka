import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { MonthPicker, type PeriodCtx } from '../App'
import { db } from '../db'
import { useI18n } from '../i18n'
import { CATEGORIES } from '../lib/categories'
import { formatMoney } from '../lib/money'
import { budgetStatus, spendByCategory, suggestBudget } from '../lib/stats'
import type { Transaction } from '../lib/types'
import { CategoryIcon, fromTyping, Icon, MoneyInput, Progress, toTyping } from '../ui'

export default function Budgets({ txs, period }: { txs: Transaction[]; period: PeriodCtx }) {
  const { t, cat, locale } = useI18n()
  const { month, dayOfMonth } = period
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [])
  const spend = useMemo(() => spendByCategory(txs, month), [txs, month])
  const status = useMemo(() => budgetStatus(budgets, spend, month, dayOfMonth), [budgets, spend, month, dayOfMonth])
  const fmt = (n: number) => formatMoney(n, locale)

  const expenseCats = CATEGORIES.filter((c) => c.kind === 'expense')
  // Budgeted categories first (most used), then the rest by spending.
  const ordered = [...expenseCats].sort((a, b) => {
    const sa = status.findIndex((s) => s.categoryId === a.id)
    const sb = status.findIndex((s) => s.categoryId === b.id)
    if ((sa >= 0) !== (sb >= 0)) return sa >= 0 ? -1 : 1
    if (sa >= 0) return sa - sb
    return (spend.find((s) => s.categoryId === b.id)?.amount ?? 0) - (spend.find((s) => s.categoryId === a.id)?.amount ?? 0)
  })

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>{t('bud.title')}</h1>
          <p className="muted subtitle">{t('bud.text')}</p>
        </div>
        <MonthPicker period={period} />
      </header>

      <div className="budget-list">
        {ordered.map((c, i) => {
          const s = status.find((x) => x.categoryId === c.id)
          const spent = spend.find((x) => x.categoryId === c.id)?.amount ?? 0
          return (
            <div key={c.id} className={'card budget-row rise' + (s ? '' : ' unset')} style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}>
              <div className="budget-top">
                <span className="row gap-s grow min0">
                  <CategoryIcon id={c.id} />
                  <strong className="ellipsis">{cat(c.id)}</strong>
                </span>
                <LimitEditor categoryId={c.id} limit={s?.limit ?? budgets.find((b) => b.categoryId === c.id)?.limit ?? 0} />
              </div>
              {s ? (
                <>
                  <Progress value={s.spent} max={s.limit} status={s.status} marker={period.isCurrent ? s.projected : undefined} />
                  <div className="budget-meta small">
                    <span>
                      <span className={'num strong ' + (s.status === 'over' ? 'bad' : '')}>{fmt(s.spent)}</span> <span className="muted">{t('bud.spent')}</span>
                    </span>
                    {period.isCurrent && s.projected !== s.spent && (
                      <span className={'muted ' + (s.status === 'warning' ? 'warn-text' : '')}>{t('bud.projected', { amount: fmt(s.projected) })}</span>
                    )}
                    <span className={s.status === 'over' ? 'bad' : 'muted'}>
                      {s.spent > s.limit ? t('bud.overBy', { amount: fmt(s.spent - s.limit) }) : t('bud.left', { amount: fmt(s.limit - s.spent) })}
                    </span>
                  </div>
                </>
              ) : (
                <UnsetMeta categoryId={c.id} spent={spent} suggestion={suggestBudget(txs, c.id, month)} />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function UnsetMeta({ categoryId, spent, suggestion }: { categoryId: string; spent: number; suggestion: number }) {
  const { t, locale } = useI18n()
  if (!spent && !suggestion) return null
  return (
    <div className="budget-meta small muted">
      <span>
        <span className="num">{formatMoney(spent, locale)}</span> {t('bud.spent')}
      </span>
      {suggestion > 0 && (
        <button className="suggest" title={t('bud.suggestHint')} onClick={() => db.budgets.put({ categoryId, limit: suggestion })}>
          <Icon name="sparkle" size={13} /> {t('bud.suggest')} {formatMoney(suggestion, locale, { compact: true })}
        </button>
      )}
    </div>
  )
}

function LimitEditor({ categoryId, limit }: { categoryId: string; limit: number }) {
  const { t, locale } = useI18n()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const save = async (value: number) => {
    if (value > 0) await db.budgets.put({ categoryId, limit: value })
    else await db.budgets.delete(categoryId)
    setEditing(false)
  }

  if (editing) {
    return (
      <form
        className="limit-edit"
        onSubmit={(e) => {
          e.preventDefault()
          save(Math.abs(fromTyping(draft, locale) ?? 0))
        }}
      >
        <span className="muted">€</span>
        <MoneyInput autoFocus value={draft} onChange={setDraft} onBlur={() => save(Math.abs(fromTyping(draft, locale) ?? 0))} onKeyDown={(e) => e.key === 'Escape' && setEditing(false)} />
      </form>
    )
  }
  return (
    <span className="row gap-s">
      <button
        className={'limit-btn' + (limit ? '' : ' empty')}
        onClick={() => {
          setDraft(limit ? toTyping(limit, locale).replace(/[,.]00$/, '') : '')
          setEditing(true)
        }}
      >
        {limit ? formatMoney(limit, locale, { compact: true }) : <><Icon name="plus" size={14} /> {t('bud.limit')}</>}
      </button>
    </span>
  )
}
