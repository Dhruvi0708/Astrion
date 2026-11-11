import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '@/lib/cn';

type Variant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
type Size = 'sm' | 'md' | 'lg' | 'icon';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap font-medium transition-[background-color,border-color,color,box-shadow,transform] duration-150 disabled:pointer-events-none disabled:opacity-45 active:translate-y-px';

const variants: Record<Variant, string> = {
  primary:
    'bg-cyan text-void hover:bg-[#7cedf6] shadow-[0_0_0_1px_rgb(var(--cyan)/0.5),0_8px_28px_-10px_rgb(var(--cyan)/0.65)] font-semibold',
  secondary: 'bg-raised text-ink border border-line-strong hover:border-ink-faint hover:bg-[#1a2238]',
  outline: 'border border-line-strong text-ink hover:border-cyan/60 hover:text-cyan bg-transparent',
  ghost: 'text-ink-muted hover:text-ink hover:bg-raised/70',
  danger: 'border border-conflict/40 text-conflict hover:bg-conflict/10',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 rounded px-3 text-xs',
  md: 'h-9 rounded-md px-4 text-sm',
  lg: 'h-12 rounded-md px-6 text-[0.95rem]',
  icon: 'h-8 w-8 rounded',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', className, type = 'button', ...props },
  ref,
) {
  return <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} {...props} />;
});

export function ButtonLink({ variant = 'secondary', size = 'md', className, ...props }: LinkProps & { variant?: Variant; size?: Size }) {
  return <Link className={cn(base, variants[variant], sizes[size], className)} {...props} />;
}
