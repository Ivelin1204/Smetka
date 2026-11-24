// Dev helper: dumps pdf.js text items (with positions) for test fixtures.
// Extracts positioned text items from a PDF with pdf.js (Node, legacy build) → JSON
import { readFileSync, writeFileSync } from 'node:fs'
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
const [,, input, output] = process.argv
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(input)), isEvalSupported: false }).promise
const items = []
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p)
  const tc = await page.getTextContent()
  for (const it of tc.items) {
    if (!('str' in it)) continue
    const t = it.transform
    items.push({ str: it.str, x: +t[4].toFixed(2), y: +t[5].toFixed(2), w: +it.width.toFixed(2), h: +(Math.hypot(t[2], t[3]) || it.height).toFixed(2), page: p })
  }
}
writeFileSync(output, JSON.stringify(items))
console.log(doc.numPages, 'pages', items.length, 'items')
