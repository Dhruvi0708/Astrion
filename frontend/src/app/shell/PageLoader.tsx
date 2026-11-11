export function PageLoader({ label = 'Loading environment' }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="flex h-[60vh] flex-col items-center justify-center gap-4">
      <div className="relative h-10 w-10">
        <span className="absolute inset-0 rounded-full border border-cyan/20" />
        <span className="absolute inset-0 animate-spin rounded-full border border-transparent border-t-cyan" style={{ animationDuration: '1.1s' }} />
        <span className="absolute inset-[14px] rounded-full bg-cyan/70 shadow-[0_0_14px_rgb(var(--cyan))]" />
      </div>
      <span className="eyebrow">{label}</span>
    </div>
  );
}
