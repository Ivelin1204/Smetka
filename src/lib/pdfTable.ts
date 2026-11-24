import { looksLikeDate } from './dates'
import { looksLikeAmount } from './money'

/** A positioned run of text, as pdf.js reports it. y grows upwards (PDF coordinates). */
export interface PdfTextItem {
  str: string
  x: number
  y: number
  w: number
  h: number
  page: number
}

interface Cell {
  text: string
  x0: number
  x1: number
}

interface Line {
  page: number
  y: number
  h: number
  cells: Cell[]
}

type Kind = 'date' | 'amount' | 'text'

const DATE_PREFIX = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{1,2}-\d{1,2})\s+(.+)$/

function kindOf(text: string): Kind {
  const t = text.trim()
  if (t.length <= 20 && looksLikeDate(t)) return 'date'
  if (looksLikeAmount(t)) return 'amount'
  return 'text'
}

/** Items on the same baseline → one line; runs separated by a wide gap → separate cells. */
export function groupLines(items: PdfTextItem[]): Line[] {
  const sorted = items
    .filter((i) => i.str.trim())
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x)
  const lines: { page: number; y: number; h: number; items: PdfTextItem[] }[] = []
  for (const it of sorted) {
    const last = lines[lines.length - 1]
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= Math.max(2, 0.45 * Math.max(it.h, last.h))) last.items.push(it)
    else lines.push({ page: it.page, y: it.y, h: it.h, items: [it] })
  }
  return lines.map((l) => {
    const runs = l.items.sort((a, b) => a.x - b.x)
    const cells: Cell[] = []
    for (const r of runs) {
      const c = cells[cells.length - 1]
      const gap = c ? r.x - c.x1 : Infinity
      // Word spacing is ~0.25em; column gutters are well over half an em.
      if (c && gap < 0.6 * r.h) {
        c.text += (gap > 0.12 * r.h ? ' ' : '') + r.str
        c.x1 = Math.max(c.x1, r.x + r.w)
      } else cells.push({ text: r.str, x0: r.x, x1: r.x + r.w })
    }
    for (const c of cells) c.text = c.text.replace(/\s+/g, ' ').trim()
    // "03.10.2026 POS ПЛАЩАНЕ…" glued into one run: split the date off.
    const first = cells[0]
    const m = first?.text.match(DATE_PREFIX)
    if (first && m) {
      const ratio = m[1].length / first.text.length
      const cut = first.x0 + (first.x1 - first.x0) * ratio
      cells.splice(0, 1, { text: m[1], x0: first.x0, x1: cut }, { text: m[2], x0: cut + 1, x1: first.x1 })
    }
    return { page: l.page, y: l.y, h: Math.max(...l.items.map((i) => i.h)), cells }
  })
}

interface Column {
  side: 'left' | 'right'
  anchor: number
  /** Left edge used for ordering columns */
  pos: number
  count: number
}

function cluster(values: number[], tol: number): { center: number; count: number }[] {
  const s = [...values].sort((a, b) => a - b)
  const out: { sum: number; count: number; last: number }[] = []
  for (const v of s) {
    const c = out[out.length - 1]
    if (c && v - c.last <= tol) {
      c.sum += v
      c.count++
      c.last = v
    } else out.push({ sum: v, count: 1, last: v })
  }
  return out.map((c) => ({ center: c.sum / c.count, count: c.count }))
}

function median(xs: number[]) {
  const s = [...xs].sort((a, b) => a - b)
  return s.length ? s[s.length >> 1] : 0
}

export interface PdfTable {
  headers: string[]
  rows: string[][]
  hasHeader: boolean
  pages: number
  textItems: number
}

/**
 * Rebuilds the transaction table from a PDF statement's positioned text:
 * 1. a transaction row is a line that starts with a date (at the usual date position) and holds an amount;
 * 2. lines right below it with no date and no amount are wrapped description text;
 * 3. columns come from where cells line up across rows — text and dates align on the left edge,
 *    numbers on the right edge;
 * 4. the nearest suitable line above the first row is the header.
 */
