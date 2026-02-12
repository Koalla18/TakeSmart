import { useEffect, useRef, useState } from 'react'

interface ScrollAnimationOptions {
  threshold?: number
  rootMargin?: string
  once?: boolean
}

export function useScrollAnimation(options: ScrollAnimationOptions = {}) {
  const { threshold = 0.1, rootMargin = '0px', once = true } = options
  const elementRef = useRef<HTMLElement>(null)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    const element = elementRef.current
    if (!element) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true)
          if (once) {
            observer.unobserve(element)
          }
        } else if (!once) {
          setIsVisible(false)
        }
      },
      { threshold, rootMargin }
    )

    observer.observe(element)
    return () => observer.disconnect()
  }, [threshold, rootMargin, once])

  return { ref: elementRef, isVisible }
}

export function useParallax(speed: number = 0.5) {
  const elementRef = useRef<HTMLElement>(null)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      const element = elementRef.current
      if (!element) return

      const rect = element.getBoundingClientRect()
      const scrolled = window.scrollY
      const elementTop = rect.top + scrolled
      const windowHeight = window.innerHeight

      if (scrolled + windowHeight > elementTop && scrolled < elementTop + rect.height) {
        const relativeScroll = scrolled - elementTop + windowHeight
        setOffset(relativeScroll * speed)
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [speed])

  return { ref: elementRef, offset }
}

export function useScrollProgress() {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      const scrollTop = window.scrollY
      const docHeight = document.documentElement.scrollHeight - window.innerHeight
      setProgress(docHeight > 0 ? (scrollTop / docHeight) * 100 : 0)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return progress
}

export function useSectionProgress(elementRef: React.RefObject<HTMLElement>) {
  const [progress, setProgress] = useState(0)

  useEffect(() => {
    const handleScroll = () => {
      const element = elementRef.current
      if (!element) return

      const rect = element.getBoundingClientRect()
      const windowHeight = window.innerHeight
      
      // Calculate progress as element moves through viewport
      // 0 = element just entered viewport from bottom
      // 1 = element just left viewport from top
      const totalDistance = windowHeight + rect.height
      const distanceTraveled = windowHeight - rect.top
      const newProgress = Math.max(0, Math.min(1, distanceTraveled / totalDistance))
      
      setProgress(newProgress)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    handleScroll()
    return () => window.removeEventListener('scroll', handleScroll)
  }, [elementRef])

  return progress
}

// CSS animation classes for scroll animations
export const scrollAnimationClasses = {
  fadeIn: 'opacity-0 transition-all duration-700 [&.visible]:opacity-100',
  fadeInUp: 'opacity-0 translate-y-10 transition-all duration-700 [&.visible]:opacity-100 [&.visible]:translate-y-0',
  fadeInDown: 'opacity-0 -translate-y-10 transition-all duration-700 [&.visible]:opacity-100 [&.visible]:translate-y-0',
  fadeInLeft: 'opacity-0 translate-x-10 transition-all duration-700 [&.visible]:opacity-100 [&.visible]:translate-x-0',
  fadeInRight: 'opacity-0 -translate-x-10 transition-all duration-700 [&.visible]:opacity-100 [&.visible]:translate-x-0',
  scaleIn: 'opacity-0 scale-95 transition-all duration-700 [&.visible]:opacity-100 [&.visible]:scale-100',
  slideUp: 'translate-y-full transition-transform duration-700 [&.visible]:translate-y-0',
}
