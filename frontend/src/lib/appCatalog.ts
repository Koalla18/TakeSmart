// Каталог известных приложений для раздела «Приложения на iPhone».
// История покупок Apple ID отдаёт только название, bundle и версию. Иконки и жанр
// приложений, которые ещё есть в App Store, помощник берёт из iTunes Lookup; для
// удалённых оттуда (банки, авиакомпании) их нет вовсе — поэтому логотипы популярных
// приложений лежат у нас (public/app-icons/<key>.png) и подбираются по названию или
// bundle. Порядок записей важен: частные раньше общих («Ozon Банк» раньше «Ozon»).

// Группа для быстрого поиска в консоли сотрудника. Классификация идёт по bundle_id
// (он стабильный, в отличие от названия в истории покупок) и по названию.
export type AppGroup =
  | 'bank' | 'messenger' | 'yandex' | 'market' | 'transport'
  | 'telecom' | 'gov' | 'media' | 'social' | 'service' | 'other'

export const GROUP_LABELS: Record<AppGroup, string> = {
  bank: 'Банки',
  messenger: 'Мессенджеры',
  yandex: 'Яндекс',
  market: 'Маркетплейсы',
  transport: 'Транспорт',
  telecom: 'Связь',
  gov: 'Госуслуги',
  media: 'Медиа',
  social: 'Соцсети',
  service: 'Сервисы',
  other: 'Другое',
}

export interface CatalogEntry {
  key: string
  name: string
  match: RegExp
  bank?: boolean
  group?: AppGroup
}

