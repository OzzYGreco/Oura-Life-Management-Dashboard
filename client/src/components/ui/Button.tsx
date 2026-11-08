import { cn } from '../../lib/utils'
import { type ButtonHTMLAttributes, forwardRef } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'good' | 'warn'
  /** sm 28px (in a row), md 34px (toolbars, dialogs), lg 44px (main action). */
  size?: 'sm' | 'md' | 'lg'
}

/** The app's button, drawn by the shared control system (skins/next/controls.css). */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'primary', size = 'md', className, ...props }, ref) => (
    <button ref={ref} className={cn('ui-btn', variant, size, className)} {...props} />
  ),
)

Button.displayName = 'Button'
