import { useState } from 'react'
import type { Nav } from '../App'
import { loadDemo } from '../db'
import { useI18n } from '../i18n'
import { CATEGORIES } from '../lib/categories'
import { Icon } from '../ui'

export default function Welcome({ nav }: { nav: Nav }) {
  const { t } = useI18n()
  const [busy, setBusy] = useState(false)
  return (
    <div className="welcome">
      <div className="welcome-orbit" aria-hidden>
        {CATEGORIES.filter((c) => c.kind === 'expense').slice(0, 10).map((c, i) => (
          <span key={c.id} className="orbit-chip" style={{ ['--i' as string]: i, background: `color-mix(in oklab, ${c.color} 22%, var(--surface))` }}>
            {c.icon}
          </span>
        ))}
      </div>
      <div className="welcome-copy rise">
        <span className="eyebrow">
          <Icon name="lock" size={14} /> {t('privacy.badge')}
        </span>
        <h1>{t('empty.title')}</h1>
        <p className="lead">{t('empty.text')}</p>
        <div className="row gap">
          <button className="btn primary lg" onClick={() => nav.go('import')}>
            <Icon name="upload" /> {t('empty.import')}
          </button>
          <button
            className="btn ghost lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              await loadDemo()
              nav.go('overview')
            }}
          >
            <Icon name="sparkle" /> {t('empty.demo')}
          </button>
        </div>
        <ul className="features">
          {(['empty.f1', 'empty.f2', 'empty.f3'] as const).map((k, i) => (
            <li key={k} className="rise" style={{ animationDelay: `${200 + i * 90}ms` }}>
              <Icon name="check" size={16} className="accent" /> {t(k)}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
