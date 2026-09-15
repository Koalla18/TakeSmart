// ─────────────────────────────────────────────────────────────────────────────
// Умный поиск по каталогу и админке. Проблема старого поиска: токены запроса
// искались подстрокой где угодно — «watch se» находил каждый ремешок, потому
// что «se» сидит внутри «Case». Здесь токены матчатся ПО СЛОВАМ (точно или по
// началу слова), а результаты ранжируются: точная фраза в названии → все слова
// точно → совпадения по началу слов. Слабые попадания (внутри слова, только в
// описании/slug) показываются лишь когда сильных нет вообще.
// ─────────────────────────────────────────────────────────────────────────────

/** Нижний регистр, ё→е, пунктуация→пробел, цифры отделяются от букв («128гб» → «128 гб») */
export function normalizeSearchText(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[()[\]{}.,/\\+\-_:;"'«»!?№#*]/g, ' ')
    .replace(/(\d)(\p{L})/gu, '$1 $2')
    .replace(/(\p{L})(\d)/gu, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

const WEAK = 10

/** Сила совпадения токена со списком слов: 3 — слово целиком, 2 — начало слова, 1 — внутри слова */
function tokenStrength(token: string, words: string[]): number {
  let best = 0
  for (const word of words) {
    if (word === token) return 3
    if (best < 2 && token.length >= 2 && word.startsWith(token)) best = 2
    else if (best < 1 && token.length >= 3 && word.includes(token)) best = 1
  }
  return best
}

/**
 * Оценка совпадения запроса с товаром.
 * 0 — какой-то токен не нашёлся нигде; 100 — фраза целиком в названии;
 * 60 — все слова точно в названии; 40 — точно или по началу слов; 10 — слабое
 * (токен только внутри слова или только в доп. полях: бренд/описание/slug).
 */
export function scoreSearchMatch(query: string, name: string, extra = ''): number {
  const q = normalizeSearchText(query)
  if (!q) return 0
  const nameNorm = normalizeSearchText(name)
  const nameWords = nameNorm ? nameNorm.split(' ') : []
  const extraWords = extra ? normalizeSearchText(extra).split(' ') : []
  let minInName = 3
  for (const token of q.split(' ')) {
    const inName = tokenStrength(token, nameWords)
    if (inName === 0) {
      if (tokenStrength(token, extraWords) === 0) return 0
      minInName = 0
    } else if (inName < minInName) {
      minInName = inName
    }
  }
  if (nameNorm.includes(q)) return 100
  if (minInName >= 3) return 60
  if (minInName >= 2) return 40
  return WEAK
}

/**
 * Отфильтровать и отранжировать по релевантности. При равных очках порядок
 * исходного списка сохраняется (sort стабилен), короткое название выигрывает
 * у длинного — конкретная модель встаёт выше «полного комплекта со всем».
 */
export function rankSearch<T>(
  items: readonly T[],
  query: string,
  getName: (item: T) => string,
  getExtra?: (item: T) => string,
): T[] {
  if (!query.trim()) return [...items]
  const scored: { item: T; score: number; len: number }[] = []
  let hasStrong = false
  for (const item of items) {
    const score = scoreSearchMatch(query, getName(item), getExtra?.(item) ?? '')
    if (score <= 0) continue
    if (score > WEAK) hasStrong = true
    scored.push({ item, score, len: getName(item).length })
  }
  const kept = hasStrong ? scored.filter(s => s.score > WEAK) : scored
  return kept.sort((a, b) => (b.score - a.score) || (a.len - b.len)).map(s => s.item)
}

/** Булев строгий матч (точно/по началу слов) — для списков с замороженным порядком */
export function matchesSearchStrict(query: string, haystack: string): boolean {
  return scoreSearchMatch(query, haystack) >= 40
}