export const APP_CATALOG: CatalogEntry[] = [
  // Банки и финансы
  { key: 'sbermarket', name: 'Купер', match: /купер|сбермаркет|sbermarket|instamart/i, group: 'market' },
  { key: 'sber', name: 'Сбербанк Онлайн', match: /сбербанк|sberbank|сбер банк|^сбер$|сбер онлайн|сбер:|sberbankmobile/i, bank: true, group: 'bank' },
  { key: 'sber', name: 'Сбер', match: /сбер|sber/i, group: 'bank' },
  { key: 'tbank', name: 'Т-Банк', match: /т-банк|t-bank|tbank|idamob\.tinkoff\.ios|^тинькофф$|тинькофф банк|тинькофф:|tinkoff bank/i, bank: true, group: 'bank' },
  { key: 'tbank', name: 'Т-Банк', match: /тиньк|tinkoff|\bt-?bank\b/i, bank: true, group: 'bank' },
  { key: 'alfa', name: 'Альфа-Банк', match: /альфа-?банк|альфа банк|альфа-?мобайл|alfa-?bank|alfabank|ru\.alfabank/i, bank: true, group: 'bank' },
  { key: 'vtb', name: 'ВТБ Онлайн', match: /втб.?онлайн|vtb.?online|^втб$|ru\.vtb24/i, bank: true, group: 'bank' },
  { key: 'gazprombank', name: 'Газпромбанк', match: /газпромбанк|gazprombank|\bgpb\b/i, bank: true, group: 'bank' },
  { key: 'raiffeisen', name: 'Райффайзен Онлайн', match: /райф|raif/i, bank: true, group: 'bank' },
  { key: 'halva', name: 'Халва', match: /халва|halva/i, bank: true, group: 'bank' },
  { key: 'sovcombank', name: 'Совкомбанк', match: /совком|sovcom/i, bank: true, group: 'bank' },
  { key: 'otkritie', name: 'Открытие', match: /^открытие|банк открытие|открытие банк|otkritie|openbank|open\.ru/i, bank: true, group: 'bank' },
  { key: 'psb', name: 'ПСБ', match: /\bпсб|psbank|промсвязь|\bpsb\b/i, bank: true, group: 'bank' },
  { key: 'rosbank', name: 'Росбанк', match: /росбанк|rosbank/i, bank: true, group: 'bank' },
  { key: 'pochtabank', name: 'Почта Банк', match: /почта.?банк|pochta.?bank/i, bank: true, group: 'bank' },
  { key: 'mtsbank', name: 'МТС Банк', match: /мтс.?банк|mts.?bank/i, bank: true, group: 'bank' },
  { key: 'yoomoney', name: 'ЮMoney', match: /юmoney|yoomoney|yandex.?money|яндекс.?деньги|yoo\.money/i, bank: true, group: 'bank' },
  { key: 'ozonbank', name: 'Ozon Банк', match: /ozon.?банк|озон.?банк|ozon.?bank|ozonbank|ozon\.bank/i, bank: true, group: 'bank' },
  { key: 'domrf', name: 'Банк ДОМ.РФ', match: /дом\.?рф|domrf/i, bank: true, group: 'bank' },
  { key: 'rshb', name: 'Россельхозбанк', match: /россельхоз|rshb|rosselkhoz/i, bank: true, group: 'bank' },
  { key: 'ubrir', name: 'УБРиР', match: /убрир|ubrir|ubrr/i, bank: true, group: 'bank' },
  { key: 'akbars', name: 'Ак Барс', match: /ак.?барс|akbars/i, bank: true, group: 'bank' },
  { key: 'uralsib', name: 'Уралсиб', match: /уралсиб|uralsib/i, bank: true, group: 'bank' },
  { key: 'mkb', name: 'МКБ', match: /\bмкб\b|\bmkb\b|московский кредитный/i, bank: true, group: 'bank' },
  { key: 'zenit', name: 'Банк Зенит', match: /банк зенит|зенит банк|зенит онлайн|zenit.?bank|zenit\.ru/i, bank: true, group: 'bank' },
  { key: 'rsb', name: 'Русский Стандарт', match: /русский стандарт|rsb\b|russian standard/i, bank: true, group: 'bank' },
  { key: 'renaissance', name: 'Ренессанс Банк', match: /ренессанс.?(банк|кредит)|renaissance.?(bank|credit)|rencredit/i, bank: true, group: 'bank' },
  { key: 'homebank', name: 'Хоум Банк', match: /хоум.?(банк|кредит)|home.?bank|home.?credit|хкф/i, bank: true, group: 'bank' },
  { key: 'sinara', name: 'Банк Синара', match: /синара|sinara|скб.?банк/i, bank: true, group: 'bank' },
  { key: 'tochka', name: 'Точка', match: /^точка\b|точка банк|банк точка|tochka/i, bank: true, group: 'bank' },
  { key: 'lokobank', name: 'Локо-Банк', match: /локо-?банк|lockobank|loko-?bank/i, bank: true, group: 'bank' },
  { key: 'bspb', name: 'Банк Санкт-Петербург', match: /банк санкт-петербург|bspb/i, bank: true, group: 'bank' },
  { key: 'otp', name: 'ОТП Банк', match: /отп.?банк|otp.?bank|otpbank/i, bank: true, group: 'bank' },
  { key: 'unicredit', name: 'ЮниКредит', match: /юникредит|unicredit/i, bank: true, group: 'bank' },
  { key: 'mir', name: 'Mir Pay', match: /mir.?pay|мир.?pay/i, bank: true, group: 'bank' },
  // Мессенджеры
  { key: 'telegram', name: 'Telegram', match: /telegram|телеграм|org\.telegram/i, group: 'messenger' },
  { key: 'whatsapp', name: 'WhatsApp', match: /whatsapp|вотсап|ватсап|net\.whatsapp/i, group: 'messenger' },
  { key: 'viber', name: 'Viber', match: /\bviber\b|вайбер|com\.viber/i, group: 'messenger' },
  { key: 'max', name: 'MAX', match: /^max\b|мессенджер max|oneme\.max/i, group: 'messenger' },
  { key: 'tamtam', name: 'ТамТам', match: /tamtam|тамтам/i, group: 'messenger' },
  // Соцсети
  { key: 'vkvideo', name: 'VK Видео', match: /vk.?видео|vk.?video/i, group: 'social' },
  { key: 'vk', name: 'ВКонтакте', match: /вконтакте|^vk\b|com\.vk\./i, group: 'social' },
  { key: 'ok', name: 'Одноклассники', match: /одноклассник|\bok\.ru\b|odnoklassniki/i, group: 'social' },
  // Транспорт
  { key: 'aeroflot', name: 'Аэрофлот', match: /аэрофлот|aeroflot/i, group: 'transport' },
  { key: 's7', name: 'S7 Airlines', match: /\bs7\b|сибирь/i, group: 'transport' },
  { key: 'pobeda', name: 'Победа', match: /победа|pobeda/i, group: 'transport' },
  { key: 'utair', name: 'Utair', match: /utair|ютэйр|ютейр/i, group: 'transport' },
  { key: 'rzd', name: 'РЖД', match: /\bржд\b|\brzd\b/i, group: 'transport' },
  { key: 'delimobil', name: 'Делимобиль', match: /делимобиль|delimobil/i, group: 'transport' },
  { key: 'citydrive', name: 'Ситидрайв', match: /ситидрайв|citydrive/i, group: 'transport' },
  { key: 'cdek', name: 'СДЭК', match: /сдэк|cdek/i, group: 'transport' },
  { key: 'pochta', name: 'Почта России', match: /почта россии|russian post|pochta\.ru/i, group: 'transport' },
  // Маркетплейсы и магазины
  { key: 'wb', name: 'Wildberries', match: /wildberries|вайлдберриз|\bwb\b/i, group: 'market' },
  { key: 'ozon', name: 'Ozon', match: /ozon|озон/i, group: 'market' },
  { key: 'avito', name: 'Авито', match: /авито|avito/i, group: 'market' },
  { key: 'samokat', name: 'Самокат', match: /самокат|samokat/i, group: 'market' },
  { key: 'lamoda', name: 'Lamoda', match: /lamoda|ламода/i, group: 'market' },
  { key: 'dns', name: 'DNS', match: /\bdns\b|днс/i, group: 'market' },
  { key: 'mvideo', name: 'М.Видео', match: /м\.?видео|mvideo/i, group: 'market' },
  { key: 'dodo', name: 'Додо Пицца', match: /додо|dodo/i, group: 'market' },
  // Госуслуги
  { key: 'gosuslugi', name: 'Госуслуги', match: /госуслуг|gosuslug/i, group: 'gov' },
  // Медиа
  { key: 'kinopoisk', name: 'Кинопоиск', match: /кинопоиск|kinopoisk/i, group: 'media' },
  { key: 'ivi', name: 'Иви', match: /\bиви\b|\bivi\b/i, group: 'media' },
  { key: 'okko', name: 'Okko', match: /okko|окко/i, group: 'media' },
  { key: 'kion', name: 'KION', match: /kion|кион/i, group: 'media' },
  // Яндекс — все приложения и конфигурации (Go, Карты, Еда, Браузер, Плюс, Ключ…)
  { key: 'yandex', name: 'Яндекс', match: /яндекс|yandex/i, group: 'yandex' },
  // Связь
  { key: 'megafon', name: 'МегаФон', match: /мегафон|megafon/i, group: 'telecom' },
  { key: 'beeline', name: 'билайн', match: /билайн|beeline/i, group: 'telecom' },
  { key: 'tele2', name: 't2', match: /tele2|теле2|\bt2\b/i, group: 'telecom' },
  { key: 'mts', name: 'МТС', match: /мой мтс|\bмтс\b|\bmts\b/i, group: 'telecom' },
  // Сервисы
  { key: '2gis', name: '2ГИС', match: /2гис|2gis/i, group: 'service' },
]

