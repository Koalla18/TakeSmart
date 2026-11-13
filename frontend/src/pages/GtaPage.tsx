import { useCallback, useEffect, useMemo, useRef, useState, type ImgHTMLAttributes, type ReactNode } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { ProductCardSkeleton } from '../components/ProductCard'
import { useCart } from '../lib/cart'
import { ymReachGoal } from '../lib/metrika'
import { Gta6Celebration } from '../components/Gta6Celebration'
import { API_BASE_URL } from '../lib/config'
import {
  GTA6_DEFAULT_GIFT_TEXT, GTA6_DEFAULT_GIFT_TEXT_RELEASED, GTA6_DEFAULT_GIFT_TITLE, GTA6_RELEASE, GTA6_RELEASE_LABEL, GTA6_RELEASE_SIMULATED,
  GTA6_TRAILERS, fetchGta6Page, gta6Asset, isGta6Released, parseVideoUrl, timeToRelease, youtubeEmbed,
  type Gta6Page, type Gta6Slot, type Gta6Video,
} from '../lib/gta6'
import { formatPrice, mapApiProduct, type Product } from '../data/products'

// ─────────────────────────────────────────────────────────────────────────────
// /gta6 — лендинг к выходу Grand Theft Auto VI в духе официальной страницы игры:
// тёмный фон, крупные официальные арты и скриншоты, строгая типографика.
// Обложка → баннер с подарком → сюжет → герои → окружение → регионы → кадры →
// подборка PlayStation 5. Подборка, тексты подарка и замена картинок — в админке
// (раздел «GTA VI»); стандартные арты лежат в public/gta6-art.
// Пока страница выключена, она открывается только по ссылке с ?preview=1.
// ─────────────────────────────────────────────────────────────────────────────

interface ApiCategory { id: string; name: string; slug: string }

const BG = '#11111d'
const PINK_BTN = 'inline-flex items-center justify-center rounded-full bg-[#ffb0c4] px-7 py-3.5 text-sm font-bold text-[#11111d] transition-colors duration-300 hover:bg-white sm:text-base'
const GHOST_BTN = 'inline-flex items-center justify-center rounded-full border border-white/30 px-7 py-3.5 text-sm font-bold text-white transition-colors hover:bg-white hover:text-[#11111d] sm:text-base'
const EYEBROW = 'text-[11px] font-bold uppercase tracking-[0.22em] text-white/60 sm:text-xs'
const H2 = 'text-3xl font-black uppercase leading-[1.02] tracking-tight text-white sm:text-5xl lg:text-6xl'

const HEROES: { slot: Gta6Slot; name: string; role: string; text: string }[] = [
  {
    slot: 'jason', name: 'Джейсон Дюваль', role: 'Хочет лёгкой жизни',
    text: 'Вырос среди мошенников и мелких воров, отслужил в армии и осел на островах Кис — работает на местных контрабандистов. Давно пора что-то менять, но повода всё не было. Пока он не встретил Лусию.',
  },
  {
    slot: 'lucia', name: 'Лусия Каминос', role: 'Играет только наверняка',
    text: 'Драться её научил отец — едва она встала на ноги. Только что вышла из тюрьмы штата Леонида и возвращаться туда не намерена. Ради семьи и мечты о другой жизни она готова на всё.',
  },
]

const CAST: { img: string; name: string; text: string }[] = [
  { img: 'cal', name: 'Кэл Хэмптон', text: 'Друг Джейсона и напарник по работе на Брайана. Дома, с пивом и рацией береговой охраны, ему спокойнее, чем где-либо.' },
  { img: 'boobie', name: 'Буби Айк', text: 'Легенда Вайс-Сити: превратил уличные деньги в легальную империю — недвижимость, клуб, студия звукозаписи.' },
  { img: 'drequan', name: 'Дре’Куан Прист', text: 'Раньше торговал на улицах, теперь делает музыку. Его лейбл Only Raw Records ищет следующий большой хит.' },
  { img: 'dimez', name: 'Real Dimez', text: 'Бэ-Лус и Рокси дружат со школы. Вирусные треки и дерзость вывели дуэт из подворотен в чарты.' },
  { img: 'raul', name: 'Рауль Баутиста', text: 'Опытный грабитель банков: обаяние, уверенность и вечный поиск людей для дел покрупнее.' },
  { img: 'brian', name: 'Брайан Хедер', text: 'Контрабандист старой школы с островов Кис. Держит лодочную мастерскую и сдаёт Джейсону жильё.' },
]

const PLACES: { slot: Gta6Slot; name: string; text: string }[] = [
  { slot: 'vice_city', name: 'Вайс-Сити', text: 'Столица солнца и греха: ар-деко отели у океана, шумные рынки, порт, небоскрёбы и ночная жизнь без выходных.' },
  { slot: 'keys', name: 'Леонида-Кис', text: 'Цепочка тропических островов на юге штата. Бары у воды, яхты, бирюзовое мелководье — и контрабанда под носом у туристов.' },
  { slot: 'grassrivers', name: 'Грассриверс', text: 'Дикое сердце Леониды: мангры, аэролодки и аллигаторы. Сюда едут за экзотикой, а остаются те, кому есть что прятать.' },
  { slot: 'port_gellhorn', name: 'Порт-Геллхорн', text: 'Бывший курорт: дешёвые мотели, закрытые аттракционы, пустые торговые центры — и своя экономика со своими правилами.' },
  { slot: 'ambrosia', name: 'Амброзия', text: 'Промышленный пояс: сахарный завод кормит весь город, а порядок на дорогах держит местный байкерский клуб.' },
  { slot: 'kalaga', name: 'Гора Калага', text: 'Национальный парк на севере: леса, охота, рыбалка и трассы для внедорожников. В глуши живут те, кто не рад гостям.' },
]

