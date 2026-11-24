import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import type { Nav } from '../App'
import { allRules, db, importRows, type ImportResult } from '../db'
import { useI18n } from '../i18n'
import { categorize } from '../lib/categorize'
import { guessMapping, headerSignature, mapRows, type ParsedTable } from '../lib/csv'
import { DATE_FORMATS } from '../lib/dates'
import { demoBankCsv } from '../lib/demo'
import { ImportError, loadTable, type LoadedTable } from '../lib/fileImport'
import { formatMoney, formatOriginal } from '../lib/money'
import type { AmountMode, ColumnMapping, CurrencyMode, DateFormat, DecimalSep } from '../lib/types'
import { CategoryIcon, Icon, Segmented, Select, useCountUp, type Option } from '../ui'

interface Loaded {
  fileName: string
  table: ParsedTable
  facts: LoadedTable['facts']
  signature: string
  known: boolean
}

export default function ImportPage({ nav }: { nav: Nav }) {
  const { t, cat, locale } = useI18n()
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const rules = useLiveQuery(allRules, [], [])

  const load = async (fileName: string, buf: ArrayBuffer) => {
    setError(null)
    setResult(null)
    setReading(true)
    let read: LoadedTable
    try {
      read = await loadTable(fileName, buf)
    } catch (e) {
      const code = e instanceof ImportError ? e.code : 'unreadable'
      setError(t(code === 'scanned-pdf' ? 'imp.errScanned' : code === 'no-table' ? 'imp.badFile' : 'imp.errUnreadable'))
      setReading(false)
      return
    }
    setReading(false)
    const { table, facts } = read
    // The same bank exports different layouts per format, so formats get separate saved mappings.
    const signature = (table.source === 'csv' ? '' : table.source + ':') + headerSignature(table.headers)
    const saved = await db.profiles.get(signature)
    const guess = saved && Math.max(saved.mapping.date, saved.mapping.description) < table.headers.length ? saved.mapping : guessMapping(table)
    if (!table.rows.length || guess.date < 0) {
      setError(t('imp.badFile'))
      return
    }
    setLoaded({ fileName, table, facts, signature, known: !!saved })
    setMapping(guess)
  }

  const onFile = async (f: File | undefined) => {
    if (!f) return
    await load(f.name, await f.arrayBuffer())
  }

  const loadSampleCsv = () => load('sample-statement.csv', new TextEncoder().encode(demoBankCsv()).buffer as ArrayBuffer)
  const loadSamplePdf = async () => {
    try {
      const res = await fetch('./sample-statement.pdf')
      if (!res.ok) throw new Error()
      await load('sample-statement.pdf', await res.arrayBuffer())
    } catch {
      setError(t('imp.errUnreadable'))
    }
  }

  const mapped = useMemo(() => (loaded && mapping ? mapRows(loaded.table, mapping) : null), [loaded, mapping])

  const reset = () => {
    setLoaded(null)
    setMapping(null)
    setResult(null)
    if (input.current) input.current.value = ''
  }

  const confirm = async () => {
    if (!loaded || !mapping || !mapped) return
    setBusy(true)
    await db.profiles.put({ signature: loaded.signature, mapping, updatedAt: Date.now() })
    const res = await importRows(mapped.rows, loaded.fileName, mapped.errors.length)
    setBusy(false)
    setResult(res)
    setLoaded(null)
  }

  if (result) return <Done result={result} nav={nav} onAgain={reset} />

  if (!loaded || !mapping || !mapped) {
    return (
      <div className="page narrow">
        <header className="page-head">
          <h1>{t('imp.title')}</h1>
        </header>
        <div
          className={'dropzone rise' + (drag ? ' drag' : '') + (reading ? ' reading' : '')}
          aria-busy={reading}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            onFile(e.dataTransfer.files[0])
          }}
          onClick={() => !reading && input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        >
          <div className="drop-icon">
            <Icon name="file" size={30} />
          </div>
          <strong className="drop-title">{reading ? t('imp.reading') : t('imp.drop')}</strong>
          {reading ? (
            <span className="loader" aria-hidden />
          ) : (
            <>
              <span className="muted">
                {t('imp.or')} <span className="accent underline">{t('imp.browse')}</span>
              </span>
              <span className="formats">
                {['CSV', 'Excel', 'PDF'].map((f) => (
                  <span key={f} className="format">
                    {f}
                  </span>
                ))}
              </span>
            </>
          )}
          <input
            ref={input}
            type="file"
            accept=".csv,.txt,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) => onFile(e.target.files?.[0])}
          />
        </div>
        {error && (
          <p className="error-note">
            <Icon name="warn" size={16} /> {error}
          </p>
        )}
        <p className="muted small center">{t('imp.hint')}</p>
        <div className="sample-row">
          <span className="muted small">{t('imp.sample')}</span>
          <button className="btn ghost sm" disabled={reading} onClick={loadSampleCsv}>
            <Icon name="file" size={15} /> CSV
          </button>
          <button className="btn ghost sm" disabled={reading} onClick={loadSamplePdf}>
            <Icon name="file" size={15} /> PDF
          </button>
        </div>
      </div>
    )
  }

  const { table } = loaded
  const cols: Option<number>[] = [{ value: -1, label: t('imp.none') }, ...table.headers.map((h, i) => ({ value: i, label: h, hint: table.rows[0]?.[i]?.slice(0, 18) }))]
  const set = <K extends keyof ColumnMapping>(k: K, v: ColumnMapping[K]) => setMapping({ ...mapping, [k]: v })
  const preview = mapped.rows.slice(0, 8)

  return (
    <div className="page">
      <header className="page-head">
        <h1>{t('imp.title')}</h1>
        <button className="btn ghost" onClick={reset}>
          <Icon name="chevL" size={16} /> {t('imp.cancel')}
        </button>
      </header>

      <div className="detected rise">
        <span className="file-chip">
          <Icon name="file" size={16} /> {loaded.fileName}
        </span>
        <span className="chip">
          {t('imp.format')}: <b>{table.source === 'xlsx' ? 'Excel' : table.source.toUpperCase()}</b>
        </span>
        {loaded.facts.map((f) => (
          <span key={f.label} className="chip">
            {t(`imp.${f.label}`)}: <b>{f.value}</b>
          </span>
        ))}
        <span className="chip">
          {t('imp.rows')}: <b>{table.rows.length}</b>
        </span>
        {loaded.known && (
          <span className="chip ok">
            <Icon name="check" size={14} /> {t('imp.known')}
          </span>
        )}
      </div>

      {table.source === 'pdf' && (
        <p className="pdf-note rise">
          <Icon name="sparkle" size={15} className="accent" /> {t('imp.pdfNote')}
        </p>
      )}

      <div className="import-grid">
        <div className="card rise" style={{ animationDelay: '60ms' }}>
          <h2>{t('imp.mapping')}</h2>
          <div className="form">
            <Field label={t('imp.colDate')}>
              <Select value={mapping.date} options={cols} onChange={(v) => set('date', v)} />
            </Field>
            <Field label={t('imp.colDesc')}>
              <Select value={mapping.description} options={cols} onChange={(v) => set('description', v)} />
            </Field>
            <Field label={t('imp.colExtra')}>
              <Select value={mapping.descriptionExtra[0] ?? -1} options={cols} onChange={(v) => set('descriptionExtra', v >= 0 ? [v] : [])} />
            </Field>
            <Field label={t('imp.amountMode')} full>
              <Segmented<AmountMode>
                value={mapping.amountMode}
                onChange={(v) => set('amountMode', v)}
                options={[
                  { value: 'signed', label: t('imp.modeSigned') },
                  { value: 'split', label: t('imp.modeSplit') },
                  { value: 'direction', label: t('imp.modeDir') },
                ]}
              />
            </Field>
            {mapping.amountMode === 'split' ? (
              <>
                <Field label={t('imp.colDebit')}>
                  <Select value={mapping.debit} options={cols} onChange={(v) => set('debit', v)} />
                </Field>
                <Field label={t('imp.colCredit')}>
                  <Select value={mapping.credit} options={cols} onChange={(v) => set('credit', v)} />
                </Field>
              </>
            ) : (
              <>
                <Field label={t('imp.colAmount')}>
                  <Select value={mapping.amount} options={cols} onChange={(v) => set('amount', v)} />
                </Field>
                {mapping.amountMode === 'direction' && (
                  <Field label={t('imp.colDir')}>
                    <Select value={mapping.direction} options={cols} onChange={(v) => set('direction', v)} />
                  </Field>
                )}
              </>
            )}
            <Field label={t('imp.dateFormat')}>
              <Select<DateFormat> value={mapping.dateFormat} options={DATE_FORMATS.map((f) => ({ value: f, label: f }))} onChange={(v) => set('dateFormat', v)} />
            </Field>
            <Field label={t('imp.decimal')}>
              <Segmented<DecimalSep>
                value={mapping.decimal}
                onChange={(v) => set('decimal', v)}
                options={[
                  { value: ',', label: '1 234,56' },
                  { value: '.', label: '1,234.56' },
                ]}
              />
            </Field>
            <Field label={t('imp.currencyMode')}>
              <Select<CurrencyMode>
                value={mapping.currencyMode}
                onChange={(v) => set('currencyMode', v)}
                options={[
                  { value: 'auto-euro-switch', label: t('imp.curAuto') },
                  { value: 'EUR', label: t('imp.curEUR') },
                  { value: 'BGN', label: t('imp.curBGN') },
                  { value: 'column', label: t('imp.curColumn') },
                ]}
              />
            </Field>
            {mapping.currencyMode === 'column' && (
              <Field label={t('imp.colCurrency')}>
                <Select value={mapping.currency} options={cols} onChange={(v) => set('currency', v)} />
              </Field>
            )}
            <label className="check">
              <input type="checkbox" checked={mapping.invertSign} onChange={(e) => set('invertSign', e.target.checked)} />
              <span className="box">
                <Icon name="check" size={13} />
              </span>
              {t('imp.invert')}
            </label>
            {mapping.invertSign && mapping.amountMode === 'signed' && <p className="muted small invert-hint">{t('imp.invertHint')}</p>}
          </div>
          <p className="muted small note">{t('imp.eurNote')}</p>
        </div>

        <div className="card rise" style={{ animationDelay: '120ms' }}>
          <h2>{t('imp.preview')}</h2>
          <div className="preview">
            {preview.map((r) => {
              const c = categorize(r.description, r.amount, rules)
              return (
                <div key={r.line} className="preview-row">
                  <span className="muted small num">{r.date.split('-').reverse().join('.')}</span>
                  <span className="ellipsis grow small" title={r.description}>
                    {r.description}
                  </span>
                  <span className="row gap-s small nowrap">
                    <CategoryIcon id={c.categoryId} />
                    <span className="hide-sm">{cat(c.categoryId)}</span>
                  </span>
                  <span className={'num strong small right nowrap ' + (r.amount > 0 ? 'good' : '')}>
                    {formatMoney(r.amount, locale, { sign: r.amount > 0 })}
                    {r.originalCurrency !== 'EUR' && <span className="muted block">{formatOriginal(r.originalAmount, r.originalCurrency, locale)}</span>}
                  </span>
                </div>
              )
            })}
          </div>
          {mapped.errors.length > 0 && (
            <details className="errors">
              <summary>
                <Icon name="warn" size={15} /> {t('imp.errors', { n: mapped.errors.length })}
              </summary>
              <ul>
                {mapped.errors.slice(0, 6).map((e) => (
                  <li key={e.line} className="small">
                    <span className="muted">
                      {t('imp.line')} {e.line}:
                    </span>{' '}
                    {t(e.reason === 'date' ? 'imp.errDate' : 'imp.errAmount')} — <code>{e.raw.join(' ; ').slice(0, 80)}</code>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <button className="btn primary lg block" disabled={busy || mapped.rows.length === 0} onClick={confirm}>
            <Icon name="upload" /> {t('imp.confirm', { n: mapped.rows.length })}
          </button>
        </div>
      </div>
    </div>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={'field' + (full ? ' full' : '')}>
      <span className="field-label">{label}</span>
      {children}
    </div>
  )
}

function Done({ result, nav, onAgain }: { result: ImportResult; nav: Nav; onAgain: () => void }) {
  const { t } = useI18n()
  const added = useCountUp(result.added)
  const dupes = useCountUp(result.duplicates)
  const auto = useCountUp(result.added ? (result.categorized / result.added) * 100 : 0)
  return (
    <div className="page narrow">
      <div className="card done rise">
        <div className="done-check">
          <Icon name="check" size={34} />
        </div>
        <h1>{t('imp.doneTitle')}</h1>
        <div className="done-stats">
          <div>
            <span className="num big">{Math.round(added)}</span>
            <span className="muted">{t('imp.added')}</span>
          </div>
          <div>
            <span className="num big">{Math.round(dupes)}</span>
            <span className="muted">{t('imp.dupes')}</span>
          </div>
          <div>
            <span className="num big">{result.added ? `${Math.round(auto)}%` : '—'}</span>
            <span className="muted">{t('imp.auto')}</span>
          </div>
        </div>
        {result.added === 0 && result.duplicates > 0 && <p className="muted">{t('imp.allDupes')}</p>}
        <div className="row gap center">
          <button className="btn ghost" onClick={onAgain}>
            {t('imp.again')}
          </button>
          <button className="btn primary" onClick={() => nav.go('transactions')}>
            {t('imp.view')} <Icon name="chevR" size={16} />
          </button>
        </div>
      </div>
    </div>
  )
}
