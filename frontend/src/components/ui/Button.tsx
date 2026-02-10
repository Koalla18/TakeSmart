import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  children: ReactNode
  href?: string
  to?: string
  fullWidth?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  children,
  href,
  to,
  fullWidth,
  className = '',
  ...props
}: ButtonProps) {
  const baseStyles = 'inline-flex items-center justify-center font-semibold rounded-xl transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-offset-2'
  
  const variants = {
    primary: 'bg-yellow-400 text-gray-900 hover:bg-yellow-500 focus:ring-yellow-400 shadow-lg shadow-yellow-400/25',
    secondary: 'bg-gray-900 text-white hover:bg-gray-800 focus:ring-gray-900',
    outline: 'border-2 border-gray-200 text-gray-900 hover:border-yellow-400 hover:text-yellow-600 focus:ring-yellow-400',
    ghost: 'text-gray-600 hover:text-yellow-600 hover:bg-yellow-50 focus:ring-yellow-400',
  }
  
  const sizes = {
    sm: 'px-4 py-2 text-sm gap-1.5',
    md: 'px-6 py-3 text-base gap-2',
    lg: 'px-8 py-4 text-lg gap-2.5',
  }
  
  const classes = `${baseStyles} ${variants[variant]} ${sizes[size]} ${fullWidth ? 'w-full' : ''} ${className}`
  
  const linkTo = to || href
  if (linkTo) {
    return (
      <Link to={linkTo} className={classes}>
        {children}
      </Link>
    )
  }
  
  return (
    <button className={classes} {...props}>
      {children}
    </button>
  )
}
