import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CATEGORY_BY_ID } from './lib/categories'
import { applyMoneyOp, EMPTY_ENTRY, entryFromText, entryToText, formatMoney, parseAmount } from './lib/money'
import { useI18n } from './i18n'

/* ───────── Icons ───────── */

const paths: Record<string, ReactNode> = {
  overview: <path d="M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z" />,
  list: <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  upload: <path d="M12 16V4m0 0-5 5m5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r=".8" />
    </>
  ),
  sliders: <path d="M4 6h10m4 0h2M4 12h4m4 0h8M4 18h12m4 0h0M14 4v4M8 10v4M16 16v4" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  chevL: <path d="m15 6-6 6 6 6" />,
  chevR: <path d="m9 6 6 6-6 6" />,
  chevD: <path d="m6 9 6 6 6-6" />,
  check: <path d="m5 12 5 5 9-10" />,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </>
  ),
  sparkle: <path d="M12 3v4m0 10v4M3 12h4m10 0h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />,
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z" />
      <path d="M14 3v5h5" />
    </>
  ),
  download: <path d="M12 4v12m0 0 5-5m-5 5-5-5M4 20h16" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />,
  undo: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  plus: <path d="M12 5v14M5 12h14" />,
  arrowUp: <path d="M7 17 17 7M9 7h8v8" />,
  arrowDown: <path d="M7 7l10 10M17 9v8H9" />,
  warn: <path d="M12 4 2.5 20h19L12 4Zm0 6v4m0 3h.01" />,
}

export function Icon({ name, size = 18, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {paths[name]}
    </svg>
  )
}

/* ───────── Count-up number ───────── */

const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches

export function useCountUp(target: number, duration = 900) {
  const [value, setValue] = useState(reduceMotion() ? target : 0)
  const from = useRef(value)
  const still = reduceMotion()
  useEffect(() => {
    if (still) return
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration)
      const eased = 1 - Math.pow(1 - p, 4)
      const v = a + (target - a) * eased
      setValue(v)
      from.current = v
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, still])
  return still ? target : value
}

export function Money({ value, sign, compact, animate = true, className }: { value: number; sign?: boolean; compact?: boolean; animate?: boolean; className?: string }) {
  const { locale } = useI18n()
  const v = useCountUp(value)
  return <span className={'num ' + (className ?? '')}>{formatMoney(animate ? v : value, locale, { sign, compact })}</span>
}

/* ───────── Category pill ───────── */

export function CategoryDot({ id, size = 10 }: { id: string; size?: number }) {
  return <span className="cat-dot" style={{ width: size, height: size, background: CATEGORY_BY_ID[id]?.color ?? '#777' }} />
}

export function CategoryIcon({ id }: { id: string }) {
  const c = CATEGORY_BY_ID[id]
  return (
    <span className="cat-icon" style={{ background: `color-mix(in oklab, ${c?.color ?? '#777'} 18%, transparent)` }}>
      {c?.icon ?? '❔'}
    </span>
  )
}

/* ───────── Popover / Select ───────── */

