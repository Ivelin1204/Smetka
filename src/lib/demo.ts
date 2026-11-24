import { daysInMonth, shiftMonth, todayISO } from './dates'
import { round2 } from './money'

export interface RawTx {
  date: string
  description: string
  amount: number
}

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const CARD = '4567XXXXXX1234'
const pos = (m: string) => `POS ПЛАЩАНЕ ${m} ${CARD}`

/**
 * Generates ~7 months of believable Sofia-based personal finances ending today.
 * Descriptions mimic real bank exports (Cyrillic + Latin, card masks, legal suffixes)
 * so they exercise the same categorizer real imports go through.
 */
export function generateDemo(today = todayISO(), months = 7): RawTx[] {
  const rnd = mulberry32(20260101)
  const between = (a: number, b: number) => round2(a + rnd() * (b - a))
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const out: RawTx[] = []
  const endMonth = today.slice(0, 7)
  const todayDay = Number(today.slice(8, 10))

  for (let k = months - 1; k >= 0; k--) {
    const month = shiftMonth(endMonth, -k)
    const dim = daysInMonth(month)
    const last = k === 0 ? todayDay : dim
    const mm = Number(month.slice(5, 7))
    const add = (day: number, description: string, amount: number) => {
      if (day < 1 || day > last) return
      out.push({ date: `${month}-${String(day).padStart(2, '0')}`, description, amount: round2(amount) })
    }
    const days = (n: number) => Array.from({ length: n }, () => 1 + Math.floor(rnd() * last))

    add(1, 'ИЗХОДЯЩ ПРЕВОД КЪМ ИВАН ПЕТРОВ НАЕМ АПАРТАМЕНТ', -620)
    add(2, pos('PULSE FITNESS LOZENETS'), -55)
    add(3, 'ПЛАЩАНЕ СОФИЙСКА ВОДА АД ПО ФАКТУРА', -between(17, 26))
    add(5, 'ЕЛЕКТРОХОЛД ПРОДАЖБИ ЕАД ФАКТУРА', -between(38, mm >= 11 || mm <= 2 ? 92 : 61))
    if (mm >= 10 || mm <= 4) add(6, 'ТОПЛОФИКАЦИЯ СОФИЯ ЕАД', -between(55, 118))
    add(8, 'A1 BULGARIA EAD MOBILE SERVICES', -24.99)
    add(12, `NETFLIX.COM AMSTERDAM NL ${CARD}`, -11.99)
    add(14, `SPOTIFY P2F8A9 STOCKHOLM SE ${CARD}`, k <= 1 ? -7.99 : -6.99)
    add(18, `OPENAI *CHATGPT SUBSCR SAN FRANCISCO US ${CARD}`, -20)
    add(20, `APPLE.COM/BILL ICLOUD ${CARD}`, -2.99)
    add(10, 'ВХОДЯЩ ПРЕВОД ЗАПЛАТА ЗА МЕСЕЦА ТЕХНО СОФТ ООД', 1950)
    add(11, 'ПРЕВОД КЪМ СОБСТВЕНА СМЕТКА СПЕСТОВНА', -300)
    add(dim, 'ТАКСА ОБСЛУЖВАНЕ НА СМЕТКА', -2.5)

    for (const d of days(11)) add(d, pos(pick(['LIDL BULGARIA EOOD SOFIA BGR', 'KAUFLAND BULGARIA SOFIA', 'BILLA BULGARIA EOOD', 'FANTASTICO 23 SOFIA BGR'])), -between(rnd() < 0.7 ? 7 : 40, rnd() < 0.7 ? 38 : 95))
    for (const d of days(7)) {
      const r = rnd()
      if (r < 0.3) add(d, pos('GLOVO SOFIA BGR'), -between(11, 28))
      else if (r < 0.55) add(d, pos('COSTA COFFEE MALL SOFIA'), -between(3.2, 7.5))
      else if (r < 0.75) add(d, pos('HAPPY BAR & GRILL SOFIA'), -between(18, 46))
      else add(d, pos('KAFE DOMA EOOD SOFIA BGR'), -between(4, 12))
    }
    for (const d of days(6)) add(d, `BOLT.EU/R TALLINN EE ${CARD}`, -between(4.8, 13.5))
    for (const d of days(2)) add(d, pos(pick(['SHELL BULGARIA EAD', 'OMV BULGARIA OOD', 'LUKOIL BULGARIA EOOD'])), -between(45, 72))
    for (const d of days(2)) add(d, pos(pick(['EMAG.BG', 'DECATHLON SOFIA', 'DM DROGERIE MARKT', 'H&M MALL OF SOFIA', 'ZORA SOFIA'])), -between(14, 120))
    if (rnd() < 0.85) add(days(1)[0], pos('АПТЕКИ МАРЕШКИ ЕООД'), -between(6, 38))
    if (rnd() < 0.8) add(days(1)[0], pos('CINEMA CITY BULGARIA'), -between(14, 28))
    if (rnd() < 0.7) add(days(1)[0], 'ТЕГЛЕНЕ НА ПАРИ ОТ БАНКОМАТ ДСК СОФИЯ', -pick([50, 100]))
    if (rnd() < 0.45) add(days(1)[0], pos('ZAVEDENIE KOTKATA I CIGULKATA'), -between(22, 58))
    if (k === 2 || k === 5) add(15, 'ВХОДЯЩ ПРЕВОД ОТ ГЕОРГИ ДИМИТРОВ ХОНОРАР УЕБСАЙТ', k === 2 ? 450 : 380)
    if (k === 4) {
      add(9, `RYANAIR FR2847 DUBLIN IE ${CARD}`, -138.4)
      add(10, `BOOKING.COM HOTEL AMSTERDAM ${CARD}`, -312.0)
      add(16, `BOOKING.COM HOTEL AMSTERDAM ${CARD}`, -46.5)
    }
    if (k === 3) add(19, 'ВЪЗСТАНОВЯВАНЕ EMAG.BG ВРЪЩАНЕ НА СТОКА', 39.9)
    if (k === 1) add(21, pos('BILETI.BG KONCERT ARENA 8888'), -64)
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * The same transactions as a bank would export them: Windows-style preamble,
 * semicolons, DD.MM.YYYY dates, decimal commas and a debit/credit marker column.
 * Lets anyone try the import wizard without touching their own data.
 */
export function demoBankCsv(today = todayISO()): string {
  // Same generator, last two months — so importing it after loading the demo shows duplicate detection at work.
  const from = shiftMonth(today.slice(0, 7), -1)
  const rows = generateDemo(today).filter((r) => r.date.slice(0, 7) >= from)
  const fmt = (n: number) => Math.abs(n).toFixed(2).replace('.', ',')
  const lines = [
    'Извлечение по сметка;;;;',
    'Титуляр: ДЕМО ПОТРЕБИТЕЛ;;;;',
    'IBAN: BG00DEMO00000000000000;;;;',
    ';;;;',
    'Дата;Описание;Сума;Д/К;Валута',
    ...rows.map((r) => {
      const [y, m, d] = r.date.split('-')
      return `${d}.${m}.${y};"${r.description}";${fmt(r.amount)};${r.amount < 0 ? 'Д' : 'К'};EUR`
    }),
    `;Общо операции: ${rows.length};;;`,
  ]
  return lines.join('\r\n')
}
