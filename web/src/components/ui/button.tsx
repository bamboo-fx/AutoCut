import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
}

const base = 'inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus:outline-none disabled:opacity-50 disabled:pointer-events-none';
const variants: Record<NonNullable<ButtonProps['variant']>, string> = {
  default: 'bg-red-600 text-white hover:bg-red-500',
  outline: 'border border-white/20 text-white hover:bg-white/10',
  ghost: 'text-white hover:bg-white/10',
};
const sizes: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'h-9 px-3 text-sm',
  md: 'h-10 px-4',
  lg: 'h-11 px-6 text-base',
};

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'md', ...props }, ref) => (
    <button ref={ref} className={cn(base, variants[variant], sizes[size], className)} {...props} />
  )
);
Button.displayName = 'Button'; 