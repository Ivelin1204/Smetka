import { decodeBytes, findClosingBalance, parseTable, tableFromRows, type ParsedTable } from './csv'
import { pdfItemsToTable, type PdfTextItem } from './pdfTable'

export type FileKind = 'csv' | 'xlsx' | 'pdf'

export interface LoadedTable {
  table: ParsedTable
  /** Short facts shown as chips: encoding, delimiter, pages, sheet… */
  facts: { label: 'encoding' | 'delimiter' | 'pages' | 'sheet'; value: string }[]
}

export type ImportErrorCode = 'scanned-pdf' | 'no-table' | 'unreadable'

export class ImportError extends Error {
  code: ImportErrorCode
  constructor(code: ImportErrorCode) {
    super(code)
    this.code = code
  }
}

export function detectKind(name: string, bytes: Uint8Array): FileKind {
  // Magic bytes first — file extensions lie.
  if (bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) return 'pdf' // %PDF
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) return 'xlsx' // PK (zip)
  if (/\.pdf$/i.test(name)) return 'pdf'
  if (/\.xlsx$/i.test(name)) return 'xlsx'
  return 'csv'
}

export async function loadTable(name: string, buf: ArrayBuffer): Promise<LoadedTable> {
  const kind = detectKind(name, new Uint8Array(buf.slice(0, 8)))
  if (kind === 'pdf') return loadPdf(buf)
  if (kind === 'xlsx') return loadXlsx(buf)
  const { text, encoding } = decodeBytes(buf)
  const table = parseTable(text)
  return {
    table,
    facts: [
      { label: 'encoding', value: encoding.toUpperCase() },
      { label: 'delimiter', value: table.delimiter === '\t' ? 'TAB' : table.delimiter },
    ],
  }
}

/* ───────── Excel ───────── */

async function loadXlsx(buf: ArrayBuffer): Promise<LoadedTable> {
  const { default: readXlsxFile } = await import('read-excel-file/browser')
  let sheets
  try {
    sheets = await readXlsxFile(new Blob([buf]))
  } catch {
    throw new ImportError('unreadable')
  }
  // Pick the sheet that looks most like a statement: most rows containing something date-ish.
  const pad = (n: number) => String(n).padStart(2, '0')
  const cell = (v: unknown): string => {
    if (v == null) return ''
    if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`
    return String(v)
  }
  let best: { name: string; table: ParsedTable } | null = null
  for (const s of sheets) {
    const table = tableFromRows(s.data.map((r) => r.map(cell)), '', 'xlsx')
    if (!best || table.rows.length > best.table.rows.length) best = { name: s.sheet, table }
  }
  if (!best || !best.table.rows.length) throw new ImportError('no-table')
  return { table: best.table, facts: [{ label: 'sheet', value: best.name }] }
}

/* ───────── PDF ───────── */

let workerPort: Worker | null = null

/** Text with positions from every page. pdf.js is loaded only when a PDF is opened. */
export async function extractPdfText(buf: ArrayBuffer): Promise<{ items: PdfTextItem[]; pages: number }> {
  const pdfjs = await import('pdfjs-dist')
  if (!workerPort) {
    // The worker is bundled as text and started from a blob: URL, so it works from a single
    // self-contained file and from GitHub Pages alike.
    const { default: code } = await import('pdfjs-dist/build/pdf.worker.min.mjs?raw')
    workerPort = new Worker(URL.createObjectURL(new Blob([code], { type: 'text/javascript' })), { type: 'module' })
    pdfjs.GlobalWorkerOptions.workerPort = workerPort
  }
  // Text only: no fonts are rendered, so there is nothing for pdf.js to fetch.
  const task = pdfjs.getDocument({ data: new Uint8Array(buf), disableFontFace: true })
  const doc = await task.promise
  const items: PdfTextItem[] = []
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    for (const it of content.items) {
      if (!('str' in it) || !it.str.trim()) continue
      const t = it.transform as number[]
      items.push({ str: it.str, x: t[4], y: t[5], w: it.width, h: Math.hypot(t[2], t[3]) || it.height, page: p })
    }
    page.cleanup()
  }
  const pages = doc.numPages
  await task.destroy()
  return { items, pages }
}

async function loadPdf(buf: ArrayBuffer): Promise<LoadedTable> {
  let extracted
  try {
    extracted = await extractPdfText(buf)
  } catch {
    throw new ImportError('unreadable')
  }
  // A scan is just pictures of pages: next to no text to read.
  if (extracted.items.length < extracted.pages * 5) throw new ImportError('scanned-pdf')
  const t = pdfItemsToTable(extracted.items)
  if (!t.rows.length) throw new ImportError('no-table')
  return {
    table: { source: 'pdf', delimiter: '', headerIndex: t.hasHeader ? 0 : -1, headers: t.headers, rows: t.rows, closingBalance: findClosingBalance(t.otherLines) },
    facts: [{ label: 'pages', value: String(extracted.pages) }],
  }
}
