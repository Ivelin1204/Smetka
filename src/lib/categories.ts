import type { Category, Rule } from './types'

export const CATEGORIES: Category[] = [
  { id: 'groceries', kind: 'expense', color: '#4CC9F0', icon: '🛒' },
  { id: 'dining', kind: 'expense', color: '#FFB547', icon: '🍜' },
  { id: 'transport', kind: 'expense', color: '#5B8DEF', icon: '🚕' },
  { id: 'fuel', kind: 'expense', color: '#2EC4B6', icon: '⛽' },
  { id: 'housing', kind: 'expense', color: '#C3A46B', icon: '🏠' },
  { id: 'utilities', kind: 'expense', color: '#F7DF6E', icon: '💡' },
  { id: 'telecom', kind: 'expense', color: '#80ED99', icon: '📶' },
  { id: 'subscriptions', kind: 'expense', color: '#F15BB5', icon: '🔁' },
  { id: 'shopping', kind: 'expense', color: '#E5989B', icon: '🛍️' },
  { id: 'health', kind: 'expense', color: '#A3E635', icon: '💊' },
  { id: 'fun', kind: 'expense', color: '#EF476F', icon: '🎬' },
  { id: 'travel', kind: 'expense', color: '#6A994E', icon: '✈️' },
  { id: 'cash', kind: 'expense', color: '#8D99AE', icon: '🏧' },
  { id: 'fees', kind: 'expense', color: '#A0616A', icon: '🏦' },
  { id: 'other', kind: 'expense', color: '#6C757D', icon: '❔' },
  { id: 'salary', kind: 'income', color: '#3DDC97', icon: '💼' },
  { id: 'income-other', kind: 'income', color: '#80ED99', icon: '💶' },
  { id: 'transfer', kind: 'transfer', color: '#7D8597', icon: '🔄' },
]

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c])) as Record<string, Category>

export function categoryKind(id: string) {
  return CATEGORY_BY_ID[id]?.kind ?? 'expense'
}

/**
 * Built-in rules for merchants common in Bulgaria. Both Latin and Cyrillic spellings,
 * because bank exports use either depending on the terminal.
 */
