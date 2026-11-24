export type CategoryKind = 'expense' | 'income' | 'transfer'

export interface Category {
  id: string
  kind: CategoryKind
  color: string
  icon: string
}

export type CategorySource = 'rule' | 'manual' | 'fallback'

export interface Transaction {
  /** Stable fingerprint — the same bank row always gets the same id, so re-imports dedupe. */
  id: string
  /** ISO date, YYYY-MM-DD */
  date: string
  /** Raw description as it appeared in the bank export */
  description: string
  /** Cleaned-up merchant name used for grouping and rules */
  merchant: string
  /** Amount in EUR. Negative = money out. */
  amount: number
  originalAmount: number
  originalCurrency: string
  categoryId: string
  categorySource: CategorySource
  importId: string
}

export interface Rule {
  id: string
  /** Upper-case substring matched against the normalized description */
  pattern: string
  categoryId: string
  origin: 'builtin' | 'user'
  createdAt: number
}

export type AmountMode = 'signed' | 'split' | 'direction'
export type DateFormat = 'DD.MM.YYYY' | 'YYYY-MM-DD' | 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'DD-MM-YYYY'
export type DecimalSep = ',' | '.'
export type CurrencyMode = 'EUR' | 'BGN' | 'auto-euro-switch' | 'column'

export interface ColumnMapping {
  date: number
  description: number
  /** Extra columns appended to the description (e.g. counterparty) */
  descriptionExtra: number[]
  amountMode: AmountMode
  amount: number
  debit: number
  credit: number
  direction: number
  /** Values in the direction column that mean money out, e.g. "Д", "D", "DEBIT" */
  debitMarkers: string[]
  currency: number
  currencyMode: CurrencyMode
  dateFormat: DateFormat
  decimal: DecimalSep
  invertSign: boolean
}

export interface MappingProfile {
  /** Signature of the header row — identifies the bank format */
  signature: string
  mapping: ColumnMapping
  updatedAt: number
}

export interface ImportRecord {
  id: string
  fileName: string
  createdAt: number
  added: number
  duplicates: number
  errors: number
}

export interface Budget {
  categoryId: string
  /** Monthly limit in EUR (positive) */
  limit: number
}
