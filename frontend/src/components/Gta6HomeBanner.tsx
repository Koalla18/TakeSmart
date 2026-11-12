import { Link } from 'react-router-dom'
import { GTA6_RELEASE_LABEL, gta6Asset, isGta6Released } from '../lib/gta6'

/** Блок-анонс раздела GTA VI на главной: широкая карточка с официальным артом, ведёт на /gta6 */
export function Gta6HomeBanner() {
  const released = isGta6Released()
  return (
    <section className="bg-white pt-6 sm:pt-10" data-gta6-home>
      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <Link to="/gta6" className="group relative block overflow-hidden rounded-3xl bg-[#11111d]">
          <picture>
            <source media="(max-width: 639px)" srcSet={gta6Asset('home-m')} />
            <img
              src={gta6Asset('home')}
              alt="Grand Theft Auto VI"
              className="absolute inset-0 h-full w-full object-cover object-[50%_20%] transition-transform duration-[1200ms] ease-out group-hover:scale-[1.03] sm:object-[70%_50%]"
            />
          </picture>
          <div className="absolute inset-0 bg-gradient-to-t from-[#11111d] via-[#11111d]/40 to-transparent sm:bg-gradient-to-r sm:from-[#11111d]/95 sm:via-[#11111d]/55 sm:to-transparent" />
          <div className="relative flex min-h-[440px] flex-col justify-end gap-3 p-6 sm:min-h-[380px] sm:justify-center sm:p-12 lg:p-16">
            <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/80 sm:text-xs">
              {released ? 'Уже вышла' : `Выходит ${GTA6_RELEASE_LABEL} года`}
            </div>
            <h2 className="max-w-lg text-3xl font-black uppercase leading-[1.02] tracking-tight text-white sm:text-5xl">
              GTA VI в подарок к&nbsp;PlayStation&nbsp;5
            </h2>
            <p className="max-w-md text-sm text-white/75 sm:text-base">
              Всё об игре, героях и штате Леонида — и консоли, {released ? 'на которых в неё стоит играть.' : 'с которыми вы встретите релиз в первый день.'}
            </p>
            <span className="mt-2 inline-flex w-fit items-center rounded-full bg-[#ffb0c4] px-6 py-3 text-sm font-bold text-[#11111d] transition-colors group-hover:bg-white">
              Открыть раздел
            </span>
          </div>
        </Link>
      </div>
    </section>
  )
}
