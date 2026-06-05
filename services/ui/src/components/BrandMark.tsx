export function BrandMark({ size = 56, spinning = false, className = "" }: { size?: number; spinning?: boolean; className?: string }) {
  return (
    <div
      className={`relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
      aria-label="IGEN logo"
    >
      <div className="absolute inset-[8%] rounded-full bg-rose-500/18 blur-2xl" />
      <div className="absolute inset-[16%] rounded-full bg-white/95 shadow-[0_22px_70px_rgba(15,23,42,0.16)]" />
      <div className={`absolute inset-[10%] rounded-full border border-rose-400/35 bg-[conic-gradient(from_180deg_at_50%_50%,rgba(255,36,64,0.10),rgba(255,255,255,0.85),rgba(94,94,94,0.10),rgba(255,36,64,0.14))] ${spinning ? "animate-orbit-slow" : ""}`} />
      <img
        src="/igen-logo.png"
        alt="IGEN"
        className={`relative z-10 h-[88%] w-[88%] object-contain drop-shadow-[0_10px_20px_rgba(15,23,42,0.16)] ${spinning ? "animate-logo-drift" : ""}`}
      />
    </div>
  );
}
