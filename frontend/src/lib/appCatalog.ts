// Каталог известных приложений для раздела «Приложения на iPhone».
// История покупок Apple ID отдаёт только название, bundle и версию. Иконки и жанр
// приложений, которые ещё есть в App Store, помощник берёт из iTunes Lookup; для
// удалённых оттуда (банки, авиакомпании) их нет вовсе — поэтому логотипы популярных
// приложений лежат у нас (public/app-icons/<key>.png) и подбираются по названию или
// bundle. Порядок записей важен: частные раньше общих («Ozon Банк» раньше «Ozon»).

export interface CatalogEntry {
  key: string
  name: string
  match: RegExp
  bank?: boolean
}

export const APP_CATALOG: CatalogEntry[] = [
  // Банки и финансы
  { key: 'sbermarket', name: 'Купер', match: /купер|сбермаркет|sbermarket/i },
  { key: 'sber', name: 'Сбербанк Онлайн', match: /сбер|sber/i, bank: true },
  { key: 'tbank', name: 'Т-Банк', match: /т-банк|t-bank|tbank|тиньк|tinkoff|idamob/i, bank: true },
  { key: 'alfa', name: 'Альфа-Банк', match: /альфа|alfa/i, bank: true },
  { key: 'vtb', name: 'ВТБ Онлайн', match: /втб|vtb/i, bank: true },
  { key: 'gazprombank', name: 'Газпромбанк', match: /газпромбанк|gazprombank|\bgpb\b/i, bank: true },
  { key: 'raiffeisen', name: 'Райффайзен Онлайн', match: /райф|raif/i, bank: true },
  { key: 'halva', name: 'Халва', match: /халва|halva/i, bank: true },
  { key: 'sovcombank', name: 'Совкомбанк', match: /совком|sovcom/i, bank: true },
  { key: 'otkritie', name: 'Открытие', match: /открыти|otkrit|openbank|open\.ru/i, bank: true },
  { key: 'psb', name: 'ПСБ', match: /\bпсб|psbank|промсвязь|\bpsb\b/i, bank: true },
  { key: 'rosbank', name: 'Росбанк', match: /росбанк|rosbank/i, bank: true },
  { key: 'pochtabank', name: 'Почта Банк', match: /почта.?банк|pochta.?bank/i, bank: true },
  { key: 'mtsbank', name: 'МТС Банк', match: /мтс.?банк|mts.?bank/i, bank: true },
  { key: 'yoomoney', name: 'ЮMoney', match: /юmoney|yoomoney|yandex.?money|яндекс.?деньги/i, bank: true },
  { key: 'ozonbank', name: 'Ozon Банк', match: /ozon.?банк|озон.?банк|ozon.?bank|ozonbank/i, bank: true },
  { key: 'domrf', name: 'Банк ДОМ.РФ', match: /дом\.?рф|domrf/i, bank: true },
  { key: 'rshb', name: 'Россельхозбанк', match: /россельхоз|rshb|rosselkhoz/i, bank: true },
  { key: 'ubrir', name: 'УБРиР', match: /убрир|ubrir|ubrr/i, bank: true },
  { key: 'akbars', name: 'Ак Барс', match: /ак.?барс|akbars/i, bank: true },
  { key: 'uralsib', name: 'Уралсиб', match: /уралсиб|uralsib/i, bank: true },
  { key: 'mkb', name: 'МКБ', match: /\bмкб\b|\bmkb\b|московский кредитный/i, bank: true },
  { key: 'zenit', name: 'Банк Зенит', match: /зенит|zenit/i, bank: true },
  { key: 'rsb', name: 'Русский Стандарт', match: /русский стандарт|rsb\b|russian standard/i, bank: true },
  { key: 'renaissance', name: 'Ренессанс Банк', match: /ренессанс|renaissance|rencredit/i, bank: true },
  { key: 'homebank', name: 'Хоум Банк', match: /хоум|home.?bank|home.?credit|хкф/i, bank: true },
  { key: 'sinara', name: 'Банк Синара', match: /синара|sinara|скб.?банк/i, bank: true },
  { key: 'tochka', name: 'Точка', match: /точка|tochka/i, bank: true },
  { key: 'lokobank', name: 'Локо-Банк', match: /локо|locko|loko/i, bank: true },
  { key: 'bspb', name: 'Банк Санкт-Петербург', match: /банк санкт-петербург|bspb/i, bank: true },
  { key: 'otp', name: 'ОТП Банк', match: /отп.?банк|otp.?bank|otpbank/i, bank: true },
  { key: 'unicredit', name: 'ЮниКредит', match: /юникредит|unicredit/i, bank: true },
  { key: 'mir', name: 'Mir Pay', match: /mir.?pay|мир.?pay/i, bank: true },
  // Транспорт, сервисы, соцсети — то, что тоже часто просят вернуть
  { key: 'aeroflot', name: 'Аэрофлот', match: /аэрофлот|aeroflot/i },
  { key: 's7', name: 'S7 Airlines', match: /\bs7\b|сибирь/i },
  { key: 'pobeda', name: 'Победа', match: /победа|pobeda/i },
  { key: 'utair', name: 'Utair', match: /utair|ютэйр|ютейр/i },
  { key: 'rzd', name: 'РЖД', match: /\bржд\b|\brzd\b/i },
  { key: 'vkvideo', name: 'VK Видео', match: /vk.?видео|vk.?video/i },
  { key: 'vk', name: 'ВКонтакте', match: /вконтакте|^vk\b|com\.vk\./i },
  { key: 'max', name: 'MAX', match: /^max\b|мессенджер max/i },
  { key: 'wb', name: 'Wildberries', match: /wildberries|вайлдберриз|\bwb\b/i },
  { key: 'ozon', name: 'Ozon', match: /ozon|озон/i },
  { key: 'avito', name: 'Авито', match: /авито|avito/i },
  { key: 'gosuslugi', name: 'Госуслуги', match: /госуслуг|gosuslug/i },
  { key: 'kinopoisk', name: 'Кинопоиск', match: /кинопоиск|kinopoisk/i },
  { key: 'yandex', name: 'Яндекс', match: /яндекс|yandex/i },
  { key: '2gis', name: '2ГИС', match: /2гис|2gis/i },
  { key: 'ivi', name: 'Иви', match: /\bиви\b|\bivi\b/i },
  { key: 'okko', name: 'Okko', match: /okko|окко/i },
  { key: 'kion', name: 'KION', match: /kion|кион/i },
  { key: 'megafon', name: 'МегаФон', match: /мегафон|megafon/i },
  { key: 'beeline', name: 'билайн', match: /билайн|beeline/i },
  { key: 'tele2', name: 't2', match: /tele2|теле2|\bt2\b/i },
  { key: 'mts', name: 'МТС', match: /\bмтс\b|\bmts\b/i },
  { key: 'dodo', name: 'Додо Пицца', match: /додо|dodo/i },
  { key: 'samokat', name: 'Самокат', match: /самокат|samokat/i },
  { key: 'lamoda', name: 'Lamoda', match: /lamoda|ламода/i },
  { key: 'dns', name: 'DNS', match: /\bdns\b|днс/i },
  { key: 'mvideo', name: 'М.Видео', match: /м\.?видео|mvideo/i },
  { key: 'cdek', name: 'СДЭК', match: /сдэк|cdek/i },
  { key: 'pochta', name: 'Почта России', match: /почта россии|russian post|pochta\.ru/i },
  { key: 'delimobil', name: 'Делимобиль', match: /делимобиль|delimobil/i },
  { key: 'citydrive', name: 'Ситидрайв', match: /ситидрайв|citydrive/i },
]

/** Ключи, для которых лежит файл public/app-icons/<key>.png */
export const AVAILABLE_ICONS = new Set<string>(APP_CATALOG.map(e => e.key).filter(k => !['mir'].includes(k)))

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
  const name = entry?.name || p.name || p.bundle_id
  const catalogIcon = entry && AVAILABLE_ICONS.has(entry.key) ? `/app-icons/${entry.key}.png` : null
  const bank = Boolean(entry?.bank) || p.genre === 'Finance' || /банк|bank/i.test(p.name)
  let h = 0
  for (const ch of p.bundle_id || name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return { name, icon: p.icon || catalogIcon, bank, letter: (name.trim()[0] || '?').toUpperCase(), hue: h % 360 }
}