function usePopover() {
  const [open, setOpen] = useState(false)
  const anchor = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean }>({ top: 0, left: 0, width: 0, up: false })

  useLayoutEffect(() => {
    if (!open || !anchor.current) return
    const place = () => {
      const r = anchor.current!.getBoundingClientRect()
      const h = panel.current?.offsetHeight ?? 280
      const up = r.bottom + h + 12 > innerHeight && r.top > h + 12
      const width = Math.max(r.width, 220)
      setPos({ top: up ? r.top - h - 6 : r.bottom + 6, left: Math.min(r.left, innerWidth - width - 12), width, up })
    }
    place()
    addEventListener('resize', place)
    addEventListener('scroll', place, true)
    return () => {
      removeEventListener('resize', place)
      removeEventListener('scroll', place, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!panel.current?.contains(e.target as Node) && !anchor.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && (setOpen(false), anchor.current?.focus())
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return { open, setOpen, anchor, panel, pos }
}

export interface Option<T extends string | number> {
  value: T
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
}

export function Select<T extends string | number>({
  value,
  options,
  onChange,
  className,
  placeholder,
  renderValue,
  ariaLabel,
}: {
  value: T
  options: Option<T>[]
  onChange: (v: T) => void
  className?: string
  placeholder?: string
  renderValue?: (o: Option<T> | undefined) => ReactNode
  ariaLabel?: string
}) {
  const { open, setOpen, anchor, panel, pos } = usePopover()
  const [active, setActive] = useState(0)
  const current = options.find((o) => o.value === value)

  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setOpen(true)
  }

  useEffect(() => {
    if (!open) return
    panel.current?.querySelector<HTMLElement>(`[data-i="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active, open, panel])

  const onKey = (e: React.KeyboardEvent) => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault()
      openList()
      return
    }
    if (!open) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(options.length - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      onChange(options[active].value)
      setOpen(false)
    } else if (e.key === 'Tab') setOpen(false)
  }

  return (
    <>
      <button ref={anchor} type="button" className={'select ' + (className ?? '')} aria-haspopup="listbox" aria-expanded={open} aria-label={ariaLabel} onClick={() => (open ? setOpen(false) : openList())} onKeyDown={onKey}>
        <span className="select-value">{renderValue ? renderValue(current) : current ? (<>{current.icon}{current.label}</>) : <span className="muted">{placeholder}</span>}</span>
        <Icon name="chevD" size={16} className={'select-chev' + (open ? ' up' : '')} />
      </button>
      {open &&
        createPortal(
          <div ref={panel} role="listbox" className={'popover' + (pos.up ? ' up' : '')} style={{ top: pos.top, left: pos.left, minWidth: pos.width }}>
            {options.map((o, i) => (
              <button
                key={String(o.value)}
                data-i={i}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={'popover-item' + (i === active ? ' active' : '') + (o.value === value ? ' selected' : '')}
                onMouseEnter={() => setActive(i)}
                onClick={() => {
                  onChange(o.value)
                  setOpen(false)
                }}
              >
                {o.icon}
                <span className="grow">{o.label}</span>
                {o.hint && <span className="muted small">{o.hint}</span>}
                {o.value === value && <Icon name="check" size={15} className="accent" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  )
}

/* ───────── Segmented control ───────── */

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  const idx = Math.max(0, options.findIndex((o) => o.value === value))
  return (
    <div className="segmented" role="tablist" style={{ ['--n' as string]: options.length, ['--i' as string]: idx }}>
      <span className="segmented-thumb" />
      {options.map((o) => (
        <button key={o.value} type="button" role="tab" aria-selected={o.value === value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ───────── Modal ───────── */

export function Modal({ open, onClose, title, children, actions }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  // Callers pass a new onClose on every render. Keep it in a ref so the effects below run only when
  // the dialog opens — otherwise every keystroke in a field re-ran them and moved focus to a button.
  const closeRef = useRef(onClose)
  useLayoutEffect(() => {
    closeRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])
  useEffect(() => {
    if (!open) return
    // Focus once, on open: a field if the dialog has one, else the main button.
    const el = ref.current
    ;(el?.querySelector<HTMLElement>('input, textarea, select') ?? el?.querySelector<HTMLElement>('button.primary, button'))?.focus()
  }, [open])
  if (!open) return null
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && closeRef.current()}>
      <div ref={ref} className="modal" role="dialog" aria-modal="true">
        <h3>{title}</h3>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}

/* ───────── Toasts ───────── */

interface Toast {
  id: number
  text: ReactNode
}
const ToastCtx = createContext<(text: ReactNode) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: ReactNode) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      {createPortal(
        <div className="toasts" aria-live="polite">
          {toasts.map((t) => (
            <div key={t.id} className="toast">
              <Icon name="check" size={16} className="accent" />
              {t.text}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastCtx.Provider>
  )
}

export const useToast = () => useContext(ToastCtx)

/* ───────── Progress bar ───────── */

export function Progress({ value, max, status, marker }: { value: number; max: number; status: 'ok' | 'warning' | 'over'; marker?: number }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  const [w, setW] = useState(0)
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct))
    return () => cancelAnimationFrame(id)
  }, [pct])
  return (
    <div className={'progress ' + status}>
      <div className="progress-fill" style={{ width: `${w}%` }} />
      {marker != null && marker > 0 && <div className="progress-marker" style={{ left: `${Math.min(100, (marker / max) * 100)}%` }} />}
    </div>
  )
}

/* ───────── Money input ───────── */

const separators = (locale: string) => (locale.startsWith('bg') ? { dec: ',' as const, group: ' ' } : { dec: '.' as const, group: ',' })

/**
 * Amount field that works like a card terminal: digits come in from the right, starting with the
 * cents ("129168" → 1 291,68). Edits come through `beforeinput`, which desktop and mobile keyboards
 * both fire, so the same rules apply everywhere. The caret always sits at the end.
 */
export function MoneyInput({ value, onChange, onFocus, ...rest }: { value: string; onChange: (v: string) => void } & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'>) {
  const { locale } = useI18n()
  const { dec, group } = separators(locale)
  const ref = useRef<HTMLInputElement>(null)
  const latest = useRef({ value, onChange, dec, group })
  useLayoutEffect(() => {
    latest.current = { value, onChange, dec, group }
  })

  const toEnd = () => {
    const el = ref.current
    if (!el || document.activeElement !== el || el.dataset.fresh) return
    const end = el.value.length
    if (el.selectionStart !== end || el.selectionEnd !== end) el.setSelectionRange(end, end)
  }
  useLayoutEffect(toEnd)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onBeforeInput = (ev: InputEvent) => {
      // Enter must still submit the form.
      if (ev.inputType === 'insertLineBreak' || ev.inputType === 'insertParagraph') return
      ev.preventDefault()
      const { value: v, onChange: change, dec: d, group: g } = latest.current
      // Everything selected (on focus, or select-all): the next key starts a new amount.
      const replacing = !!el.dataset.fresh || (v.length > 0 && el.selectionStart === 0 && el.selectionEnd === v.length)
      delete el.dataset.fresh
      let e = replacing ? EMPTY_ENTRY : entryFromText(v, d)
      const t = ev.inputType
      if (t === 'insertFromPaste' || t === 'insertFromDrop') {
        const n = parseAmount(ev.data ?? ev.dataTransfer?.getData('text/plain') ?? '')
        if (n != null) e = entryFromText(n.toFixed(2), '.')
      } else if (t.startsWith('insert') && ev.data) e = applyMoneyOp(e, { type: 'insert', text: ev.data })
      else if (t.startsWith('delete')) e = replacing ? EMPTY_ENTRY : applyMoneyOp(e, { type: 'delete' })
      const text = entryToText(e, d, g)
      change(text)
      if (text === v) toEnd()
    }
    el.addEventListener('beforeinput', onBeforeInput)
    return () => el.removeEventListener('beforeinput', onBeforeInput)
  }, [])

  return (
    <input
      {...rest}
      ref={ref}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      onChange={() => {}}
      onFocus={(e) => {
        // Select the prefilled amount so typing starts a new one, like most banking apps do.
        if (e.currentTarget.value) {
          e.currentTarget.dataset.fresh = '1'
          e.currentTarget.select()
        }
        onFocus?.(e)
      }}
      onClick={() => {
        if (ref.current) delete ref.current.dataset.fresh
        toEnd()
      }}
      onKeyUp={(e) => {
        if (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End') {
          if (ref.current) delete ref.current.dataset.fresh
          toEnd()
        }
        rest.onKeyUp?.(e)
      }}
    />
  )
}

/** Turns a number into what MoneyInput shows for it, e.g. 2750.4 → "2 750,40". */
export function toTyping(n: number, locale: string): string {
  const { dec, group } = separators(locale)
  return entryToText(entryFromText(n.toFixed(2), '.'), dec, group)
}

/** Reads what MoneyInput holds. */
export function fromTyping(s: string, locale: string): number | null {
  return parseAmount(s, separators(locale).dec)
}
