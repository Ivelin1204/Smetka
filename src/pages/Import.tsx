import { useLiveQuery } from 'dexie-react-hooks'
import { useMemo, useRef, useState } from 'react'
import type { Nav } from '../App'
import { allRules, db, importRows } from '../db'
import { useI18n } from '../i18n'
import { categorize } from '../lib/categorize'
import { columnKinds, guessMapping, headerSignature, mapRows, statementBalances, type ColumnKind, type ParsedTable } from '../lib/csv'
import { DATE_FORMATS } from '../lib/dates'
import { demoBankCsv } from '../lib/demo'
import { ImportError, loadTable, type ImportErrorCode, type LoadedTable } from '../lib/fileImport'
import { formatMoney, formatOriginal } from '../lib/money'
import type { AmountMode, ColumnMapping, CurrencyMode, DateFormat, DecimalSep } from '../lib/types'
import { CategoryIcon, Icon, Segmented, Select, useCountUp, type Option } from '../ui'

interface LoadedFile {
  name: string
  table: ParsedTable
  facts: LoadedTable['facts']
}

/** Files that share a layout (same bank, same format) get one column mapping. */
interface Group {
  signature: string
  files: LoadedFile[]
  /** All files' rows together — for guessing columns and the preview */
  table: ParsedTable
  guess: ColumnMapping
  saved: ColumnMapping | null
}

interface Failure {
  name: string
  code: ImportErrorCode
}

interface Totals {
  files: number
  added: number
  duplicates: number
  categorized: number
  /** Latest balance any statement stated */
  balance: { date: string; amount: number } | null
}

const EMPTY: Totals = { files: 0, added: 0, duplicates: 0, categorized: 0, balance: null }

