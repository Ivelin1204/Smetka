import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MonthPicker, type Nav, type PeriodCtx } from '../App'
import { db, setManualBalance } from '../db'
import { useI18n } from '../i18n'
import { CATEGORY_BY_ID } from '../lib/categories'
import { daysInMonth, monthKey, monthShort, shiftMonth, todayISO } from '../lib/dates'
import { BalanceModel } from '../lib/balance'
import { formatMoney } from '../lib/money'
import { detectRecurring } from '../lib/recurring'
import { budgetStatus, cumulativeSpend, monthlySeries, spendByCategory, summarize } from '../lib/stats'
import type { Transaction } from '../lib/types'
import { CategoryIcon, fromTyping, Icon, Modal, Money, MoneyInput, Progress, toTyping, useCountUp, useToast } from '../ui'

export default function Overview({ txs, period, nav }: { txs: Transaction[]; period: PeriodCtx; nav: Nav }) {
  const { t, cat, locale } = useI18n()
  const { month, dayOfMonth } = period
  const budgets = useLiveQuery(() => db.budgets.toArray(), [], [])

  const cur = useMemo(() => summarize(txs, month), [txs, month])
  const prev = useMemo(() => summarize(txs, shiftMonth(month, -1)), [txs, month])
  const spend = useMemo(() => spendByCategory(txs, month), [txs, month])
  const pace = useMemo(() => cumulativeSpend(txs, month, dayOfMonth), [txs, month, dayOfMonth])
  const trend = useMemo(() => monthlySeries(txs, month, 12).filter((m, i, all) => m.income || m.expenses || all.slice(0, i).some((x) => x.income || x.expenses)), [txs, month])
  const recurring = useMemo(() => detectRecurring(txs, period.isCurrent ? todayISO() : `${month}-28`), [txs, month, period.isCurrent])
  const bstat = useMemo(() => budgetStatus(budgets, spend, month, dayOfMonth), [budgets, spend, month, dayOfMonth])
  const uncategorized = txs.filter((x) => x.categoryId === 'other' && monthKey(x.date) === month).length

  const [hoverCat, setHoverCat] = useState<string | null>(null)
  const pieData = spend.filter((s) => s.amount > 0)
  const totalSpend = pieData.reduce((s, x) => s + x.amount, 0)
  const paceToday = pace[Math.min(dayOfMonth, pace.length) - 1]
  const paceDiff = (paceToday?.current ?? 0) - (paceToday?.previous ?? 0)
  const yearlySubs = recurring.reduce((s, r) => s + r.yearlyCost, 0)

  const fmt = (n: number) => formatMoney(n, locale)
  const fmtC = (n: number) => formatMoney(n, locale, { compact: true })
  const shortMonth = (m: string) => monthShort(m, locale)

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('nav.overview')}</h1>
        <MonthPicker period={period} />
      </header>

      {uncategorized > 0 && (
        <button className="banner rise" onClick={() => nav.go('transactions', { category: 'other', month })}>
          <Icon name="sparkle" size={17} className="accent" />
          <span className="grow">{t('ov.uncategorized', { n: uncategorized })}</span>
          <span className="banner-cta">
            {t('ov.review')} <Icon name="chevR" size={16} />
          </span>
        </button>
      )}

      <BalanceCard txs={txs} period={period} />

      <section className="kpis">
        <Kpi label={t('ov.income')} value={cur.income} prev={prev.income} good="up" delay={0} />
        <Kpi label={t('ov.expenses')} value={cur.expenses} prev={prev.expenses} good="down" delay={1} />
        <Kpi label={t('ov.net')} value={cur.net} prev={prev.net} good="up" delay={2} />
        <SavingsKpi rate={cur.savingsRate} prevRate={prev.savingsRate} label={t('ov.savings')} />
      </section>

      <section className="grid-2">
        <div className="card rise" style={{ animationDelay: '120ms' }}>
          <div className="card-head">
            <h2>{t('ov.pace')}</h2>
            <div className="legend">
              <span>
                <i style={{ background: 'var(--accent)' }} /> {t('ov.paceThis')}
              </span>
              <span>
                <i className="dashed" /> {t('ov.pacePrev')}
              </span>
            </div>
          </div>
          {paceToday && paceToday.previous != null && (
            <p className={'pace-note ' + (paceDiff > 0 ? 'bad' : 'good')}>
              <Icon name={paceDiff > 0 ? 'arrowUp' : 'arrowDown'} size={15} />
              {t(paceDiff > 0 ? 'ov.paceAhead' : 'ov.paceBehind', { amount: fmt(Math.abs(paceDiff)) })}
            </p>
          )}
          <div className="chart" style={{ height: 230 }}>
            <ResponsiveContainer>
              <AreaChart data={pace} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="gPace" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} interval={4} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={fmtC} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <Tooltip content={<ChartTip format={fmt} labelPrefix={t('ov.day')} names={{ current: t('ov.paceThis'), previous: t('ov.pacePrev') }} />} />
                <Area type="monotone" dataKey="previous" stroke="var(--muted)" strokeDasharray="4 4" strokeWidth={1.5} fill="none" dot={false} isAnimationActive animationDuration={700} />
                <Area type="monotone" dataKey="current" stroke="var(--accent)" strokeWidth={2.5} fill="url(#gPace)" dot={false} isAnimationActive animationDuration={900} connectNulls={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card rise donut-card" style={{ animationDelay: '180ms' }}>
          <div className="card-head">
            <h2>{t('ov.byCategory')}</h2>
          </div>
          {pieData.length === 0 ? (
            <p className="muted">{t('ov.noData')}</p>
          ) : (
            <div className="donut-wrap">
              <div className="donut">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={pieData} dataKey="amount" nameKey="categoryId" innerRadius="68%" outerRadius="100%" paddingAngle={2} cornerRadius={4} stroke="none" animationDuration={800} onMouseLeave={() => setHoverCat(null)}>
                      {pieData.map((d) => (
                        <Cell key={d.categoryId} fill={CATEGORY_BY_ID[d.categoryId]?.color} opacity={hoverCat && hoverCat !== d.categoryId ? 0.3 : 1} onMouseEnter={() => setHoverCat(d.categoryId)} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
                <DonutCenter
                  label={hoverCat ? cat(hoverCat) : t('ov.expenses')}
                  value={hoverCat ? pieData.find((d) => d.categoryId === hoverCat)?.amount ?? 0 : totalSpend}
                />
              </div>
              <ul className="cat-list">
                {pieData.slice(0, 7).map((d) => {
                  const delta = d.previous > 0 ? (d.amount - d.previous) / d.previous : null
                  return (
                    <li key={d.categoryId} onMouseEnter={() => setHoverCat(d.categoryId)} onMouseLeave={() => setHoverCat(null)} className={hoverCat === d.categoryId ? 'hl' : ''}>
                      <button onClick={() => nav.go('transactions', { category: d.categoryId, month })}>
                        <CategoryIcon id={d.categoryId} />
                        <span className="grow ellipsis">{cat(d.categoryId)}</span>
                        {delta !== null && Math.abs(delta) >= 0.1 && <span className={'delta small ' + (delta > 0 ? 'bad' : 'good')}>{delta > 0 ? '+' : '−'}{Math.round(Math.abs(delta) * 100)}%</span>}
                        <span className="num strong">{fmt(d.amount)}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      </section>

      <section className="grid-2 wide-left">
        <div className="card rise" style={{ animationDelay: '240ms' }}>
          <div className="card-head">
            <h2>{t('ov.trend')}</h2>
            <div className="legend">
              <span>
                <i style={{ background: 'var(--positive)' }} /> {t('ov.income')}
              </span>
              <span>
                <i style={{ background: 'var(--accent)' }} /> {t('ov.expenses')}
              </span>
            </div>
          </div>
          <div className="chart" style={{ height: 250 }}>
            <ResponsiveContainer>
              <BarChart data={trend} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={3} onClick={(s) => {
                const m = (s as { activeLabel?: string } | null)?.activeLabel
                if (m && period.months.includes(m)) period.setMonth(m)
              }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="month" tickFormatter={shortMonth} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={fmtC} tick={{ fill: 'var(--muted)', fontSize: 12 }} />
                <Tooltip cursor={{ fill: 'var(--hover)' }} content={<ChartTip format={fmt} labelFormat={(m) => new Date(m + '-01T00:00:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' })} names={{ income: t('ov.income'), expenses: t('ov.expenses') }} />} />
                <Bar dataKey="income" radius={[5, 5, 0, 0]} maxBarSize={22} animationDuration={800}>
                  {trend.map((m) => (
                    <Cell key={m.month} fill="var(--positive)" opacity={m.month === month ? 1 : 0.45} cursor="pointer" />
                  ))}
                </Bar>
                <Bar dataKey="expenses" radius={[5, 5, 0, 0]} maxBarSize={22} animationDuration={800}>
                  {trend.map((m) => (
                    <Cell key={m.month} fill="var(--accent)" opacity={m.month === month ? 1 : 0.45} cursor="pointer" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card rise" style={{ animationDelay: '300ms' }}>
          <div className="card-head">
            <h2>{t('ov.budgets')}</h2>
            <button className="link" onClick={() => nav.go('budgets')}>
              <Icon name="chevR" size={16} />
            </button>
          </div>
          {bstat.length === 0 ? (
            <div className="empty-mini">
              <p className="muted">{t('ov.noBudgets')}</p>
              <button className="btn ghost sm" onClick={() => nav.go('budgets')}>
                {t('ov.setBudgets')}
              </button>
            </div>
          ) : (
            <ul className="budget-mini">
              {bstat.slice(0, 5).map((b) => (
                <li key={b.categoryId}>
                  <div className="row between">
                    <span className="row gap-s">
                      <CategoryIcon id={b.categoryId} />
                      {cat(b.categoryId)}
                    </span>
                    <span className="small">
                      <span className={'num strong ' + (b.status === 'over' ? 'bad' : '')}>{fmtC(b.spent)}</span>
                      <span className="muted"> / {fmtC(b.limit)}</span>
                    </span>
                  </div>
                  <Progress value={b.spent} max={b.limit} status={b.status} marker={period.isCurrent ? b.projected : undefined} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="card rise" style={{ animationDelay: '360ms' }}>
        <div className="card-head">
          <h2>{t('ov.subs')}</h2>
          {yearlySubs > 0 && <span className="pill">{t('ov.subsYear', { amount: fmt(yearlySubs) })}</span>}
        </div>
        {recurring.length === 0 ? (
          <p className="muted">{t('ov.subsNone')}</p>
        ) : (
          <div className="subs">
            {recurring.map((r) => (
              <div key={r.merchant} className="sub">
                <CategoryIcon id={r.categoryId} />
                <div className="grow min0">
                  <div className="row gap-s">
                    <strong className="ellipsis">{r.merchant}</strong>
                    {r.priceIncrease && (
                      <span className="tag warn">
                        <Icon name="arrowUp" size={12} /> {t('ov.priceUp')}
                      </span>
                    )}
                  </div>
                  <div className="muted small">
                    {t(`cad.${r.cadence}`)} · {t('ov.next', { date: new Date(r.nextDate).toLocaleDateString(locale, { day: 'numeric', month: 'short' }) })}
                  </div>
                </div>
                <div className="right">
                  <div className="num strong">{fmt(r.amount)}</div>
                  <div className="muted small num">{fmtC(r.yearlyCost)}/{locale.startsWith('bg') ? 'год.' : 'yr'}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

/** What the account holds: from statement balances or a balance the user typed in, rolled through the transactions. */
function BalanceCard({ txs, period }: { txs: Transaction[]; period: PeriodCtx }) {
  const { t, locale } = useI18n()
  const toast = useToast()
  const snapshots = useLiveQuery(() => db.balances.toArray(), [], undefined)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const today = todayISO()
  const model = useMemo(() => new BalanceModel(txs, snapshots ?? []), [txs, snapshots])
  if (snapshots === undefined) return null

  const { month, isCurrent } = period
  const endDay = isCurrent ? today : `${month}-${String(daysInMonth(month)).padStart(2, '0')}`
  const value = model.on(endDay)
  // Balance going into the month = end of its last day before it.
  const startOfMonth = model.on(`${shiftMonth(month, -1)}-${String(daysInMonth(shiftMonth(month, -1))).padStart(2, '0')}`)
  const anchor = model.anchorFor(endDay)
  const firstMonth = txs.length ? monthKey(txs[txs.length - 1].date) : undefined
  const series = model.monthly(month, 12, today, firstMonth)
  const fmt = (n: number) => formatMoney(n, locale)
  const fmtC = (n: number) => formatMoney(n, locale, { compact: true })
  const dateLabel = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' })

  const save = async () => {
    const v = fromTyping(draft, locale)
    if (v == null) return
    await setManualBalance(v)
    setEditing(false)
    toast(t('bal.saved'))
  }
  const editor = (
    <Modal
      open={editing}
      onClose={() => setEditing(false)}
      title={t('bal.editTitle')}
      actions={
        <>
          <button className="btn ghost" onClick={() => setEditing(false)}>
            {t('common.cancel')}
          </button>
          <button className="btn primary" disabled={fromTyping(draft, locale) == null} onClick={save}>
            {t('bud.save')}
          </button>
        </>
      }
    >
      <p>{t('bal.editText', { date: dateLabel(today) })}</p>
      <form
        className="balance-input"
        onSubmit={(e) => {
          e.preventDefault()
          save()
        }}
      >
        <MoneyInput autoFocus value={draft} onChange={setDraft} placeholder={toTyping(1250, locale)} aria-label={t('bal.title')} />
        <span>€</span>
      </form>
    </Modal>
  )
  const open = () => {
    const now = model.on(today)
    setDraft(now != null ? toTyping(now, locale) : '')
    setEditing(true)
  }

  if (!model.hasData || value == null) {
    return (
      <section className="card balance-card empty rise">
        <div className="balance-empty">
          <div>
            <h2>{t('bal.askTitle')}</h2>
            <p className="muted">{t('bal.askText')}</p>
          </div>
          <button className="btn primary" onClick={open}>
            <Icon name="plus" size={16} /> {t('bal.enter')}
          </button>
        </div>
        {editor}
      </section>
    )
  }

  const change = startOfMonth != null ? value - startOfMonth : null
  return (
    <section className="card balance-card rise">
      <div className="balance-main">
        <span className="kpi-label">{isCurrent ? t('bal.today') : t('bal.endOf', { month: new Date(month + '-01T00:00:00').toLocaleDateString(locale, { month: 'long' }) })}</span>
        <Money value={value} className="balance-value" />
        {change != null && Math.abs(change) >= 0.01 && (
          <span className={'delta ' + (change >= 0 ? 'good' : 'bad')}>
            <Icon name={change >= 0 ? 'arrowUp' : 'arrowDown'} size={13} />
            {formatMoney(change, locale, { sign: true })} <span className="muted">{t('bal.sinceStart')}</span>
          </span>
        )}
        {anchor && (
          <span className="muted small balance-source">
            {t(anchor.source === 'manual' ? 'bal.fromManual' : 'bal.fromStatement', { date: dateLabel(anchor.date) })}
            <button className="link-btn" onClick={open}>
              {t('bal.update')}
            </button>
          </span>
        )}
      </div>
      {series.length > 1 && (
        <div className="balance-chart">
          <ResponsiveContainer>
            <AreaChart data={series} margin={{ top: 6, right: 4, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="gBal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--positive)" stopOpacity={0.3} />
                  <stop offset="100%" stopColor="var(--positive)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="month" tickFormatter={(m: string) => monthShort(m, locale)} tickLine={false} axisLine={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} interval="preserveStartEnd" />
              <YAxis hide domain={['dataMin - 100', 'dataMax + 100']} />
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.length ? (
                    <div className="chart-tip">
                      <div className="muted small">{new Date(String(payload[0].payload.month) + '-01T00:00:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' })}</div>
                      <strong className="num">{fmt(Number(payload[0].value))}</strong>
                    </div>
                  ) : null
                }
              />
              <Area type="monotone" dataKey="balance" stroke="var(--positive)" strokeWidth={2.2} fill="url(#gBal)" dot={false} animationDuration={900} />
            </AreaChart>
          </ResponsiveContainer>
          <span className="muted small balance-range num">
            {fmtC(Math.min(...series.map((x) => x.balance)))} – {fmtC(Math.max(...series.map((x) => x.balance)))}
          </span>
        </div>
      )}
      {editor}
    </section>
  )
}

function Kpi({ label, value, prev, good, delay }: { label: string; value: number; prev: number; good: 'up' | 'down'; delay: number }) {
  const { t } = useI18n()
  // A % change is only meaningful against a real baseline of the same sign.
  const delta = Math.abs(prev) >= 1 && Math.sign(prev) === Math.sign(value || prev) ? (value - prev) / Math.abs(prev) : null
  const isGood = delta === null ? null : good === 'up' ? delta >= 0 : delta <= 0
  return (
    <div className="card kpi rise" style={{ animationDelay: `${delay * 60}ms` }}>
      <span className="kpi-label">{label}</span>
      <Money value={value} className="kpi-value" />
      {delta !== null && Number.isFinite(delta) && Math.abs(delta) <= 5 && (
        <span className={'delta ' + (isGood ? 'good' : 'bad')}>
          <Icon name={delta >= 0 ? 'arrowUp' : 'arrowDown'} size={13} />
          {Math.round(Math.abs(delta) * 100)}% <span className="muted">{t('ov.vsPrev')}</span>
        </span>
      )}
    </div>
  )
}

function SavingsKpi({ rate, prevRate, label }: { rate: number; prevRate: number; label: string }) {
  const v = useCountUp(rate * 100)
  const diff = Math.round((rate - prevRate) * 100)
  const pct = Math.max(0, Math.min(100, rate * 100))
  return (
    <div className="card kpi rise" style={{ animationDelay: '180ms' }}>
      <span className="kpi-label">{label}</span>
      <span className="kpi-value num">{Math.round(v)}%</span>
      <div className="ring" style={{ ['--p' as string]: pct }} aria-hidden />
      {prevRate !== 0 && (
        <span className={'delta ' + (diff >= 0 ? 'good' : 'bad')}>
          <Icon name={diff >= 0 ? 'arrowUp' : 'arrowDown'} size={13} />
          {Math.abs(diff)} pp
        </span>
      )}
    </div>
  )
}

function DonutCenter({ label, value }: { label: string; value: number }) {
  return (
    <div className="donut-center">
      <span className="muted small ellipsis">{label}</span>
      <Money value={value} compact className="donut-value" />
    </div>
  )
}

interface TipProps {
  active?: boolean
  payload?: { dataKey: string; value: number | null; color?: string; stroke?: string; fill?: string }[]
  label?: string | number
  format: (n: number) => string
  names: Record<string, string>
  labelPrefix?: string
  labelFormat?: (l: string) => string
}

function ChartTip({ active, payload, label, format, names, labelPrefix, labelFormat }: TipProps) {
  if (!active || !payload?.length) return null
  const rows = payload.filter((p) => p.value != null)
  if (!rows.length) return null
  return (
    <div className="chart-tip">
      <div className="muted small">{labelFormat ? labelFormat(String(label)) : `${labelPrefix ?? ''} ${label}`}</div>
      {rows.map((p) => (
        <div key={p.dataKey} className="row between gap">
          <span className="small">{names[p.dataKey] ?? p.dataKey}</span>
          <strong className="num">{format(p.value as number)}</strong>
        </div>
      ))}
    </div>
  )
}