/** Ключи, для которых лежит файл public/app-icons/<key>.png */
export const AVAILABLE_ICONS = new Set<string>(APP_CATALOG.map(e => e.key).filter(k => !['mir', 'telegram', 'whatsapp', 'viber', 'tamtam', 'ok'].includes(k)))

export interface PurchaseLike {
  name: string
  bundle_id: string
  icon?: string | null
  genre?: string | null
}

export interface ResolvedApp {
  /** Человеческое название: из каталога, иначе как в истории покупок */
  name: string
  /** Иконка: из App Store (если приложение ещё там), иначе из каталога, иначе null → буквенная плитка */
  icon: string | null
  bank: boolean
  letter: string
  /** Цвет буквенной плитки, стабильный для приложения */
  hue: number
}

export function findCatalogEntry(p: PurchaseLike): CatalogEntry | null {
  const hay = `${p.name} ${p.bundle_id}`
  for (const e of APP_CATALOG) if (e.match.test(hay)) return e
  return null
}

export function resolveApp(p: PurchaseLike): ResolvedApp {
  const entry = findCatalogEntry(p)
  const name = p.name || entry?.name || p.bundle_id
  const catalogIcon = entry && AVAILABLE_ICONS.has(entry.key) ? `/app-icons/${entry.key}.png` : null
  const bank = Boolean(entry?.bank) || p.genre === 'Finance' || /\bбанк\b|\bbank\b/i.test(p.name)
  let h = 0
  for (const ch of p.bundle_id || name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  // Буква плитки — первая буква или цифра: у «Пятерочка» — карта скидок» это П, а не кавычка
  const letter = (name.match(/[\p{L}\p{N}]/u)?.[0] || '?').toUpperCase()
  return { name, icon: p.icon || catalogIcon, bank, letter, hue: h % 360 }
}

export interface AppClassification {
  group: AppGroup
  groupLabel: string
  /** Российское / актуальное для РФ приложение — для быстрого фильтра «Русские» */
  russian: boolean
}

/**
 * Группа приложения для поиска в консоли. Сначала каталог (по названию и bundle),
 * затем bundle-признаки (yandex. / org.telegram / net.whatsapp — на случай, когда
 * название в истории покупок старое или английское), затем жанр/название.
 */
export function classifyApp(p: PurchaseLike): AppClassification {
  const entry = findCatalogEntry(p)
  const bundle = (p.bundle_id || '').toLowerCase()
  let group: AppGroup
  if (entry?.group) group = entry.group
  else if (/(^|\.)yandex\./.test(bundle)) group = 'yandex'
  else if (/^org\.telegram/.test(bundle)) group = 'messenger'
  else if (/^net\.whatsapp/.test(bundle)) group = 'messenger'
  else if (/^com\.viber/.test(bundle)) group = 'messenger'
  else if (/^com\.vk\.|^ru\.vk\b/.test(bundle)) group = 'social'
  else if (p.genre === 'Finance' || /\bбанк\b|\bbank\b/i.test(p.name)) group = 'bank'
  else group = 'other'
  const russian = Boolean(entry) || group !== 'other'
    || /[а-яё]/i.test(p.name)
    || /^ru\./.test(bundle)
    || /^com\.(yandex|vk|ozon|wildberries|avito|kinopoisk|mail)\b/.test(bundle)
  return { group, groupLabel: GROUP_LABELS[group], russian }
}