export default function ImportPage({ nav }: { nav: Nav }) {
  const { t, cat, locale } = useI18n()
  const [groups, setGroups] = useState<Group[]>([])
  const [gi, setGi] = useState(0)
  const [mapping, setMapping] = useState<ColumnMapping | null>(null)
  const [known, setKnown] = useState(false)
  const [failures, setFailures] = useState<Failure[]>([])
  const [totals, setTotals] = useState<Totals | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const rules = useLiveQuery(allRules, [], [])

  const failText = (code: ImportErrorCode) => t(code === 'scanned-pdf' ? 'imp.errScanned' : code === 'no-table' ? 'imp.badFile' : 'imp.errUnreadable')

  const startGroup = (g: Group) => {
    setMapping(g.saved ?? g.guess)
    setKnown(!!g.saved)
  }

  const loadFiles = async (files: { name: string; read: () => Promise<ArrayBuffer> }[]) => {
    if (!files.length) return
    setError(null)
    setTotals(null)
    const failed: Failure[] = []
    const bySig = new Map<string, LoadedFile[]>()
    for (let i = 0; i < files.length; i++) {
      setReading({ done: i, total: files.length })
      const f = files[i]
      try {
        const { table, facts } = await loadTable(f.name, await f.read())
        if (!table.rows.length) throw new ImportError('no-table')
        // The same bank exports different layouts per format, so formats get separate mappings.
        const sig = (table.source === 'csv' ? '' : table.source + ':') + headerSignature(table.headers)
        bySig.set(sig, [...(bySig.get(sig) ?? []), { name: f.name, table, facts }])
      } catch (e) {
        failed.push({ name: f.name, code: e instanceof ImportError ? e.code : 'unreadable' })
      }
    }
    const built: Group[] = []
    for (const [signature, list] of bySig) {
      const table: ParsedTable = { ...list[0].table, rows: list.flatMap((f) => f.table.rows) }
      const guess = guessMapping(table)
      if (guess.date < 0) {
        list.forEach((f) => failed.push({ name: f.name, code: 'no-table' }))
        continue
      }
      const saved = await db.profiles.get(signature)
      const usable = saved?.edited && Math.max(saved.mapping.date, saved.mapping.description) < table.headers.length
      built.push({ signature, files: list, table, guess, saved: usable ? saved!.mapping : null })
    }
    setReading(null)
    setFailures(failed)
    if (!built.length) {
      setError(failed.length === 1 ? failText(failed[0].code) : t('imp.noneRead'))
      return
    }
    setGroups(built)
    setGi(0)
    startGroup(built[0])
  }

  const fromFileList = (list: FileList | null | undefined) =>
    loadFiles([...(list ?? [])].map((f) => ({ name: f.name, read: () => f.arrayBuffer() })))

  const loadSampleCsv = () => loadFiles([{ name: 'sample-statement.csv', read: async () => new TextEncoder().encode(demoBankCsv()).buffer as ArrayBuffer }])
  const loadSamplePdf = () =>
    loadFiles([
      {
        name: 'sample-statement.pdf',
        read: async () => {
          const res = await fetch('./sample-statement.pdf')
          if (!res.ok) throw new ImportError('unreadable')
          return res.arrayBuffer()
        },
      },
    ])

  const group = groups[gi] as Group | undefined
  const mapped = useMemo(() => (group && mapping ? mapRows(group.table, mapping) : null), [group, mapping])

  const reset = () => {
    setGroups([])
    setMapping(null)
    setTotals(null)
    setFailures([])
    if (input.current) input.current.value = ''
  }

  const confirm = async () => {
    if (!group || !mapping) return
    setBusy(true)
    const edited = JSON.stringify(mapping) !== JSON.stringify(group.guess)
    if (edited) await db.profiles.put({ signature: group.signature, mapping, edited, updatedAt: Date.now() })
    else await db.profiles.delete(group.signature)
    // File by file: each gets its own fingerprints (so overlapping statements dedupe) and its own undo.
    const sum = { ...(totals ?? EMPTY) }
    for (const f of group.files) {
      const { rows, errors } = mapRows(f.table, mapping)
      const balances = statementBalances(rows, f.table.closingBalance, mapping.decimal)
      const res = await importRows(rows, f.name, errors.length, balances)
      sum.files++
      sum.added += res.added
      sum.duplicates += res.duplicates
      sum.categorized += res.categorized
      const last = balances[balances.length - 1]
      if (last && (!sum.balance || last.date >= sum.balance.date)) sum.balance = last
    }
    setBusy(false)
    if (gi + 1 < groups.length) {
      setTotals(sum)
      setGi(gi + 1)
      startGroup(groups[gi + 1])
    } else {
      setGroups([])
      setTotals(sum)
    }
  }

  if (totals && !groups.length) return <Done totals={totals} failures={failures} failText={failText} nav={nav} onAgain={reset} />

  if (!group || !mapping || !mapped) {
    return (
      <div className="page narrow">
        <header className="page-head">
          <h1>{t('imp.title')}</h1>
        </header>
        <div
          className={'dropzone rise' + (drag ? ' drag' : '') + (reading ? ' reading' : '')}
          aria-busy={!!reading}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            fromFileList(e.dataTransfer.files)
          }}
          onClick={() => !reading && input.current?.click()}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        >
          <div className="drop-icon">
            <Icon name="file" size={30} />
          </div>
          <strong className="drop-title">{reading ? (reading.total > 1 ? t('imp.readingN', { done: reading.done + 1, total: reading.total }) : t('imp.reading')) : t('imp.drop')}</strong>
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
              <span className="muted small">{t('imp.many')}</span>
            </>
          )}
          <input
            ref={input}
            type="file"
            multiple
            accept=".csv,.txt,.xlsx,.pdf,text/csv,application/pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) => fromFileList(e.target.files)}
          />
        </div>
        {error && (
          <div className="error-note">
            <Icon name="warn" size={16} />
            <div>
              {error}
              {failures.length > 1 && (
                <ul className="fail-list">
                  {failures.map((f) => (
                    <li key={f.name}>
                      <b>{f.name}</b> — {failText(f.code)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
        <p className="muted small center">{t('imp.hint')}</p>
        <div className="sample-row">
          <span className="muted small">{t('imp.sample')}</span>
          <button className="btn ghost sm" disabled={!!reading} onClick={loadSampleCsv}>
            <Icon name="file" size={15} /> CSV
          </button>
          <button className="btn ghost sm" disabled={!!reading} onClick={loadSamplePdf}>
            <Icon name="file" size={15} /> PDF
          </button>
        </div>
      </div>
    )
  }

  const { table } = group
  // Each column has at most one role. A field offers only columns whose content fits it and that no
  // other field is using — so the same date can't end up in two places.
  type Role = 'date' | 'description' | 'extra' | 'amount' | 'debit' | 'credit' | 'direction' | 'currency' | 'balance'
  const roles: Record<Role, number> = {
    date: mapping.date,
    description: mapping.description,
    extra: mapping.descriptionExtra[0] ?? -1,
    amount: mapping.amountMode === 'split' ? -1 : mapping.amount,
    debit: mapping.amountMode === 'split' ? mapping.debit : -1,
    credit: mapping.amountMode === 'split' ? mapping.credit : -1,
    direction: mapping.amountMode === 'direction' ? mapping.direction : -1,
    currency: mapping.currencyMode === 'column' ? mapping.currency : -1,
    balance: mapping.balance ?? -1,
  }
  const kinds = columnKinds(table)
  const cols = (role: Role, fits: (k: ColumnKind) => boolean, optional = false): Option<number>[] => {
    const current = roles[role]
    const taken = new Set((Object.keys(roles) as Role[]).filter((r) => r !== role).map((r) => roles[r]))
    const list = table.headers.map((_, i) => i).filter((i) => i === current || (fits(kinds[i]) && !taken.has(i)))
    const dup = (i: number) => list.filter((j) => table.headers[j] === table.headers[i]).length > 1
    return [
      ...(optional || current < 0 ? [{ value: -1, label: t('imp.none') }] : []),
      ...list.map((i) => ({
        value: i,
        // Same header twice ("Дата", "Дата"): tell them apart by column number.
        label: dup(i) ? `${table.headers[i]} (${t('imp.col')} ${i + 1})` : table.headers[i],
        hint: kinds[i].sample.slice(0, 22),
      })),
    ]
  }
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
        {groups.length > 1 && <span className="chip strong-chip">{t('imp.groupOf', { n: gi + 1, total: groups.length })}</span>}
        <span className="file-chip" title={group.files.map((f) => f.name).join('\n')}>
          <Icon name="file" size={16} /> {group.files.length > 1 ? t('imp.nFiles', { n: group.files.length }) : group.files[0].name}
        </span>
        <span className="chip">
          {t('imp.format')}: <b>{table.source === 'xlsx' ? 'Excel' : table.source.toUpperCase()}</b>
        </span>
        {group.files.length === 1 && group.files[0].facts.map((f) => (
          <span key={f.label} className="chip">
            {t(`imp.${f.label}`)}: <b>{f.value}</b>
          </span>
        ))}
        <span className="chip">
          {t('imp.rows')}: <b>{table.rows.length}</b>
        </span>
        {known && (
          <span className="chip ok">
            <Icon name="check" size={14} /> {t('imp.known')}
            <button className="chip-reset" onClick={() => (setMapping(group.guess), setKnown(false))}>
              {t('imp.reset')}
            </button>
          </span>
        )}
      </div>

      {group.files.length > 1 && (
        <details className="file-list rise">
          <summary className="muted small">{t('imp.showFiles')}</summary>
          <ul>
            {group.files.map((f) => (
              <li key={f.name} className="small">
                <Icon name="file" size={14} className="muted" /> {f.name} <span className="muted">· {f.table.rows.length}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

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
              <Select value={mapping.date} options={cols('date', (k) => k.date)} onChange={(v) => set('date', v)} />
            </Field>
            <Field label={t('imp.colDesc')}>
              <Select value={mapping.description} options={cols('description', (k) => k.text)} onChange={(v) => set('description', v)} />
            </Field>
            <Field label={t('imp.colExtra')}>
              <Select
                value={mapping.descriptionExtra[0] ?? -1}
                options={cols('extra', (k) => k.text, true)}
                onChange={(v) => set('descriptionExtra', v >= 0 ? [v] : [])}
              />
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
                  <Select value={mapping.debit} options={cols('debit', (k) => k.amount)} onChange={(v) => set('debit', v)} />
                </Field>
                <Field label={t('imp.colCredit')}>
                  <Select value={mapping.credit} options={cols('credit', (k) => k.amount)} onChange={(v) => set('credit', v)} />
                </Field>
              </>
            ) : (
              <>
                <Field label={t('imp.colAmount')}>
                  <Select value={mapping.amount} options={cols('amount', (k) => k.amount)} onChange={(v) => set('amount', v)} />
                </Field>
                {mapping.amountMode === 'direction' && (
                  <Field label={t('imp.colDir')}>
                    <Select value={mapping.direction} options={cols('direction', (k) => k.direction)} onChange={(v) => set('direction', v)} />
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
                <Select value={mapping.currency} options={cols('currency', (k) => k.currency)} onChange={(v) => set('currency', v)} />
              </Field>
            )}
            <Field label={t('imp.colBalance')}>
              <Select value={mapping.balance ?? -1} options={cols('balance', (k) => k.amount, true)} onChange={(v) => set('balance', v)} />
            </Field>
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
            <Icon name="upload" /> {group.files.length > 1 ? t('imp.confirmFiles', { n: mapped.rows.length, files: group.files.length }) : t('imp.confirm', { n: mapped.rows.length })}
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

function Done({ totals, failures, failText, nav, onAgain }: { totals: Totals; failures: Failure[]; failText: (c: ImportErrorCode) => string; nav: Nav; onAgain: () => void }) {
  const { t, locale } = useI18n()
  const added = useCountUp(totals.added)
  const dupes = useCountUp(totals.duplicates)
  const auto = useCountUp(totals.added ? (totals.categorized / totals.added) * 100 : 0)
  return (
    <div className="page narrow">
      <div className="card done rise">
        <div className="done-check">
          <Icon name="check" size={34} />
        </div>
        <h1>{t('imp.doneTitle')}</h1>
        {totals.files > 1 && <p className="muted">{t('imp.doneFiles', { n: totals.files })}</p>}
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
            <span className="num big">{totals.added ? `${Math.round(auto)}%` : '—'}</span>
            <span className="muted">{t('imp.auto')}</span>
          </div>
        </div>
        {totals.added === 0 && totals.duplicates > 0 && <p className="muted">{t('imp.allDupes')}</p>}
        {totals.balance && (
          <p className="balance-found">
            <Icon name="check" size={15} className="good" />
            {t('imp.balanceFound', {
              amount: formatMoney(totals.balance.amount, locale),
              date: new Date(totals.balance.date + 'T00:00:00').toLocaleDateString(locale, { day: 'numeric', month: 'long', year: 'numeric' }),
            })}
          </p>
        )}
        {failures.length > 0 && (
          <div className="error-note left">
            <Icon name="warn" size={16} />
            <div>
              {t('imp.skipped', { n: failures.length })}
              <ul className="fail-list">
                {failures.map((f) => (
                  <li key={f.name}>
                    <b>{f.name}</b> — {failText(f.code)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
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
