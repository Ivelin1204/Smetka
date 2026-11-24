import { categoryKind } from './categories'
import type { CategorySource, Rule } from './types'

const PREFIXES = [
  'POS ПЛАЩАНЕ', 'ПЛАЩАНЕ ПОС', 'ПЛАЩАНЕ С КАРТА', 'ПОКУПКА', 'ПЛАЩАНЕ', 'ПОС', 'POS PURCHASE', 'POS PAYMENT', 'CARD PAYMENT',
  'POS', 'PURCHASE', 'PAYMENT TO', 'PAYMENT', 'ВХОДЯЩ ПРЕВОД ОТ', 'ВХОДЯЩ ПРЕВОД', 'ИЗХОДЯЩ ПРЕВОД КЪМ', 'ИЗХОДЯЩ ПРЕВОД',
  'ПРЕВОД ОТ', 'ПРЕВОД КЪМ', 'TRANSFER FROM', 'TRANSFER TO', 'КАРТОВО ПЛАЩАНЕ', 'ПЛАЩ.', 'ИНТЕРНЕТ ПЛАЩАНЕ', 'ONLINE PAYMENT',
]
// Unicode-aware word boundaries: \b does not work with Cyrillic.
const LEGAL = /(?<![\p{L}\p{N}])(EOOD|OOD|AD|EAD|LTD|GMBH|INC|LLC|ЕООД|ООД|АД|ЕАД|ЕТ|SA|SRL|BV)(?![\p{L}\p{N}])\.?/gu
const COUNTRY_CITY = /(?<![\p{L}\p{N}])(BGR|BG|БЪЛГАРИЯ|BULGARIA|BALGARIYA|BALGARIA|SOFIA|СОФИЯ|PLOVDIV|ПЛОВДИВ|VARNA|ВАРНА|BURGAS|БУРГАС|IE|LU|NL|GB|US|CY|EE|SE|FR|DE|IT|ES|AT|LT|TALLINN|STOCKHOLM|AMSTERDAM|DUBLIN|LUXEMBOURG|LONDON|SAN FRANCISCO|SUBSCR|SUBSCRIPTION|SUB)(?![\p{L}\p{N}])/gu
// Web domains: "NETFLIX.COM/BILL" → "NETFLIX"
const DOMAIN = /\.(COM|EU|BG|NET|IO|ORG|AI|CO)(\/\S*)?(?![\p{L}\p{N}])/gu

/** Upper-cases, strips card masks, long numbers, dates and punctuation noise. */
export function normalizeDescription(desc: string): string {
  return desc
    .toUpperCase()
    .replace(/[*X]{2,}\d{2,4}/g, ' ')
    .replace(/\d{4,}/g, ' ')
    .replace(/\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/g, ' ')
    .replace(/\d{1,2}:\d{2}(:\d{2})?/g, ' ')
    .replace(/[|;"_#*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Turns "POS ПЛАЩАНЕ LIDL BULGARIA EOOD SOFIA BGR" into "Lidl". */
export function extractMerchant(desc: string): string {
  let s = normalizeDescription(desc)
  for (let changed = true; changed; ) {
    changed = false
    for (const p of PREFIXES) {
      if (s.startsWith(p + ' ') || s.startsWith(p + ':')) {
        s = s.slice(p.length + 1).trim()
        changed = true
      }
    }
  }
  // Card terminals often append "-CITY-CC": "BILLA 316 02-PLOVDIV-BG".
  s = s.replace(/-[\p{L}\d .]+-\p{L}{2}$/u, ' ')
  s = s
    .replace(DOMAIN, ' ')
    .replace(LEGAL, ' ')
    .replace(COUNTRY_CITY, ' ')
    .replace(/[,:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  // Drop reference codes like "P2F8A9" or "FR2847" — letters and digits mixed.
  const words = s.split(' ').filter((w) => w.length > 1 && !/^\d+$/.test(w) && !(w.length >= 5 && /\d/.test(w) && /\p{L}/u.test(w)))
  const picked = words.slice(0, 3).join(' ') || normalizeDescription(desc).slice(0, 24)
  return titleCase(picked)
}

function titleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/(^|[\s\-/&])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase())
}

export function sortRules(rules: Rule[]): Rule[] {
  return [...rules].sort((a, b) => {
    if (a.origin !== b.origin) return a.origin === 'user' ? -1 : 1
    if (a.origin === 'user' && a.createdAt !== b.createdAt) return b.createdAt - a.createdAt
    return b.pattern.length - a.pattern.length
  })
}

export function ruleMatches(rule: Rule, normalized: string): boolean {
  const p = rule.pattern.toUpperCase()
  if (p.length <= 3) {
    // Short patterns ("A1", "ЕВН", "HM") must match a whole word, or "EVN" would catch "SEVNICA".
    return new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(p)}([^\\p{L}\\p{N}]|$)`, 'u').test(normalized)
  }
  return normalized.includes(p)
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** What rules are matched against: the cleaned description plus the extracted merchant name. */
export function haystack(description: string): string {
  return `${normalizeDescription(description)} | ${extractMerchant(description).toUpperCase()}`
}

export interface CategoryResult {
  categoryId: string
  source: CategorySource
  ruleId?: string
}

/**
 * Picks a category. User rules beat built-in ones, longer patterns beat shorter ones.
 * A rule is skipped when its direction contradicts the money flow (e.g. a "salary" rule on a payment),
 * except refunds — money back from a shop stays in that shop's category.
 */
export function categorize(description: string, amount: number, sortedRules: Rule[]): CategoryResult {
  const normalized = haystack(description)
  for (const rule of sortedRules) {
    if (!ruleMatches(rule, normalized)) continue
    const kind = categoryKind(rule.categoryId)
    if (kind === 'income' && amount < 0) continue
    return { categoryId: rule.categoryId, source: 'rule', ruleId: rule.id }
  }
  return { categoryId: amount > 0 ? 'income-other' : 'other', source: 'fallback' }
}

/** Pattern used when the user teaches the app: the merchant name, upper-cased. */
export function patternFromMerchant(merchant: string): string {
  return merchant.toUpperCase().trim()
}
