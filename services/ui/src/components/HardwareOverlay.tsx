import { useEffect, useState } from "react";
import { BrandMark } from "./BrandMark";

const FACTS = [
  "Did you know? HAVEN keeps slot state in software so returns go to the right opening.",
  "Did you know? Encoder checks can validate cake motion without blocking the user flow.",
  "Did you know? Admins can supervise the machine remotely over the internal network.",
  "Did you know? Tool loans and returns are tracked as staged hardware jobs, not blind actions.",
];

export function HardwareOverlay({ title, subtitle }: { title: string; subtitle?: string }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setIdx((i) => (i + 1) % FACTS.length), 2500);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div className="absolute inset-0 z-20 flex items-center justify-center rounded-3xl bg-slate-950/78 backdrop-blur-md">
      <div className="mx-6 w-full max-w-md overflow-hidden rounded-[30px] border border-white/12 bg-[linear-gradient(180deg,rgba(17,24,39,0.95)_0%,rgba(15,23,42,0.92)_100%)] p-6 text-white shadow-2xl">
        <div className="flex items-center gap-4">
          <BrandMark size={86} spinning />
          <div>
            <div className="text-xs uppercase tracking-[0.3em] text-rose-200">HAVEN</div>
            <div className="text-2xl font-bold">{title}</div>
            {subtitle ? <div className="mt-1 text-sm text-slate-200">{subtitle}</div> : null}
          </div>
        </div>
        <div className="mt-6 h-2 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/3 animate-loading-bar rounded-full bg-gradient-to-r from-[#ff2340] via-rose-300 to-[#5e5e5e]" />
        </div>
        <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.25em] text-rose-200">Did you know</div>
          <div className="mt-2 min-h-14 text-sm leading-6 text-slate-100">{FACTS[idx]}</div>
        </div>
      </div>
    </div>
  );
}
