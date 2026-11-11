import { cn } from '@/lib/cn';

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string }[];
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Radio-group style segmented control (keyboard accessible via native radios). */
export function Segmented<T extends string>({ value, onChange, options, label, size = 'sm', className }: SegmentedProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cn('inline-flex rounded-md border border-line bg-deep p-0.5', className)}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              'rounded-[5px] font-medium transition-colors',
              size === 'sm' ? 'h-6 px-2.5 text-2xs' : 'h-7 px-3 text-xs',
              active ? 'bg-raised text-ink shadow-[0_0_0_1px_rgb(var(--line-strong))]' : 'text-ink-faint hover:text-ink-muted',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