export function pdfItemsToTable(items: PdfTextItem[]): PdfTable {
  const pages = items.reduce((m, i) => Math.max(m, i.page), 0)
  const lines = groupLines(items)
  const h = median(lines.map((l) => l.h)) || 10
  const tol = Math.max(3, h * 0.5)

  // Where do row dates usually sit? Ignores dates in headers ("Период: 01.10–31.12").
  const firstDate = (l: Line) => l.cells.slice(0, 2).find((c) => kindOf(c.text) === 'date')
  const candidates = lines.filter((l) => firstDate(l) && l.cells.some((c) => c !== firstDate(l) && kindOf(c.text) === 'amount'))
  const dateAnchor = cluster(candidates.map((l) => firstDate(l)!.x0), tol).sort((a, b) => b.count - a.count)[0]?.center
  const isRow = (l: Line) => {
    const d = firstDate(l)
    return !!d && dateAnchor !== undefined && Math.abs(d.x0 - dateAnchor) <= tol * 2 && l.cells.some((c) => c !== d && kindOf(c.text) === 'amount')
  }

  // Rows plus their wrapped continuation lines.
  const rows: Line[] = []
  let prev: Line | null = null
  for (const l of lines) {
    if (isRow(l)) {
      rows.push((prev = { ...l, cells: l.cells.map((c) => ({ ...c })) }))
      continue
    }
    const continues =
      prev &&
      l.page === prev.page &&
      prev.y - l.y <= h * 1.9 &&
      !l.cells.some((c) => kindOf(c.text) !== 'text') &&
      l.cells[0].x0 > (prev.cells[0]?.x1 ?? 0) - 1
    if (continues && prev) {
      for (const c of l.cells) {
        const target = prev.cells.find((p) => kindOf(p.text) === 'text' && c.x0 < p.x1 + tol && c.x1 > p.x0 - tol) ?? [...prev.cells].filter((p) => kindOf(p.text) === 'text').sort((a, b) => b.text.length - a.text.length)[0]
        if (target) {
          target.text += ' ' + c.text
          target.x1 = Math.max(target.x1, c.x1)
        }
      }
      prev = { ...prev, y: l.y } // allow several wrapped lines
      rows[rows.length - 1] = prev
    } else prev = null
  }

  if (!rows.length) return { headers: [], rows: [], hasHeader: false, pages, textItems: items.length }

  // Column anchors: left edges for text/dates, right edges for amounts.
  const minSupport = rows.length < 4 ? 1 : Math.max(2, Math.round(rows.length * 0.04))
  const leftVals: number[] = []
  const rightVals: number[] = []
  const rightWidths: number[] = []
  for (const r of rows)
    for (const c of r.cells) {
      if (kindOf(c.text) === 'amount') {
        rightVals.push(c.x1)
        rightWidths.push(c.x1 - c.x0)
      } else leftVals.push(c.x0)
    }
  const numW = median(rightWidths) || h * 4
  const columns: Column[] = [
    ...cluster(leftVals, tol).filter((c) => c.count >= minSupport).map((c) => ({ side: 'left' as const, anchor: c.center, pos: c.center, count: c.count })),
    ...cluster(rightVals, tol).filter((c) => c.count >= minSupport).map((c) => ({ side: 'right' as const, anchor: c.center, pos: c.center - numW, count: c.count })),
  ].sort((a, b) => a.pos - b.pos)

  const columnFor = (c: Cell, kind: Kind): number => {
    const side = kind === 'amount' ? 'right' : 'left'
    const key = side === 'right' ? c.x1 : c.x0
    let best = -1
    let bestD = Infinity
    columns.forEach((col, i) => {
      if (col.side !== side) return
      const d = Math.abs(col.anchor - key)
      if (d < bestD) (best = i), (bestD = d)
    })
    if (best >= 0 && bestD <= tol * 2) return best
    // Off-grid cell (e.g. a number inside the description): the column it starts in.
    let idx = 0
    columns.forEach((col, i) => {
      if (col.pos <= c.x0 + tol) idx = i
    })
    return idx
  }

  const toRow = (l: Line) => {
    const out = new Array<string>(columns.length).fill('')
    for (const c of l.cells) {
      const i = columnFor(c, kindOf(c.text))
      out[i] = out[i] ? `${out[i]} ${c.text}` : c.text
    }
    return out
  }

  // Header: closest line above the first row that has no amounts and several cells.
  const first = rows[0]
  const firstIdx = lines.findIndex((l) => l.page === first.page && l.y === first.y)
  const headerLines: Line[] = []
  // A lone word right above the table ("час" under "Дата и") may be the second line of a header.
  let tail: Line | null = null
  for (let i = firstIdx - 1; i >= Math.max(0, firstIdx - 6); i--) {
    const l = lines[i]
    if (l.page !== first.page) break
    const plain = !l.cells.some((c) => kindOf(c.text) !== 'text')
    if (plain && l.cells.length >= 2) {
      // A two-line header ("Дата на" / "операция") is allowed; anything further up is preamble.
      if (headerLines.length && l.y - headerLines[0].y > h * 1.3) break
      headerLines.unshift(l)
      if (tail && l.y - tail.y <= h * 1.3) headerLines.push(tail)
      tail = null
      if (headerLines.length >= 2) break
    } else if (plain && !headerLines.length && !tail && i === firstIdx - 1) tail = l
    else if (headerLines.length) break
  }
  let headers: string[] = columns.map((_, i) => `#${i + 1}`)
  let hasHeader = false
  if (headerLines.length) {
    const hdr = new Array<string>(columns.length).fill('')
    for (const l of headerLines)
      for (const c of l.cells) {
        // Header labels are positioned loosely: pick the column whose span covers the label's centre.
        const mid = (c.x0 + c.x1) / 2
        let i = 0
        let bestD = Infinity
        columns.forEach((col, j) => {
          const lo = col.side === 'left' ? col.anchor : col.anchor - numW
          const hi = col.side === 'left' ? (columns[j + 1]?.pos ?? col.anchor + numW * 2) : col.anchor
          const d = mid < lo ? lo - mid : mid > hi ? mid - hi : 0
          if (d < bestD) (i = j), (bestD = d)
        })
        hdr[i] = hdr[i] ? `${hdr[i]} ${c.text}` : c.text
      }
    if (hdr.filter(Boolean).length >= 2) {
      headers = hdr.map((t, i) => t || `#${i + 1}`)
      hasHeader = true
    }
  }

  return { headers, rows: rows.map(toRow), hasHeader, pages, textItems: items.length }
}
