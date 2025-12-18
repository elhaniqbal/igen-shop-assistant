export function RotarySpinner({ label = "Dispensing..." }: { label?: string }) {
  return (
    <div className="flex flex-col items-center gap-4 py-2">
      <div className="relative h-28 w-28">
        {/* Outer ring */}
        <div className="absolute inset-0 rounded-full border-4 border-rose-200" />
        {/* Rotating arm */}
        <div className="absolute inset-0 animate-spin [animation-duration:1.1s]">
          <div className="absolute left-1/2 top-1/2 h-1 w-10 -translate-y-1/2 rounded bg-rose-600 origin-left" />
          <div className="absolute left-[78%] top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-600" />
        </div>
        {/* Center hub */}
        <div className="absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-rose-600 shadow" />
      </div>

      <div className="text-sm text-slate-700">{label}</div>
      <div className="text-xs text-slate-500">Please wait — do not pull on the mechanism.</div>
    </div>
  );
}
