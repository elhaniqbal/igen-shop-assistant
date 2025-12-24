import { useEffect, useState } from "react";

export function TapCardAnimation({ active = true }: { active?: boolean }) {
  const [pulse, setPulse] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setPulse((p) => (p + 1) % 3), 650);
    return () => window.clearInterval(id);
  }, [active]);

  // Simple SVG + pulse rings. Looks good on light/dark because we rely on currentColor/opacity.
  return (
    <div className="relative flex items-center justify-center w-full">
      <div className="relative h-28 w-28">
        {/* pulse rings */}
        <div
          className={[
            "absolute inset-0 rounded-full border transition-all duration-700",
            pulse === 0 ? "opacity-60 scale-100" : "opacity-0 scale-125",
            "border-rose-300",
          ].join(" ")}
        />
        <div
          className={[
            "absolute inset-0 rounded-full border transition-all duration-700 delay-150",
            pulse === 1 ? "opacity-60 scale-100" : "opacity-0 scale-125",
            "border-rose-300",
          ].join(" ")}
        />
        <div
          className={[
            "absolute inset-0 rounded-full border transition-all duration-700 delay-300",
            pulse === 2 ? "opacity-60 scale-100" : "opacity-0 scale-125",
            "border-rose-300",
          ].join(" ")}
        />

        {/* card + reader */}
        <div className="absolute inset-0 grid place-items-center">
          <div className="relative">
            {/* reader base */}
            <div className="mx-auto h-14 w-20 rounded-2xl border bg-white shadow-sm flex flex-col items-center justify-center">
              <div className="h-1.5 w-10 rounded-full bg-slate-200" />
              <div className="mt-2 h-2 w-2 rounded-full bg-emerald-400" />
            </div>

            {/* card "floating" */}
            <div className="absolute -top-10 left-1/2 -translate-x-1/2">
              <div
                className={[
                  "h-9 w-16 rounded-xl border bg-gradient-to-br from-rose-50 to-white shadow-sm",
                  "transition-transform duration-700",
                  active ? "translate-y-0" : "translate-y-1",
                ].join(" ")}
              >
                <div className="px-2 pt-2">
                  <div className="h-1.5 w-10 rounded bg-rose-200" />
                  <div className="mt-1 h-1.5 w-6 rounded bg-slate-200" />
                </div>
              </div>
              {/* “tap” lines */}
              <svg
                className="absolute -right-6 top-2 opacity-70"
                width="26"
                height="26"
                viewBox="0 0 24 24"
                fill="none"
              >
                <path
                  d="M7 7c3-3 7-3 10 0"
                  stroke="rgb(244 63 94)" // rose-500-ish
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M9 9c2-2 4-2 6 0"
                  stroke="rgb(244 63 94)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.7"
                />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
