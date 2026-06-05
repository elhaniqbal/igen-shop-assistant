import { BrandMark } from "./BrandMark";

export function HavenSplash() {
  return (
    <div className="fixed inset-0 z-[120] overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(255,61,87,0.22),_transparent_24%),radial-gradient(circle_at_bottom,_rgba(52,71,255,0.18),_transparent_26%),linear-gradient(180deg,#0b1020_0%,#111827_40%,#020617_100%)] text-white">
      <div className="absolute inset-0 opacity-60">
        <div className="absolute left-[-8rem] top-10 h-80 w-80 rounded-full bg-rose-500/25 blur-3xl" />
        <div className="absolute right-[-6rem] top-1/3 h-[28rem] w-[28rem] rounded-full bg-rose-500/18 blur-3xl" />
        <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/8" />
      </div>
      <div className="relative flex h-full flex-col items-center justify-center gap-8 px-6 text-center">
        <div className="relative animate-float">
          <div className="absolute inset-[-14%] rounded-full border border-rose-300/25 animate-orbit-slow" />
          <BrandMark size={188} spinning className="mx-auto" />
        </div>
        <div className="space-y-4 animate-splash-rise">
          <div className="text-xs font-semibold uppercase tracking-[0.45em] text-rose-200/90">UBC Integrated Engineering</div>
          <h1 className="text-5xl font-black tracking-[0.25em] sm:text-7xl">HAVEN</h1>
          <p className="mx-auto max-w-2xl text-base text-slate-200 sm:text-xl">
            Your smart tool vending shop assistant.
          </p>
          <div className="mx-auto h-px w-44 bg-gradient-to-r from-transparent via-rose-300/80 to-transparent" />
          <p className="text-sm text-slate-300">Initializing hardware, sessions, and inventory intelligence…</p>
        </div>
      </div>
    </div>
  );
}
