export function HardwareSpinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-4">
      <svg width="72" height="72" viewBox="0 0 100 100" className="animate-spin">
        <circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" strokeWidth="8" opacity="0.25" />
        <path d="M88 50a38 38 0 0 1-38 38" fill="none" stroke="currentColor" strokeWidth="8" strokeLinecap="round" />
      </svg>
      <div className="text-sm opacity-80">{label}</div>
    </div>
  );
}
