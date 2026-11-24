import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useState } from 'react'
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { MonthPicker, type Nav, type PeriodCtx } from '../App'
import { db } from '../db'
import { useI18n } from '../i18n'
import { CATEGORY_BY_ID } from '../lib/categories'
import { monthKey, shiftMonth, todayISO } from '../lib/dates'
import { formatMoney } from '../lib/money'
import { detectRecurring } from '../lib/recurring'
import { budgetStatus, cumulativeSpend, monthlySeries, spendByCategory, summarize } from '../lib/stats'
import type { Transaction } from '../lib/types'
import { CategoryIcon, Icon, Money, Progress, useCountUp } from '../ui'

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
  const shortMonth = (m: string) => new Date(m + '-01T00:00:00').toLocaleDateString(locale, { month: 'short' })

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
