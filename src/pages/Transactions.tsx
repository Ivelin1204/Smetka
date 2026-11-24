import { useDeferredValue, useMemo, useState } from 'react'
import type { Nav } from '../App'
import { learnFromMerchant, previewMerchantRule, setCategory } from '../db'
import { useI18n } from '../i18n'
import { CATEGORIES } from '../lib/categories'
import { monthKey } from '../lib/dates'
import { formatMoney } from '../lib/money'
import type { Transaction } from '../lib/types'
import { CategoryIcon, Icon, Modal, Segmented, Select, useToast, type Option } from '../ui'

type Flow = 'all' | 'out' | 'in'
const PAGE = 80

export default function Transactions({ txs, nav, months }: { txs: Transaction[]; nav: Nav; months: string[] }) {
  const { t, cat, locale } = useI18n()
  const toast = useToast()
  const [query, setQuery] = useState('')
  const q = useDeferredValue(query.trim().toUpperCase())
  const [flow, setFlow] = useState<Flow>('all')
  const category = nav.params.get('category') ?? ''
  const month = nav.params.get('month') ?? ''
  const [limit, setLimit] = useState(PAGE)
  const [learn, setLearn] = useState<{ tx: Transaction; categoryId: string; n: number } | null>(null)

  const setFilter = (key: 'category' | 'month', value: string) => {
    const p = Object.fromEntries(nav.params)
    if (value) p[key] = value
    else delete p[key]
    nav.go('transactions', p)
    setLimit(PAGE)
  }

  const filtered = useMemo(
    () =>
      txs.filter(
        (x) =>
          (!category || x.categoryId === category) &&
          (!month || monthKey(x.date) === month) &&
          (flow === 'all' || (flow === 'out' ? x.amount < 0 : x.amount > 0)) &&
          (!q || x.description.toUpperCase().includes(q) || x.merchant.toUpperCase().includes(q)),
      ),
    [txs, category, month, flow, q],
  )
  const total = filtered.reduce((s, x) => s + x.amount, 0)

  const catOptions: Option<string>[] = [
    { value: '', label: t('tx.allCategories') },
    ...CATEGORIES.map((c) => ({ value: c.id, label: cat(c.id), icon: <CategoryIcon id={c.id} /> })),
  ]
  const monthOptions: Option<string>[] = [
    { value: '', label: t('tx.allMonths') },
    ...[...months].reverse().map((m) => ({ value: m, label: new Date(m + '-01T00:00:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' }) })),
  ]
  const pickOptions: Option<string>[] = CATEGORIES.map((c) => ({ value: c.id, label: cat(c.id), icon: <CategoryIcon id={c.id} /> }))

  const change = async (tx: Transaction, categoryId: string) => {
    if (categoryId === tx.categoryId) return
    await setCategory(tx.id, categoryId)
    const n = await previewMerchantRule(tx.merchant, tx.id)
    setLearn({ tx, categoryId, n })
  }

  // Group rows by day for a calmer list.
  const visible = filtered.slice(0, limit)
  const groups: { date: string; items: Transaction[] }[] = []
  for (const x of visible) {
    const g = groups[groups.length - 1]
    if (g && g.date === x.date) g.items.push(x)
    else groups.push({ date: x.date, items: [x] })
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('nav.transactions')}</h1>
      </header>

      <div className="filters rise">
        <label className="search">
          <Icon name="search" size={17} />
          <input value={query} onChange={(e) => (setQuery(e.target.value), setLimit(PAGE))} placeholder={t('tx.search')} />
          {query && (
            <button className="icon-btn sm" onClick={() => setQuery('')} aria-label={t('common.close')}>
              <Icon name="x" size={15} />
            </button>
          )}
        </label>
        <Segmented<Flow>
          value={flow}
          onChange={(v) => (setFlow(v), setLimit(PAGE))}
          options={[
            { value: 'all', label: t('tx.all') },
            { value: 'out', label: t('tx.out') },
            { value: 'in', label: t('tx.in') },
          ]}
        />
        <Select value={category} options={catOptions} onChange={(v) => setFilter('category', v)} ariaLabel={t('tx.category')} />
        <Select value={month} options={monthOptions} onChange={(v) => setFilter('month', v)} ariaLabel={t('tx.date')} />
      </div>

      <div className="tx-summary muted small">
        <span>{t('tx.count', { n: filtered.length })}</span>
        <span className="num">{t('tx.total', { amount: formatMoney(total, locale, { sign: true }) })}</span>
      </div>

      {filtered.length === 0 ? (
        <div className="card empty-mini">
          <p className="muted">{t('tx.none')}</p>
        </div>
      ) : (
        <div className="card tx-card">
          {groups.map((g) => (
            <div key={g.date} className="tx-group">
              <div className="tx-date">{new Date(g.date + 'T00:00:00').toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long' })}</div>
              {g.items.map((x) => (
                <div key={x.id} className="tx-row">
                  <CategoryIcon id={x.categoryId} />
                  <div className="tx-main min0">
                    <div className="tx-merchant ellipsis">{x.merchant}</div>
                    <div className="tx-desc muted small ellipsis" title={x.description}>
                      {x.description}
                    </div>
                  </div>
                  <Select
                    className={'cat-select' + (x.categoryId === 'other' ? ' attention' : '')}
                    value={x.categoryId}
                    options={pickOptions}
                    onChange={(v) => change(x, v)}
                    ariaLabel={t('tx.category')}
                    renderValue={(o) => (
                      <>
                        <span className="ellipsis">{o?.label}</span>
                        {x.categorySource === 'manual' && <span className="tag">{t('tx.manual')}</span>}
                      </>
                    )}
                  />
                  <div className="tx-amount">
                    <span className={'num strong ' + (x.amount > 0 ? 'good' : '')}>{formatMoney(x.amount, locale, { sign: x.amount > 0 })}</span>
                    {x.originalCurrency !== 'EUR' && (
                      <span className="muted small num">
                        {x.originalAmount.toFixed(2)} {x.originalCurrency === 'BGN' ? 'лв.' : x.originalCurrency}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {filtered.length > limit && (
            <button className="btn ghost more" onClick={() => setLimit((l) => l + PAGE)}>
              {t('tx.more')} ({filtered.length - limit})
            </button>
          )}
        </div>
      )}

      <Modal
        open={!!learn}
        onClose={() => setLearn(null)}
        title={
          <span className="row gap-s">
            <Icon name="sparkle" className="accent" /> {t('tx.learnTitle')}
          </span>
        }
        actions={
          <>
            <button className="btn ghost" onClick={() => setLearn(null)}>
              {t('tx.learnNo')}
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                if (!learn) return
                const n = await learnFromMerchant(learn.tx.merchant, learn.categoryId)
                setLearn(null)
                toast(t('tx.learned', { n }))
              }}
            >
              {t('tx.learnYes')}
            </button>
          </>
        }
      >
        {learn && <p>{t('tx.learnText', { merchant: learn.tx.merchant, category: cat(learn.categoryId), n: learn.n })}</p>}
      </Modal>
    </div>
  )
}
