import { useLiveQuery } from 'dexie-react-hooks'
import { useRef, useState } from 'react'
import { clearAll, db, deleteImport, deleteRule, exportBackup, reapplyRules, restoreBackup } from '../db'
import { useI18n, type Lang } from '../i18n'
import { BUILTIN_RULES, CATEGORIES } from '../lib/categories'
import { hash } from '../lib/csv'
import { CategoryIcon, Icon, Modal, Segmented, Select, useToast } from '../ui'

export default function Settings({ theme, setTheme }: { theme: 'dark' | 'light'; setTheme: (t: 'dark' | 'light') => void }) {
  const { t, cat, lang, setLang, locale } = useI18n()
  const toast = useToast()
  const rules = useLiveQuery(() => db.rules.orderBy('id').toArray(), [], [])
  const imports = useLiveQuery(() => db.imports.orderBy('createdAt').reverse().toArray(), [], [])
  const [pattern, setPattern] = useState('')
  const [ruleCat, setRuleCat] = useState('dining')
  const [confirmClear, setConfirmClear] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const addRule = async () => {
    const p = pattern.trim().toUpperCase()
    if (p.length < 2) return
    await db.rules.put({ id: 'user_' + hash(p), pattern: p, categoryId: ruleCat, origin: 'user', createdAt: Date.now() })
    setPattern('')
    const n = await reapplyRules()
    toast(t('tx.learned', { n }))
  }

  const download = async () => {
    const url = URL.createObjectURL(new Blob([await exportBackup()], { type: 'application/json' }))
    Object.assign(document.createElement('a'), { href: url, download: `smetka-backup-${new Date().toISOString().slice(0, 10)}.json` }).click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('nav.settings')}</h1>
      </header>

      <div className="settings-grid">
        <section className="card rise">
          <h2>{t('set.rules')}</h2>
          <p className="muted small">{t('set.rulesText', { n: BUILTIN_RULES.length })}</p>
          <form
            className="rule-form"
            onSubmit={(e) => {
              e.preventDefault()
              addRule()
            }}
          >
            <input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={t('set.pattern')} />
            <Select value={ruleCat} onChange={setRuleCat} options={CATEGORIES.map((c) => ({ value: c.id, label: cat(c.id), icon: <CategoryIcon id={c.id} /> }))} />
            <button className="btn primary" disabled={pattern.trim().length < 2}>
              <Icon name="plus" size={16} /> {t('set.add')}
            </button>
          </form>
          {rules.length === 0 ? (
            <p className="muted small empty-rules">{t('set.noRules')}</p>
          ) : (
            <ul className="rules">
              {rules.map((r) => (
                <li key={r.id}>
                  <code>{r.pattern}</code>
                  <Icon name="chevR" size={14} className="muted" />
                  <span className="row gap-s grow">
                    <CategoryIcon id={r.categoryId} /> {cat(r.categoryId)}
                  </span>
                  <button className="icon-btn sm" onClick={() => deleteRule(r.id)} aria-label={t('common.delete')}>
                    <Icon name="trash" size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div className="stack">
          <section className="card rise" style={{ animationDelay: '60ms' }}>
            <h2>{t('set.appearance')}</h2>
            <div className="setting-row">
              <span>{t('set.language')}</span>
              <Segmented<Lang> value={lang} onChange={setLang} options={[{ value: 'bg', label: 'Български' }, { value: 'en', label: 'English' }]} />
            </div>
            <div className="setting-row">
              <span>{t('set.theme')}</span>
              <Segmented value={theme} onChange={setTheme} options={[{ value: 'dark', label: t('set.dark') }, { value: 'light', label: t('set.light') }]} />
            </div>
          </section>

          <section className="card rise" style={{ animationDelay: '120ms' }}>
            <h2>{t('set.imports')}</h2>
            {imports.length === 0 ? (
              <p className="muted small">—</p>
            ) : (
              <ul className="imports">
                {imports.map((i) => (
                  <li key={i.id}>
                    <Icon name="file" size={16} className="muted" />
                    <div className="grow min0">
                      <div className="ellipsis">{i.fileName}</div>
                      <div className="muted small">
                        {new Date(i.createdAt).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })} · +{i.added}
                        {i.duplicates ? ` · ${i.duplicates} ${t('imp.dupes')}` : ''}
                      </div>
                    </div>
                    <button
                      className="btn ghost sm"
                      onClick={async () => {
                        await deleteImport(i.id)
                        toast(t('set.undone'))
                      }}
                    >
                      <Icon name="undo" size={14} /> {t('set.undo')}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card rise" style={{ animationDelay: '180ms' }}>
            <h2>{t('set.data')}</h2>
            <div className="data-actions">
              <button className="btn ghost" onClick={download}>
                <Icon name="download" size={16} /> {t('set.export')}
              </button>
              <button className="btn ghost" onClick={() => file.current?.click()}>
                <Icon name="upload" size={16} /> {t('set.restore')}
              </button>
              <input
                ref={file}
                type="file"
                accept="application/json,.json"
                hidden
                onChange={async (e) => {
                  const f = e.target.files?.[0]
                  if (!f) return
                  try {
                    await restoreBackup(await f.text())
                    toast(t('set.restored'))
                  } catch {
                    toast('✕ JSON')
                  }
                  e.target.value = ''
                }}
              />
              <button className="btn danger" onClick={() => setConfirmClear(true)}>
                <Icon name="trash" size={16} /> {t('set.clear')}
              </button>
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={confirmClear}
        onClose={() => setConfirmClear(false)}
        title={t('set.clear')}
        actions={
          <>
            <button className="btn ghost" onClick={() => setConfirmClear(false)}>
              {t('common.cancel')}
            </button>
            <button
              className="btn danger solid"
              onClick={async () => {
                await clearAll()
                setConfirmClear(false)
                toast(t('set.cleared'))
              }}
            >
              {t('common.delete')}
            </button>
          </>
        }
      >
        <p>{t('set.clearConfirm')}</p>
      </Modal>
    </div>
  )
}