const BUILTIN: Record<string, string[]> = {
  groceries: ['LIDL', 'LIDAL', 'ЛИДЛ', 'KAUFLAND', 'КАУФЛАНД', 'BILLA', 'БИЛА', 'FANTASTICO', 'ФАНТАСТИКО', 'T MARKET', 'Т МАРКЕТ', 'CBA', 'METRO CASH', 'ЛЕКСИ', 'ABC MARKET', 'ШЕЙ', 'ХЛЯБ', 'БАКАЛИЯ'],
  dining: ['AMREST', 'GLOVO', 'FOODPANDA', 'TAKEAWAY', 'HAPPY', 'ХЕПИ', 'MCDONALD', 'KFC', 'STARBUCKS', 'COSTA COFFEE', 'DOMINO', 'RESTAURANT', 'РЕСТОРАНТ', 'CAFE', 'КАФЕ', 'COFFEE', 'PIZZA', 'ПИЦА', 'BISTRO', 'БИСТРО', 'WOLT'],
  transport: ['BOLT', 'UBER', 'YELLOW', 'ЦЕНТЪР ЗА ГРАДСКА МОБИЛНОСТ', 'SOFIA METRO', 'МЕТРОПОЛИТЕН', 'PARKING', 'ПАРКИНГ', 'BDZ', 'БДЖ', 'VIGNETTE', 'ВИНЕТКА', 'BGTOLL', 'TAXI', 'ТАКСИ', 'SPARK'],
  fuel: ['SHELL', 'OMV', 'LUKOIL', 'LUKOYL', 'ЛУКОЙЛ', 'KARGO OIL', 'EKO', 'ЕКО БЪЛГАРИЯ', 'PETROL', 'ПЕТРОЛ', 'RODNA ZEMYA', 'РОДНА ЗЕМЯ', 'GAZPROM', 'ГАЗПРОМ'],
  housing: ['НАЕМ', 'RENT', 'ВХОДНА ТАКСА', 'ДОМОУПРАВИТЕЛ', 'IKEA', 'ИКЕА', 'JYSK', 'PRAKTIKER', 'ПРАКТИКЕР', 'MR BRICOLAGE', 'МР. БРИКОЛАЖ'],
  utilities: ['ELECTROHOLD', 'ЕЛЕКТРОХОЛД', 'EVN', 'ЕВН', 'ENERGO-PRO', 'ЕНЕРГО-ПРО', 'CEZ', 'ЧЕЗ', 'СОФИЙСКА ВОДА', 'SOFIYSKA VODA', 'ВИК', 'ТОПЛОФИКАЦИЯ', 'TOPLOFIKACIA', 'OVERGAS', 'ОВЕРГАЗ', 'ТЕХЕМ', 'TECHEM'],
  telecom: ['A1 BULGARIA', 'A1 БЪЛГАРИЯ', 'A1', 'А1', 'YETTEL', 'ЙЕТЕЛ', 'VIVACOM', 'ВИВАКОМ', 'TELENOR', 'BULSATCOM', 'БУЛСАТКОМ'],
  subscriptions: ['NETFLIX', 'SPOTIFY', 'YOUTUBE', 'DISNEY', 'HBO', 'MAX.COM', 'APPLE.COM', 'ICLOUD', 'GOOGLE STORAGE', 'GOOGLE ONE', 'CHATGPT', 'OPENAI', 'ANTHROPIC', 'CLAUDE.AI', 'ADOBE', 'FIGMA', 'GITHUB', 'NOTION', 'PATREON', 'XBOX', 'PLAYSTATION', 'STEAM', 'MULTISPORT', 'ФИТНЕС', 'FITNESS', 'GYM'],
  shopping: ['EMAG', 'ЕМАГ', 'AMAZON', 'ALIEXPRESS', 'TEMU', 'ZARA', 'H&M', 'DECATHLON', 'TECHNOPOLIS', 'ТЕХНОПОЛИС', 'TECHMART', 'ZORA', 'ЗОРА', 'OZONE', 'DM DROGERIE', 'ДМ ДРОГЕРИ', 'LILLY', 'ЛИЛИ', 'PEPCO', 'SINSAY', 'ABOUT YOU', 'NOTINO', 'HELIKON', 'ХЕЛИКОН', 'SPEEDY', 'СПИДИ', 'ECONT', 'ЕКОНТ'],
  health: ['АПТЕКА', 'APTEKA', 'PHARMACY', 'SOPHARMA', 'СОФАРМА', 'МАРЕШКИ', 'MARESHKI', 'SUBRA', 'СУБРА', 'ЛАБОРАТОРИЯ', 'ЦИБАЛАБ', 'CIBALAB', 'БОЛНИЦА', 'HOSPITAL', 'ДЕНТАЛ', 'DENTAL', 'МЕДИЦИНСКИ ЦЕНТЪР', 'ACIBADEM', 'АДЖИБАДЕМ'],
  fun: ['CINEMA CITY', 'СИНЕМА СИТИ', 'ARENA', 'BILETI.BG', 'EVENTIM', 'ЕВЕНТИМ', 'TICKETSTATION', 'BOWLING', 'БОУЛИНГ', 'MUSEUM', 'МУЗЕЙ', 'THEATRE', 'ТЕАТЪР'],
  travel: ['RYANAIR', 'WIZZ', 'BULGARIA AIR', 'BOOKING.COM', 'AIRBNB', 'HOTEL', 'ХОТЕЛ', 'FLIXBUS', 'UNION IVKONI', 'ЮНИОН ИВКОНИ', 'SKYSCANNER'],
  cash: ['ATM', 'БАНКОМАТ', 'BANKOMAT', 'ТЕГЛЕНЕ НА ПАРИ', 'CASH WITHDRAWAL', 'ТЕГЛЕНЕ В БРОЙ'],
  fees: ['ТАКСА ОБСЛУЖВАНЕ', 'ТАКСА ЗА', 'МЕСЕЧНА ТАКСА', 'BANK FEE', 'SERVICE FEE', 'КОМИСИОНА', 'ЛИХВА ПО КРЕДИТ'],
  salary: ['ЗАПЛАТА', 'SALARY', 'ВЪЗНАГРАЖДЕНИЕ', 'PAYROLL', 'ТРУДОВО'],
  'income-other': ['ВЪЗСТАНОВЯВАНЕ', 'REFUND', 'CASHBACK', 'ЛИХВА ПО ДЕПОЗИТ', 'INTEREST', 'ХОНОРАР', 'ФАКТУРА'],
  transfer: ['PLASHTANE PO KARTOVA', 'ПЛАЩАНЕ ПО КАРТОВА', 'ПЛАЩАНЕ КЪМ КАРТАТА', 'ПОГАСЯВАНЕ НА КАРТА', 'TOP-UP', 'TOPUP', 'ЗАХРАНВАНЕ', 'МЕЖДУ СОБСТВЕНИ', 'OWN ACCOUNT', 'SAVINGS', 'СПЕСТОВН', 'TO POCKET', 'REVOLUT', 'ПРЕВОД КЪМ СОБСТВЕНА'],
}

export const BUILTIN_RULES: Rule[] = Object.entries(BUILTIN).flatMap(([categoryId, patterns]) =>
  patterns.map((pattern) => ({
    id: `builtin:${categoryId}:${pattern}`,
    pattern,
    categoryId,
    origin: 'builtin' as const,
    createdAt: 0,
  })),
)