const SHOTS = ['shot-1', 'shot-2', 'shot-3', 'shot-4', 'shot-5', 'shot-6']

const faq = (released: boolean): { q: string; a: string }[] => [
  released
    ? { q: 'GTA VI уже вышла?', a: `Да, игра вышла ${GTA6_RELEASE_LABEL} года и уже доступна на консолях.` }
    : { q: 'Когда выходит GTA VI?', a: `${GTA6_RELEASE_LABEL} года. Предзагрузка игры на консолях уже открыта.` },
  { q: 'На чём можно играть?', a: 'Игра вышла на PlayStation 5 и Xbox Series X|S. Версия для ПК на момент релиза не анонсирована.' },
  { q: 'Какая PlayStation 5 подойдёт?', a: 'Любая: PS5 Slim с дисководом или без, а также PS5 Pro. На Pro картинка чётче и плавнее, но игра идёт на всех моделях.' },
  { q: 'Как получить игру в подарок?', a: 'Выберите консоль из подборки на этой странице и оформите заявку. Менеджер подтвердит заказ и расскажет, когда и в каком виде вы получите игру.' },
  { q: 'Можно ли оформить в рассрочку или сдать старую технику?', a: 'Да. Рассрочка и Trade-in работают так же, как для остальных товаров магазина — детали уточнит менеджер.' },
]

/**
 * Картинка, которая мягко проявляется, когда загрузилась, — вместо резкого
 * «выскакивания» на тёмном фоне. Переход по transform оставлен для наведения.
 */
function FadeImg({ style, onLoad, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  // Прозрачность меняется прямо на элементе, без состояния: картинка из кэша бывает
  // готова ещё до того, как сработает onLoad, и её нужно показать сразу.
  const show = (el: HTMLImageElement) => { el.style.opacity = '1' }
  return (
    <img
      {...props}
      ref={el => { if (el?.complete) show(el) }}
      onLoad={e => { show(e.currentTarget); onLoad?.(e) }}
      onError={e => show(e.currentTarget)}
      style={{ ...style, opacity: 0, transition: 'opacity 900ms ease, transform 1400ms cubic-bezier(0.16, 1, 0.3, 1)' }}
    />
  )
}

/**
 * Плавное появление блока при прокрутке. Видимость проверяется и наблюдателем, и
 * обычным замером на scroll: если наблюдатель по какой-то причине промолчит,
 * блок всё равно не останется невидимым.
 */
function Reveal({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let done = false
    const cleanups: Array<() => void> = []
    const show = () => {
      if (done) return
      done = true
      setShown(true)
      cleanups.forEach(fn => fn())
    }
    const check = () => {
      const rect = el.getBoundingClientRect()
      if (rect.top < window.innerHeight * 0.96 && rect.bottom > 0) show()
    }
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    cleanups.push(() => { window.removeEventListener('scroll', check); window.removeEventListener('resize', check) })
    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) show() }, { threshold: 0.05 })
      io.observe(el)
      cleanups.push(() => io.disconnect())
    }
    const first = window.setTimeout(check, 0)
    cleanups.push(() => window.clearTimeout(first))
    return () => { done = true; cleanups.forEach(fn => fn()) }
  }, [])
  return (
    <div
      ref={ref}
      style={{ transitionDelay: `${delay}ms` }}
      className={`transition-all duration-[1300ms] ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${shown ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0 motion-reduce:translate-y-0 motion-reduce:opacity-100'} ${className}`}
    >
      {children}
    </div>
  )
}

