import { Container, Section } from '../components/ui/Layout'
import { Button } from '../components/ui/Button'

export function DeliveryPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      {/* Hero */}
      <Section className="bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 py-24">
        <Container>
          <div className="mx-auto max-w-4xl text-center">
            <h1 className="mb-6 text-5xl font-bold text-white lg:text-6xl">
              Доставка <span className="text-yellow-400">и оплата</span>
            </h1>
            <p className="text-xl text-gray-400">
              Удобные способы получения и оплаты вашего заказа
            </p>
          </div>
        </Container>
      </Section>

      {/* Delivery Methods */}
      <Section className="py-16">
        <Container>
          <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">Способы доставки</h2>
          
          <div className="grid gap-8 lg:grid-cols-3">
            {/* Pickup */}
            <div className="rounded-3xl border border-gray-100 bg-white p-8 shadow-lg transition-all hover:shadow-2xl">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100 text-4xl">
                🏪
              </div>
              <h3 className="mb-4 text-2xl font-bold text-gray-900">Самовывоз</h3>
              <div className="mb-4 inline-flex rounded-full bg-green-100 px-4 py-2 text-green-700 font-semibold">
                Бесплатно
              </div>
              <p className="mb-6 text-gray-600">
                Заберите заказ из нашего магазина. Можете осмотреть товар перед покупкой.
              </p>
              <div className="rounded-xl bg-gray-50 p-4">
                <div className="mb-2 font-semibold text-gray-900">📍 Адрес магазина:</div>
                <p className="text-gray-600">г. Москва, ул. Барклая, д. 10</p>
                <p className="text-gray-600">ТЦ «Багратионовский», павильон А60</p>
                <p className="mt-2 text-sm text-gray-500">М. Багратионовская</p>
              </div>
              <div className="mt-4 text-sm text-gray-500">
                ⏰ Пн-Вс: 10:00 - 20:00
              </div>
            </div>

            {/* Courier */}
            <div className="rounded-3xl border-2 border-yellow-400 bg-white p-8 shadow-lg transition-all hover:shadow-2xl relative">
              <div className="absolute -top-3 right-6 rounded-full bg-yellow-400 px-4 py-1 text-sm font-semibold text-gray-900">
                Популярный
              </div>
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-yellow-100 text-4xl">
                🚗
              </div>
              <h3 className="mb-4 text-2xl font-bold text-gray-900">Курьер по Москве</h3>
              <div className="mb-4 inline-flex rounded-full bg-yellow-100 px-4 py-2 text-yellow-700 font-semibold">
                от 1000 ₽
              </div>
              <p className="mb-6 text-gray-600">
                Доставим в удобное для вас время. Возможна доставка в день заказа.
              </p>
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span>
                  Доставка в день заказа
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span>
                  Проверка при получении
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span>
                  Оплата при получении
                </li>
              </ul>
              <div className="mt-4 rounded-xl bg-yellow-50 p-4 text-sm">
                <span className="font-semibold">🎁 При заказе от 200 000 ₽</span>
                <br/>
                доставка бесплатно
              </div>
            </div>

            {/* Shipping */}
            <div className="rounded-3xl border border-gray-100 bg-white p-8 shadow-lg transition-all hover:shadow-2xl">
              <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-100 text-4xl">
                📦
              </div>
              <h3 className="mb-4 text-2xl font-bold text-gray-900">Доставка по России</h3>
              <div className="mb-4 inline-flex rounded-full bg-blue-100 px-4 py-2 text-blue-700 font-semibold">
                от 800 ₽
              </div>
              <p className="mb-6 text-gray-600">
                Отправляем транспортными компаниями СДЭК, Почта России, Boxberry.
              </p>
              <ul className="space-y-2 text-gray-600">
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span>
                  Страховка груза
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span>
                  Отслеживание заказа
                </li>
                <li className="flex items-center gap-2">
                  <span className="text-green-500">✓</span>
                  Доставка до пункта выдачи
                </li>
              </ul>
              <div className="mt-4 text-sm text-gray-500">
                Срок: 2-7 рабочих дней
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* Payment Methods */}
      <Section className="bg-gray-50 py-16">
        <Container>
          <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">Способы оплаты</h2>
          
          <div className="grid gap-8 lg:grid-cols-2">
            {/* Cash */}
            <div className="rounded-3xl bg-white p-8 shadow-lg">
              <div className="flex items-start gap-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-green-100 text-4xl">
                  💵
                </div>
                <div>
                  <h3 className="mb-2 text-2xl font-bold text-gray-900">Наличными</h3>
                  <div className="mb-4 inline-flex rounded-full bg-green-100 px-4 py-2 text-green-700 font-semibold">
                    Без наценки
                  </div>
                  <p className="text-gray-600">
                    Оплата при получении наличными курьеру или в магазине. 
                    Вы можете осмотреть товар перед оплатой.
                  </p>
                </div>
              </div>
            </div>

            {/* Card */}
            <div className="rounded-3xl bg-white p-8 shadow-lg">
              <div className="flex items-start gap-6">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-orange-100 text-4xl">
                  💳
                </div>
                <div>
                  <h3 className="mb-2 text-2xl font-bold text-gray-900">Банковской картой</h3>
                  <div className="mb-4 inline-flex rounded-full bg-orange-100 px-4 py-2 text-orange-700 font-semibold">
                    +15% к цене
                  </div>
                  <p className="text-gray-600">
                    Оплата картой при получении. В связи с эквайринговой комиссией 
                    действует наценка 15% к стоимости заказа.
                  </p>
                  <div className="mt-4 flex gap-2">
                    <span className="rounded bg-gray-100 px-2 py-1 text-sm">Visa</span>
                    <span className="rounded bg-gray-100 px-2 py-1 text-sm">Mastercard</span>
                    <span className="rounded bg-gray-100 px-2 py-1 text-sm">МИР</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Container>
      </Section>

      {/* FAQ */}
      <Section className="py-16">
        <Container>
          <h2 className="mb-12 text-center text-3xl font-bold text-gray-900">Частые вопросы</h2>
          
          <div className="mx-auto max-w-3xl space-y-4">
            {[
              {
                q: 'Как быстро доставите?',
                a: 'По Москве можем доставить в день заказа. В регионы — от 2 до 7 дней.'
              },
              {
                q: 'Можно осмотреть товар перед оплатой?',
                a: 'Да, при любом способе доставки вы можете осмотреть и проверить товар перед оплатой.'
              },
              {
                q: 'Есть ли гарантия?',
                a: 'На всю технику предоставляется гарантия от 12 месяцев. Точный срок указан в карточке товара.'
              },
              {
                q: 'Почему наценка за оплату картой?',
                a: 'Банки берут комиссию за эквайринг. Чтобы предложить вам лучшие цены наличными, мы добавляем 15% при оплате картой.'
              },
              {
                q: 'Работаете с юрлицами?',
                a: 'Да, выставляем счета для юридических лиц. Свяжитесь с нами для оформления.'
              },
            ].map((item, i) => (
              <div key={i} className="rounded-2xl border border-gray-100 bg-white p-6">
                <h3 className="mb-2 font-semibold text-gray-900">{item.q}</h3>
                <p className="text-gray-600">{item.a}</p>
              </div>
            ))}
          </div>
        </Container>
      </Section>

      {/* CTA */}
      <div className="bg-gray-900">
        <Container>
          <div className="py-14 text-center">
            <h2 className="mb-3 text-3xl font-bold text-white">Остались вопросы?</h2>
            <p className="mb-8 text-gray-400">Свяжитесь с нами любым удобным способом</p>
            <div className="flex flex-col items-center justify-center gap-4 sm:flex-row">
              <a
                href="tel:+79998021022"
                className="inline-flex items-center gap-2 rounded-xl bg-yellow-400 px-8 py-4 font-semibold text-gray-900 transition hover:bg-yellow-300"
              >
                📞 +7 (999) 802-10-22
              </a>
              <Button to="/catalog" variant="outline" size="lg" className="border-white text-white hover:bg-white hover:text-gray-900">
                Перейти в каталог
              </Button>
            </div>
          </div>
        </Container>
      </div>
    </div>
  )
}
