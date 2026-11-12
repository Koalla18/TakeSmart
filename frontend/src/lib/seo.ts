import { API_BASE_URL } from './config'

// ─────────────────────────────────────────────────────────────────────────────
// Заголовок вкладки и мета-теги страницы. Источник один — бэкенд (/api/seo/meta/…):
// те же тексты роботы получают сразу в HTML (nginx + SSI), а здесь сайт обновляет
// их при переходах внутри SPA, чтобы вкладка, закладки и рендер Google совпадали.
// ─────────────────────────────────────────────────────────────────────────────

export interface SeoMeta {
  title: string
  description: string
  canonical: string | null
  robots: string
  image: string
}

const cache = new Map<string, SeoMeta>()

export async function fetchSeoMeta(path: string, search: string): Promise<SeoMeta | null> {
  const key = path + search
  const hit = cache.get(key)
  if (hit) return hit
  try {
    const res = await fetch(`${API_BASE_URL}/api/seo/meta${path === '/' ? '/' : path}${search}`)
    if (!res.ok) return null
    const meta = (await res.json()) as SeoMeta
    cache.set(key, meta)
    return meta
  } catch {
    return null
  }
}

function setMeta(attr: 'name' | 'property', key: string, value: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`)
  if (!el) {
    el = document.createElement('meta')
    el.setAttribute(attr, key)
    document.head.appendChild(el)
  }
  el.setAttribute('content', value)
}

export function applySeoMeta(meta: SeoMeta) {
  document.title = meta.title
  setMeta('name', 'description', meta.description)
  setMeta('name', 'robots', meta.robots)
  setMeta('property', 'og:title', meta.title)
  setMeta('property', 'og:description', meta.description)
  setMeta('property', 'og:image', meta.image)
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (meta.canonical) {
    if (!link) {
      link = document.createElement('link')
      link.rel = 'canonical'
      document.head.appendChild(link)
    }
    link.href = meta.canonical
    setMeta('property', 'og:url', meta.canonical)
  } else if (link) {
    link.remove()
  }
}