function Countdown() {
  const [left, setLeft] = useState(() => timeToRelease())
  useEffect(() => {
    const id = window.setInterval(() => setLeft(timeToRelease()), 1000)
    return () => window.clearInterval(id)
  }, [])
  if (!left) {
    // Таймер дошёл до нуля: вместо цифр — «уже вышла» с мерцающими искрами
    return (
      <div className="gta-rise relative inline-flex items-center gap-2.5 rounded-full bg-white px-5 py-2.5 text-sm font-black uppercase tracking-[0.14em] text-[#11111d]" data-gta6-released>
        <span className="gta-twinkle text-base leading-none text-[#ff5f96]" aria-hidden="true">✦</span>
        Уже вышла
        <span className="gta-twinkle text-base leading-none text-[#ff5f96] [animation-delay:0.7s]" aria-hidden="true">✦</span>
        <span className="gta-twinkle absolute -right-1 -top-2 text-xs text-[#ffd27a] [animation-delay:0.35s]" aria-hidden="true">✦</span>
        <span className="gta-twinkle absolute -bottom-2 left-3 text-[10px] text-[#c9a7f5] [animation-delay:1.1s]" aria-hidden="true">✦</span>
      </div>
    )
  }
  const cells: [number, string][] = [[left.days, 'дн'], [left.hours, 'ч'], [left.minutes, 'мин'], [left.seconds, 'сек']]
  // В последнюю минуту цифры розовеют — финал близко
  const final = left.days === 0 && left.hours === 0 && left.minutes === 0
  return (
    <div className="flex items-baseline gap-3 sm:gap-4" role="timer" aria-label={`До выхода: ${left.days} дн. ${left.hours} ч.`} data-gta6-countdown>
      {cells.map(([value, label]) => (
        <div key={label} className="flex items-baseline gap-1">
          <span className={`text-2xl font-black tabular-nums transition-colors duration-700 sm:text-3xl ${final ? 'text-[#ffb0c4]' : 'text-white'}`}>{String(value).padStart(2, '0')}</span>
          <span className="text-[11px] font-semibold uppercase tracking-wider text-white/50">{label}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * Полоса покупки: прилипает под шапкой сайта и остаётся на экране, пока листаешь.
 * Фон — небо с пальмами и закатом из официального арта (public/gta6-art/strip.webp).
 */
function BuyBar({ gift, minPrice, released }: { gift: boolean; minPrice: number | null; released: boolean }) {
  const [left, setLeft] = useState(() => timeToRelease())
  useEffect(() => {
    const id = window.setInterval(() => setLeft(timeToRelease()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  const release = left && !released
    ? `До релиза ${left.days > 0 ? `${left.days} дн ` : ''}${left.hours} ч${left.days === 0 ? ` ${left.minutes} мин` : ''}`
    : 'Игра уже вышла'
  return (
    <div className="gta-drop sticky top-16 z-30 overflow-hidden bg-[#c48fc4] text-[#11111d] shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)] lg:top-20" data-gta6-buybar>
      <img src={gta6Asset('strip')} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover object-right" />
      <div className="relative mx-auto flex max-w-7xl items-center gap-3 px-4 py-2 sm:gap-4 sm:px-6 sm:py-2.5 lg:px-8">
        {gift && (
          <img src={gta6Asset('cover')} alt="" aria-hidden="true"
            className="hidden h-12 w-auto -rotate-6 rounded-[3px] shadow-[0_4px_14px_rgba(17,17,29,0.45)] ring-1 ring-white/80 sm:block" />
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-black uppercase leading-tight sm:text-base sm:tracking-wide">
            <span className="sm:hidden">PS5</span><span className="hidden sm:inline">PlayStation 5</span>{gift && ' + GTA VI в подарок'}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[#11111d]/70 sm:text-xs">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#11111d]" />
            {release}
          </div>
        </div>
        <a href="#ps5" onClick={() => ymReachGoal('gta6_buybar')} className="group flex flex-shrink-0 items-center gap-2 rounded-full bg-[#11111d] px-3.5 py-2 text-xs font-bold sm:pr-3 text-white transition-colors hover:bg-white hover:text-[#11111d] sm:py-2.5 sm:pl-5 sm:text-sm">
          <span>Купить<span className="hidden sm:inline"> консоль</span></span>
          {minPrice != null && <span className="text-[#ffb0c4] group-hover:text-[#11111d]/60">от {minPrice.toLocaleString('ru-RU')} ₽</span>}
          <svg className="hidden h-4 w-4 transition-transform group-hover:translate-x-0.5 sm:block" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" /></svg>
        </a>
      </div>
    </div>
  )
}

/** Кнопка-кружок «смотреть» поверх постера ролика */
function PlayBadge({ small = false }: { small?: boolean }) {
  return (
    <span className={`flex items-center justify-center rounded-full bg-white text-[#11111d] shadow-xl transition-transform duration-300 group-hover:scale-110 ${small ? 'h-12 w-12' : 'h-16 w-16 sm:h-20 sm:w-20'}`}>
      <svg className={small ? 'ml-0.5 h-5 w-5' : 'ml-1 h-7 w-7 sm:h-8 sm:w-8'} viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.5-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" /></svg>
    </span>
  )
}

/** Плеер поверх страницы: закрывается крестиком, кликом мимо и Esc */
function VideoModal({ video, title, onClose }: { video: Gta6Video; title: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => { document.body.style.overflow = prevOverflow; window.removeEventListener('keydown', onKey) }
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={title} data-gta6-player
      className="gta-fade fixed inset-0 z-[70] flex items-center justify-center bg-[#0a0a12]/95 p-3 sm:p-8"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="gta-pop w-full max-w-[min(72rem,calc((100svh-9rem)*16/9))]">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div className="text-sm font-bold uppercase tracking-[0.18em] text-white/80">{title}</div>
          <button type="button" onClick={onClose} aria-label="Закрыть" className="flex h-10 w-10 items-center justify-center rounded-full border border-white/25 text-white transition-colors hover:bg-white hover:text-[#11111d]">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </div>
        <div className="aspect-video overflow-hidden rounded-xl bg-black sm:rounded-2xl">
          {video.kind === 'file'
            ? <video src={video.src} controls autoPlay playsInline className="h-full w-full" />
            : <iframe src={video.src} title={title} allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen referrerPolicy="strict-origin-when-cross-origin" className="h-full w-full border-0" />}
        </div>
      </div>
    </div>
  )
}

/**
 * Карточка консоли в оформлении раздела: тёмная, фото на светлой панели со скошенным
 * краем (как панели на обложке игры), поверх — коробка GTA VI в подарок.
 * Вся карточка — ссылка на страницу товара (ссылка заголовка растянута на неё),
 * кнопки покупки лежат поверх и работают сами по себе.
 */
function ConsoleCard({ product, gift }: { product: Product; gift: boolean }) {
  const navigate = useNavigate()
  const { addItem, isInCart } = useCart()
  const inCart = isInCart(product.id)
  const available = product.inStock
  const discount = product.oldPrice ? Math.round((1 - product.price / product.oldPrice) * 100) : 0
  const status = product.preorder ? (product.preorderNote || 'Предзаказ') : available ? 'В наличии' : 'Нет в наличии'

  return (
    <article className="group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-3xl bg-[#1c1c2e] ring-1 ring-white/10 transition-all duration-500 ease-out hover:-translate-y-1 hover:ring-[#ffb0c4]/60" data-gta6-product={product.id}>
      <Link to={`/product/${product.slug}`} className="relative block" tabIndex={-1} aria-hidden="true">
        <div className="bg-white [clip-path:polygon(0_0,100%_0,100%_88%,0_100%)]">
          {product.image
            ? <FadeImg src={product.image} alt={product.name} loading="lazy" className="aspect-[4/3] w-full object-contain p-6 pb-10 transition-transform duration-500 group-hover:scale-105 sm:p-8 sm:pb-12" />
            : <div className="aspect-[4/3] w-full" />}
        </div>
        {discount > 0 && <span className="absolute left-4 top-4 rounded-full bg-[#11111d] px-2.5 py-1 text-xs font-bold text-white">−{discount}%</span>}
        {gift && (
          <img src={gta6Asset('cover')} alt="Grand Theft Auto VI" loading="lazy"
            className="absolute -bottom-3 right-4 w-[22%] min-w-[54px] rotate-6 rounded-md shadow-[0_10px_30px_rgba(0,0,0,0.55)] ring-2 ring-white transition-transform duration-300 group-hover:rotate-3 group-hover:scale-105" />
        )}
      </Link>

      <div className="flex flex-1 flex-col p-4 sm:p-6">
        {gift && (
          <div className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-[#ffb0c4] px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[#11111d]" data-gta6-gift-badge>
            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4}><path strokeLinecap="round" strokeLinejoin="round" d="M20 12v9H4v-9M2 7h20v5H2zM12 22V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z" /></svg>
            GTA VI в подарок
          </div>
        )}
        <Link to={`/product/${product.slug}`} className="text-base font-bold leading-snug text-white transition-colors after:absolute after:inset-0 after:content-[''] group-hover:text-[#ffb0c4] sm:text-lg">
          {product.name}
        </Link>
        <div className="mt-2 flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-wider">
          <span className={available ? 'text-white/55' : 'text-white/35'}>{status}</span>
          <span className="inline-flex items-center gap-1 text-[#ffb0c4]">
            Подробнее
            <svg className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14m-6-6 6 6-6 6" /></svg>
          </span>
        </div>

        <div className="mt-auto pt-5">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <span className="text-2xl font-black tabular-nums text-white sm:text-3xl">{formatPrice(product.price)}</span>
            {product.oldPrice && <span className="text-sm text-white/40 line-through">{formatPrice(product.oldPrice)}</span>}
          </div>
          {gift && <div className="mt-1 text-sm text-white/60">+ Grand Theft Auto VI — <span className="font-bold text-[#ffb0c4]">0 ₽</span></div>}

          <div className="relative z-10 mt-4 grid gap-2">
            {inCart ? (
              <Link to="/cart" className="inline-flex items-center justify-center rounded-full bg-white px-5 py-3 text-sm font-bold text-[#11111d] transition-colors hover:bg-[#ffb0c4]">В корзине — оформить</Link>
            ) : (
              <button type="button" disabled={!available} onClick={() => { ymReachGoal('gta6_buy', { id: product.id, name: product.name, price: product.price }); if (addItem(product, 1)) navigate('/cart') }}
                className="inline-flex items-center justify-center rounded-full bg-[#ffb0c4] px-5 py-3 text-sm font-bold text-[#11111d] transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/40" data-gta6-buy>
                {product.preorder ? 'Оформить предзаказ' : 'Купить'}
              </button>
            )}
            {!inCart && available && (
              <button type="button" onClick={() => { ymReachGoal('gta6_add_to_cart', { id: product.id, name: product.name, price: product.price }); addItem(product, 1) }} className="inline-flex items-center justify-center rounded-full border border-white/25 px-5 py-3 text-sm font-bold text-white transition-colors hover:bg-white hover:text-[#11111d]">
                В корзину
              </button>
            )}
          </div>
        </div>
      </div>
    </article>
  )
}

/** Карусель карточек: на телефоне листается пальцем, на десктопе — ещё и стрелками */
function Rail({ children, label }: { children: ReactNode; label: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = (dir: -1 | 1) => {
    const el = ref.current
    if (el) el.scrollBy({ left: dir * Math.max(320, el.clientWidth * 0.7), behavior: 'smooth' })
  }
  const arrow = 'hidden h-11 w-11 items-center justify-center rounded-full border border-white/25 text-white transition-colors hover:bg-white hover:text-[#11111d] sm:flex'
  return (
    <div>
      <div className="mx-auto mb-5 flex max-w-7xl justify-end gap-2 px-4 sm:px-6 lg:px-8">
        <button type="button" onClick={() => scroll(-1)} aria-label={`${label}: назад`} className={arrow}>
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m15 6-6 6 6 6" /></svg>
        </button>
        <button type="button" onClick={() => scroll(1)} aria-label={`${label}: вперёд`} className={arrow}>
          <svg className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="m9 6 6 6-6 6" /></svg>
        </button>
      </div>
      <div ref={ref} className="scrollbar-hide flex snap-x snap-mandatory scroll-px-4 gap-4 overflow-x-auto px-4 sm:scroll-px-6 sm:gap-5 sm:px-6 lg:scroll-px-[max(2rem,calc((100vw-80rem)/2+2rem))] lg:px-[max(2rem,calc((100vw-80rem)/2+2rem))]">
        {children}
      </div>
    </div>
  )
}

const RELEASE_SEEN_KEY = 'gta6_release_seen'
function releaseSeen(): boolean {
  if (GTA6_RELEASE_SIMULATED) return false
  try { return localStorage.getItem(RELEASE_SEEN_KEY) === '1' } catch { return true }
}
function markReleaseSeen(): void {
  // Проверочный просмотр финала не должен «съесть» настоящий праздник в день релиза
  if (GTA6_RELEASE_SIMULATED) return
  try { localStorage.setItem(RELEASE_SEEN_KEY, '1') } catch { /* приватный режим — покажем ещё раз, не страшно */ }
}

export function GtaPage() {
  const [params] = useSearchParams()
  const preview = params.get('preview') === '1'
  const [page, setPage] = useState<Gta6Page | null>(null)
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  // Выход игры: страница сама переключается в «уже вышла», а в момент нуля на таймере
  // (или при первом заходе после релиза) показывает праздничный финал с блёстками.
  const [released, setReleased] = useState(() => isGta6Released())
  const [celebrate, setCelebrate] = useState(() => isGta6Released() && !releaseSeen())
  const endCelebration = useCallback(() => setCelebrate(false), [])
  useEffect(() => {
    if (released) { markReleaseSeen(); return }
    // setTimeout не умеет ждать дольше ~24 суток — для дальней даты просто не ставим
    const wait = GTA6_RELEASE.getTime() - Date.now()
    if (wait > 2_000_000_000) return
    const id = window.setTimeout(() => { setReleased(true); setCelebrate(true) }, Math.max(0, wait))
    return () => window.clearTimeout(id)
  }, [released])

  // Кнопки «Купить консоль», «Об игре» ведут к блокам на этой же странице — едем плавно
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return
    const root = document.documentElement
    const prev = root.style.scrollBehavior
    root.style.scrollBehavior = 'smooth'
    return () => { root.style.scrollBehavior = prev }
  }, [])


  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetchGta6Page(),
      fetch(`${API_BASE_URL}/api/categories?limit=100`)
        .then(res => (res.ok ? res.json() : []))
        .then((data: { items?: ApiCategory[] } | ApiCategory[]) => (Array.isArray(data) ? data : data.items ?? []))
        .catch(() => [] as ApiCategory[]),
    ]).then(([data, cats]) => {
      if (cancelled) return
      const catMap = new Map(cats.map(c => [c.id, c]))
      setPage(data)
      setProducts((data?.products ?? []).map(p => {
        const cat = p.category_id ? catMap.get(p.category_id) : undefined
        return mapApiProduct(p, cat?.slug ?? '', cat?.name ?? '')
      }))
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const minPrice = useMemo(() => (products.length ? Math.min(...products.map(p => p.price)) : null), [products])
  const custom = page?.images ?? {}
  /** Картинка блока: своя из админки или стандартный арт */
  const art = (slot: Gta6Slot) => custom[slot] || gta6Asset(slot)
  const gift = page?.gift_enabled ?? true
  const giftTitle = page?.gift_title || GTA6_DEFAULT_GIFT_TITLE
  const giftText = page?.gift_text || (released ? GTA6_DEFAULT_GIFT_TEXT_RELEASED : GTA6_DEFAULT_GIFT_TEXT)

  // Ролики: свой главный из админки (если ссылку распознали) + официальные трейлеры
  const [playing, setPlaying] = useState<{ video: Gta6Video; title: string } | null>(null)
  const ownVideo = page?.trailer_url ? parseVideoUrl(page.trailer_url) : null
  const videos = useMemo(() => {
    const official = GTA6_TRAILERS.map(t => ({ title: t.title, poster: t.poster, video: youtubeEmbed(t.id) }))
    return ownVideo ? [{ title: 'Трейлер', poster: 'trailer-1', video: ownVideo }, ...official.slice(1)] : official
  }, [ownVideo])

  // Страница выключена в админке (или API недоступен) — покупателю показывать нечего
  if (!loading && (!page || !page.enabled) && !preview) return <Navigate to="/" replace />

  return (
    <div className="text-white" style={{ background: BG }} data-gta6-page>
      {preview && page && !page.enabled && (
        <div className="bg-yellow-400 px-4 py-2 text-center text-sm font-semibold text-gray-900" data-gta6-preview>
          Черновик: покупатели эту страницу пока не видят. Включите её в админке → «GTA VI».
        </div>
      )}

      <BuyBar gift={gift} minPrice={minPrice} released={released} />

      {/* ── 1. Обложка ──────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-7xl px-4 pb-10 pt-6 sm:px-6 sm:pb-14 sm:pt-10 lg:px-8">
        <h1 className="sr-only">Grand Theft Auto VI — {released ? 'вышла' : 'выходит'} {GTA6_RELEASE_LABEL} года</h1>
        <div className="gta-rise overflow-hidden rounded-2xl sm:mx-auto sm:max-w-[max(36rem,calc((100svh-19rem)*16/9))] sm:rounded-3xl">
          <picture>
            {!custom.hero && <source media="(max-width: 639px)" srcSet={gta6Asset('hero-m')} />}
            <FadeImg src={art('hero')} alt="Grand Theft Auto VI" fetchPriority="high" className="aspect-[9/16] w-full object-cover sm:aspect-video" />
          </picture>
        </div>
        <div className="gta-rise mt-6 grid items-center gap-6 [animation-delay:150ms] sm:mt-8 lg:grid-cols-[1fr_auto_1fr]">
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.18em] text-white/60">{released ? 'В продаже с' : 'Выходит'}</div>
            <div className="mt-1 text-xl font-black uppercase tracking-tight sm:text-2xl">{GTA6_RELEASE_LABEL} года</div>
          </div>
          <a href="#ps5" className={PINK_BTN}>
            Выбрать PlayStation 5{minPrice != null && <span className="ml-2 font-semibold opacity-60">от {minPrice.toLocaleString('ru-RU')} ₽</span>}
          </a>
          <div className="lg:justify-self-end"><Countdown /></div>
        </div>
      </section>

      {/* ── 2. Баннер с предложением ────────────────────────────────────── */}
      <section className="relative isolate flex min-h-[86svh] flex-col overflow-hidden sm:min-h-[92svh]">
        <picture>
          {!custom.promo && <source media="(max-width: 639px)" srcSet={gta6Asset('promo-m')} />}
          <FadeImg src={art('promo')} alt="" loading="lazy" className="absolute inset-0 -z-10 h-full w-full object-cover object-[62%_50%] sm:object-center" />
        </picture>
        <div className="absolute inset-x-0 top-0 -z-10 h-1/2 bg-gradient-to-b from-[#11111d] via-[#11111d]/50 to-transparent sm:h-1/4 sm:via-[#11111d]/20" />
        <div className="absolute inset-y-0 left-0 -z-10 hidden w-2/3 bg-gradient-to-r from-[#11111d]/90 via-[#11111d]/45 to-transparent sm:block" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-1/3 bg-gradient-to-t from-[#11111d] to-transparent" />
        {/* Телефон: заголовок в небе над героями, кнопка внизу. Десктоп: текст слева, на фоне города */}
        <div className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 pt-14 text-center sm:justify-center sm:px-6 sm:pt-0 sm:text-left lg:px-8">
          <Reveal>
            <div className="text-xs font-bold uppercase tracking-[0.22em] text-white/80">{gift ? 'Только в TakeSmart' : released ? 'Играйте уже сегодня' : 'Играйте в день релиза'}</div>
            <h2 className="mt-3 text-4xl font-black uppercase leading-[1] tracking-tight sm:text-6xl lg:text-7xl" data-gta6-promo-title>
              {gift ? <>GTA VI<br />в подарок<br className="hidden sm:block" /> к PlayStation 5</> : <>GTA VI на<br />PlayStation 5</>}
            </h2>
            <p className="mt-5 hidden max-w-md text-lg text-white/85 sm:block">
              {gift ? `Покупаете консоль в TakeSmart — игру получаете от нас. ${released ? 'Игра уже вышла, отдаём сразу.' : 'Встречайте релиз в первый день.'}` : `Консоли в наличии и под заказ. ${released ? 'Игра уже вышла.' : 'Встречайте релиз в первый день.'}`}
            </p>
          </Reveal>
          <div className="mt-auto flex justify-center pb-12 sm:mt-8 sm:justify-start sm:pb-0">
            <a href="#ps5" className={PINK_BTN}>Смотреть консоли</a>
          </div>
        </div>
      </section>

      {/* ── 2а. Трейлеры ────────────────────────────────────────────────── */}
      <section className="px-4 pt-16 sm:px-6 sm:pt-24 lg:px-8" data-gta6-trailers>
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <div className={EYEBROW}>Видео</div>
            <h2 className={`${H2} mt-3`}>Смотрите трейлеры</h2>
          </Reveal>
          <div className="mt-8 grid gap-4 lg:grid-cols-[2fr_1fr] lg:gap-5">
            {videos.map((item, i) => (
              <Reveal key={item.title} delay={i * 80} className={i === 0 ? 'lg:row-span-2' : ''}>
                <button type="button" onClick={() => { ymReachGoal('gta6_trailer', { title: item.title }); setPlaying({ video: item.video, title: `Grand Theft Auto VI — ${item.title}` }) }}
                  className="group relative block h-full w-full overflow-hidden rounded-2xl text-left sm:rounded-3xl" data-gta6-trailer>
                  <FadeImg src={gta6Asset(item.poster)} alt="" loading="lazy" className={`w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.04] ${i === 0 ? 'aspect-video h-full' : 'aspect-video lg:aspect-auto lg:h-full'}`} />
                  <div className="absolute inset-0 bg-gradient-to-t from-[#11111d]/90 via-[#11111d]/10 to-transparent" />
                  {i === 0 && <div className="absolute inset-0 flex items-center justify-center"><PlayBadge /></div>}
                  <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-5 sm:p-7">
                    <div>
                      <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/75">Посмотреть</div>
                      <div className={`mt-1 font-black uppercase leading-none tracking-tight ${i === 0 ? 'text-2xl sm:text-4xl' : 'text-xl sm:text-2xl'}`}>{item.title}</div>
                    </div>
                    {i !== 0 && <PlayBadge small />}
                  </div>
                </button>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3. Сюжет ────────────────────────────────────────────────────── */}
      <section id="story" className="scroll-mt-32 lg:scroll-mt-36 px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
        <div className="mx-auto grid max-w-7xl items-center gap-8 lg:grid-cols-[5fr_7fr] lg:gap-14">
          <Reveal>
            <h2 className={H2}>Вайс-Сити, США.</h2>
            <p className="mt-6 text-lg leading-relaxed text-white/80">
              Джейсон и Лусия привыкли, что расклад всегда не в их пользу. Одно простое дело
              должно было всё изменить — но пошло не так, и теперь оба втянуты в заговор, который
              тянется через весь штат Леонида.
            </p>
            <p className="mt-4 text-lg leading-relaxed text-white/80">
              В самом солнечном месте Америки у них остаётся один способ выбраться:
              доверять друг другу больше, чем когда-либо.
            </p>
          </Reveal>
          <Reveal delay={100}>
            <FadeImg src={art('story')} alt="Джейсон и Лусия" loading="lazy" className="aspect-video w-full rounded-2xl object-cover sm:rounded-3xl" />
          </Reveal>
        </div>
      </section>

      {/* ── 4. Герои ────────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 sm:px-6 sm:pb-24 lg:px-8">
        <div className="mx-auto grid max-w-7xl gap-5 md:grid-cols-2 lg:gap-6">
          {HEROES.map((hero, i) => (
            <Reveal key={hero.slot} delay={i * 120}>
              <article className="group h-full overflow-hidden rounded-2xl bg-white/[0.05] sm:rounded-3xl">
                <div className="overflow-hidden">
                  <FadeImg src={art(hero.slot)} alt={hero.name} loading="lazy" className="aspect-video w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.04]" />
                </div>
                <div className="p-6 sm:p-8">
                  <div className={EYEBROW}>{hero.role}</div>
                  <h3 className="mt-2 text-3xl font-black uppercase leading-none tracking-tight sm:text-4xl">{hero.name}</h3>
                  <p className="mt-4 text-base leading-relaxed text-white/75">{hero.text}</p>
                </div>
              </article>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── 5. Окружение ────────────────────────────────────────────────── */}
      <section className="pb-16 sm:pb-24">
        <Reveal className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className={EYEBROW}>Люди</div>
          <h2 className={`${H2} mt-3`}>Те, с кем придётся иметь дело</h2>
        </Reveal>
        <Reveal delay={100} className="mt-2 sm:-mt-6">
          <Rail label="Персонажи">
            {CAST.map(person => (
              <article key={person.img} className="group relative w-[68vw] flex-shrink-0 snap-start overflow-hidden rounded-2xl sm:w-[300px]" data-gta6-cast>
                <FadeImg src={gta6Asset(person.img)} alt={person.name} loading="lazy" className="aspect-[9/16] w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.04]" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#11111d] via-[#11111d]/85 to-transparent p-5 pt-20">
                  <h3 className="text-xl font-black uppercase leading-none tracking-tight">{person.name}</h3>
                  <p className="mt-2 text-sm leading-snug text-white/75">{person.text}</p>
                </div>
              </article>
            ))}
          </Rail>
        </Reveal>
      </section>

      {/* ── 6. Места ────────────────────────────────────────────────────── */}
      <section className="pb-16 sm:pb-24">
        <Reveal className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className={EYEBROW}>Места</div>
          <h2 className={`${H2} mt-3`}>Только в Леониде</h2>
        </Reveal>
        <Reveal delay={100} className="mt-2 sm:-mt-6">
          <Rail label="Регионы">
            {PLACES.map(place => (
              <article key={place.slot} className="group w-[82vw] flex-shrink-0 snap-start sm:w-[520px]" data-gta6-place>
                <div className="overflow-hidden rounded-2xl">
                  <FadeImg src={art(place.slot)} alt={place.name} loading="lazy" className="aspect-video w-full object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.04]" />
                </div>
                <h3 className="mt-4 text-2xl font-black uppercase leading-none tracking-tight">{place.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-white/70 sm:text-base">{place.text}</p>
              </article>
            ))}
          </Rail>
        </Reveal>
      </section>

      {/* ── 7. Кадры из игры ────────────────────────────────────────────── */}
      <section className="px-4 pb-16 sm:px-6 sm:pb-24 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <div className={EYEBROW}>Снимки экрана</div>
            <h2 className={`${H2} mt-3`}>Так выглядит игра</h2>
          </Reveal>
          <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {SHOTS.map((shot, i) => (
              <Reveal key={shot} delay={(i % 3) * 80} className={i === 0 ? 'col-span-2 lg:row-span-2' : ''}>
                <FadeImg src={gta6Asset(shot)} alt="Кадр из Grand Theft Auto VI" loading="lazy" className={`h-full w-full rounded-xl object-cover sm:rounded-2xl ${i === 0 ? 'aspect-video lg:aspect-auto' : 'aspect-video'}`} />
              </Reveal>
            ))}
          </div>
          <p className="mt-4 text-xs text-white/40">Иллюстрации и снимки экрана: материалы Rockstar Games.</p>
        </div>
      </section>

      {/* ── 8. Подарок + подборка PS5 ───────────────────────────────────── */}
      <section id="ps5" className="scroll-mt-36 lg:scroll-mt-40 px-4 pb-16 sm:px-6 sm:pb-24 lg:px-8">
        <div className="mx-auto max-w-7xl">
          <Reveal>
            <div className={EYEBROW}>Консоли</div>
            <h2 className={`${H2} mt-3`} data-gta6-gift-title>{gift ? giftTitle : 'PlayStation 5 для GTA VI'}</h2>
            <div className="mt-6 grid gap-8 lg:grid-cols-[7fr_5fr] lg:gap-14">
              <p className="whitespace-pre-line text-lg leading-relaxed text-white/80" data-gta6-gift-text>
                {gift ? giftText : 'Подобрали консоли, на которых GTA VI выглядит и работает так, как задумано. Оформите заявку — менеджер подтвердит наличие и доставку.'}
              </p>
              <ol className="divide-y divide-white/10 border-y border-white/10">
                {[
                  ['Выберите консоль', 'Любая PlayStation 5 из подборки ниже'],
                  ['Оформите заявку', 'Менеджер перезвонит и подтвердит заказ'],
                  [gift ? 'Заберите PS5 и игру' : 'Заберите PS5', gift ? 'GTA VI — наш подарок к покупке' : 'Самовывоз или доставка'],
                ].map(([title, text], i) => (
                  <li key={title} className="flex items-baseline gap-4 py-3.5">
                    <span className="text-sm font-black tabular-nums text-[#ffb0c4]">0{i + 1}</span>
                    <span><span className="block font-bold">{title}</span><span className="block text-sm text-white/60">{text}</span></span>
                  </li>
                ))}
              </ol>
            </div>
          </Reveal>

          <div className="mt-12" data-gta6-products>
            {loading ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-6 xl:grid-cols-4">
                {Array.from({ length: 4 }).map((_, i) => <ProductCardSkeleton key={i} />)}
              </div>
            ) : products.length === 0 ? (
              <div className="rounded-2xl bg-white/[0.05] p-10 text-center sm:rounded-3xl sm:p-14" data-gta6-empty>
                <h3 className="text-2xl font-black uppercase tracking-tight">Подборка появится совсем скоро</h3>
                <p className="mx-auto mt-3 max-w-md text-white/70">Мы собираем консоли к релизу. Позвоните — подскажем, что есть в наличии уже сейчас.</p>
                <div className="mt-7 flex flex-wrap justify-center gap-3">
                  <a href="tel:+79998021022" className={PINK_BTN}>+7 (999) 802-10-22</a>
                  <Link to="/catalog" className={GHOST_BTN}>Перейти в каталог</Link>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3 xl:grid-cols-4">
                {products.map((product, i) => (
                  <Reveal key={product.id} delay={Math.min(i, 7) * 60} className="h-full">
                    <ConsoleCard product={product} gift={gift} />
                  </Reveal>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── 9. Вопросы ──────────────────────────────────────────────────── */}
      <section className="px-4 pb-16 sm:px-6 sm:pb-24 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <Reveal><h2 className="text-3xl font-black uppercase tracking-tight sm:text-4xl">Вопросы и ответы</h2></Reveal>
          <div className="mt-6 divide-y divide-white/10 border-y border-white/10">
            {faq(released).filter(item => gift || !item.q.includes('в подарок')).map(item => (
              <details key={item.q} className="gta-faq group py-4">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-base font-bold sm:text-lg [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <svg className="h-5 w-5 flex-shrink-0 text-white/60 transition-transform duration-500 ease-out group-open:rotate-45" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
                </summary>
                <p className="mt-3 leading-relaxed text-white/70">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* ── 10. Финал ───────────────────────────────────────────────────── */}
      <section className="relative isolate flex min-h-[92svh] flex-col justify-end overflow-hidden">
        <picture>
          {!custom.finale && <source media="(max-width: 639px)" srcSet={gta6Asset('finale-m')} />}
          <FadeImg src={art('finale')} alt="" loading="lazy" className="absolute inset-0 -z-10 h-full w-full object-cover object-top" />
        </picture>
        <div className="absolute inset-x-0 top-0 -z-10 h-1/4 bg-gradient-to-b from-[#11111d] to-transparent" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-2/3 bg-gradient-to-t from-[#11111d] via-[#11111d]/70 to-transparent" />
        <div className="mx-auto w-full max-w-7xl px-4 pb-12 pt-40 sm:px-6 sm:pb-16 lg:px-8">
          <h2 className={H2}>Увидимся в Вайс-Сити</h2>
          <p className="mt-4 max-w-xl text-lg text-white/80">Остались вопросы по консолям, доставке или подарку? Позвоните — всё расскажем и закрепим PS5 за вами.</p>
          <div className="mt-7 flex flex-wrap gap-3">
            <a href="#ps5" className={PINK_BTN}>Выбрать PlayStation 5</a>
            <a href="tel:+79998021022" className={GHOST_BTN}>+7 (999) 802-10-22</a>
          </div>
          <p className="mt-12 max-w-3xl text-[11px] leading-relaxed text-white/45">
            Grand Theft Auto, GTA и Rockstar Games — товарные знаки Take-Two Interactive Software. PlayStation и PS5 — товарные знаки
            Sony Interactive Entertainment. Изображения — материалы Rockstar Games. TakeSmart — независимый магазин техники
            и не связан с правообладателями.
          </p>
        </div>
      </section>

      {celebrate && <Gta6Celebration gift={gift} onDone={endCelebration} />}
      {playing && <VideoModal video={playing.video} title={playing.title} onClose={() => setPlaying(null)} />}
    </div>
  )
}
