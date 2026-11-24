import { useLiveQuery } from 'dexie-react-hooks'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { db } from './db'
import { daysInMonth, monthKey, shiftMonth, todayISO } from './lib/dates'
import type { Transaction } from './lib/types'
import { useI18n } from './i18n'
import { Icon } from './ui'
import Welcome from './pages/Welcome'

// Pages load on demand — the charting library only downloads when the overview is opened.
const Overview = lazy(() => import('./pages/Overview'))
const Transactions = lazy(() => import('./pages/Transactions'))
const ImportPage = lazy(() => import('./pages/Import'))
const Budgets = lazy(() => import('./pages/Budgets'))
const Settings = lazy(() => import('./pages/Settings'))

// Plain #name hashes (no #/path) so links survive hosts that only pass simple fragments. 'rules' rather than 'settings', a name some hosts reserve.
export type Route = 'overview' | 'transactions' | 'import' | 'budgets' | 'rules'
const ROUTES: Route[] = ['overview', 'transactions', 'import', 'budgets', 'rules']
const NAV: { route: Route; icon: string; key: 'nav.overview' | 'nav.transactions' | 'nav.import' | 'nav.budgets' | 'nav.settings' }[] = [
  { route: 'overview', icon: 'overview', key: 'nav.overview' },
  { route: 'transactions', icon: 'list', key: 'nav.transactions' },
  { route: 'import', icon: 'upload', key: 'nav.import' },
  { route: 'budgets', icon: 'target', key: 'nav.budgets' },
  { route: 'rules', icon: 'sliders', key: 'nav.settings' },
]

export interface Nav {
  go: (r: Route, params?: Record<string, string>) => void
  params: URLSearchParams
}

function readHash(): { route: Route; params: URLSearchParams } {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?')
  return { route: ROUTES.includes(path as Route) ? (path as Route) : 'overview', params: new URLSearchParams(query ?? '') }
}

function useHashRoute(): [Route, Nav] {
  const [state, setState] = useState(readHash)
  useEffect(() => {
    const on = () => {
      setState(readHash())
      window.scrollTo({ top: 0 })
    }
    addEventListener('hashchange', on)
    return () => removeEventListener('hashchange', on)
  }, [])
  const go = (r: Route, params?: Record<string, string>) => {
    location.hash = `${r}${params ? '?' + new URLSearchParams(params) : ''}`
  }
  return [state.route, { go, params: state.params }]
}

function useTheme() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem('smetka.theme') as 'dark' | 'light') || 'dark'
    } catch {
      return 'dark'
    }
  })
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    try {
      localStorage.setItem('smetka.theme', theme)
    } catch {
      /* ignore */
    }
  }, [theme])
  return [theme, setTheme] as const
}

export interface PeriodCtx {
  month: string
  setMonth: (m: string) => void
  months: string[]
  /** Day used for month-end projections: today in the current month, else the month length */
  dayOfMonth: number
  isCurrent: boolean
}

export default function App() {
  const { t, lang, setLang } = useI18n()
  const [route, nav] = useHashRoute()
  const [theme, setTheme] = useTheme()
  const txs = useLiveQuery(() => db.transactions.orderBy('date').reverse().toArray(), [], undefined as Transaction[] | undefined)

  const months = useMemo(() => {
    const set = new Set((txs ?? []).map((x) => monthKey(x.date)))
    return [...set].sort()
  }, [txs])
  const today = todayISO()
  const [month, setMonth] = useState<string | null>(null)
  const latest = months[months.length - 1] ?? monthKey(today)
  const activeMonth = month && months.includes(month) ? month : latest
  const isCurrent = activeMonth === monthKey(today)
  const period: PeriodCtx = {
    month: activeMonth,
    setMonth,
    months,
    isCurrent,
    dayOfMonth: isCurrent ? Number(today.slice(8, 10)) : daysInMonth(activeMonth),
  }

  const empty = txs !== undefined && txs.length === 0
  const showWelcome = empty && route !== 'import' && route !== 'rules'

  return (
    <div className="shell">
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span className="brand-mark">
            <svg viewBox="0 0 32 32" width="30" height="30" aria-hidden>
              <rect width="32" height="32" rx="9" fill="var(--accent)" />
              <path d="M9 21.5c1.6 1.4 3.9 2.1 6.6 2.1 3.7 0 6-1.7 6-4.2 0-5.6-11.6-3.2-11.6-8.3 0-2.2 2.1-3.7 5.3-3.7 2.3 0 4.2.6 5.6 1.8" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
            </svg>
          </span>
          <span className="brand-name">Smetka</span>
        </a>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.route} href={`#${n.route}`} className={'nav-item' + (route === n.route ? ' on' : '')} aria-current={route === n.route ? 'page' : undefined}>
              <Icon name={n.icon} size={19} />
              <span className="nav-long">{t(n.key)}</span>
              <span className="nav-short">{t(n.route === 'rules' ? 'nav.settingsShort' : n.key)}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="privacy">
            <Icon name="lock" size={15} />
            {t('privacy.badge')}
          </div>
          <div className="quick-toggles">
            <button className="chip-btn" onClick={() => setLang(lang === 'bg' ? 'en' : 'bg')} aria-label={t('set.language')}>
              {lang === 'bg' ? 'EN' : 'БГ'}
            </button>
            <button className="chip-btn" onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label={t('set.theme')}>
              {theme === 'dark' ? '☀︎' : '☾'}
            </button>
          </div>
        </div>
      </aside>

      <main className="main" key={route}>
        <Suspense fallback={null}>
        {txs === undefined ? null : showWelcome ? (
          <Welcome nav={nav} />
        ) : route === 'overview' ? (
          <Overview txs={txs} period={period} nav={nav} />
        ) : route === 'transactions' ? (
          <Transactions txs={txs} nav={nav} months={months} />
        ) : route === 'import' ? (
          <ImportPage nav={nav} />
        ) : route === 'budgets' ? (
          <Budgets txs={txs} period={period} />
        ) : (
          <Settings theme={theme} setTheme={setTheme} />
        )}
        </Suspense>
      </main>
    </div>
  )
}

export function MonthPicker({ period }: { period: PeriodCtx }) {
  const { locale } = useI18n()
  const { month, months, setMonth } = period
  const label = new Date(month + '-01T00:00:00').toLocaleDateString(locale, { month: 'long', year: 'numeric' })
  const prev = shiftMonth(month, -1)
  const next = shiftMonth(month, 1)
  return (
    <div className="month-picker">
      <button className="icon-btn" disabled={!months.includes(prev)} onClick={() => setMonth(prev)} aria-label="Previous month">
        <Icon name="chevL" />
      </button>
      <span className="month-label">{label}</span>
      <button className="icon-btn" disabled={!months.includes(next)} onClick={() => setMonth(next)} aria-label="Next month">
        <Icon name="chevR" />
      </button>
    </div>
  )
}
