import type { ReactNode } from 'react'

interface ContainerProps {
  children: ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
}

export function Container({ children, className = '', size = 'lg' }: ContainerProps) {
  const sizes = {
    sm: 'max-w-3xl',
    md: 'max-w-5xl',
    lg: 'max-w-7xl',
    xl: 'max-w-[1400px]',
    full: 'max-w-full',
  }
  
  return (
    <div className={`mx-auto w-full px-4 sm:px-6 lg:px-8 ${sizes[size]} ${className}`}>
      {children}
    </div>
  )
}

interface SectionProps {
  children: ReactNode
  className?: string
  bg?: 'white' | 'gray' | 'dark' | 'gradient'
  py?: 'sm' | 'md' | 'lg' | 'xl'
}

export function Section({ children, className = '', bg = 'white', py = 'lg' }: SectionProps) {
  const backgrounds = {
    white: 'bg-white',
    gray: 'bg-gray-50',
    dark: 'bg-gray-900 text-white',
    gradient: 'bg-gradient-to-br from-gray-900 via-gray-800 to-gray-900 text-white',
  }
  
  const paddings = {
    sm: 'py-8 sm:py-12',
    md: 'py-12 sm:py-16',
    lg: 'py-16 sm:py-20',
    xl: 'py-20 sm:py-28',
  }
  
  return (
    <section className={`${backgrounds[bg]} ${paddings[py]} ${className}`}>
      {children}
    </section>
  )
}

interface BadgeProps {
  children: ReactNode
  variant?: 'default' | 'success' | 'warning' | 'error' | 'yellow'
  size?: 'sm' | 'md'
}

export function Badge({ children, variant = 'default', size = 'sm' }: BadgeProps) {
  const variants = {
    default: 'bg-gray-100 text-gray-700',
    success: 'bg-green-100 text-green-700',
    warning: 'bg-orange-100 text-orange-700',
    error: 'bg-red-100 text-red-700',
    yellow: 'bg-yellow-400 text-gray-900',
  }
  
  const sizes = {
    sm: 'px-2.5 py-0.5 text-xs',
    md: 'px-3 py-1 text-sm',
  }
  
  return (
    <span className={`inline-flex items-center rounded-full font-semibold ${variants[variant]} ${sizes[size]}`}>
      {children}
    </span>
  )
}
