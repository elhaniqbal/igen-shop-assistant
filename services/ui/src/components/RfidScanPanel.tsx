import { useEffect, useState } from "react";
import { CONFIG } from "../lib/config";
import { apiUser, type RfidKind, type RfidScan } from "../lib/api.user";

export function RfidScanPanel(props: {
  kind: RfidKind;
  title: string;
  subtitle?: string;
  onScan: (scan: RfidScan) => void;
}) {
  const { kind, title, subtitle, onScan } = props;
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    let t: number | undefined;

    const run = async () => {
      try {
        setErr(null);
        await apiUser.rfidSetMode({ reader_id: CONFIG.readerId, mode: kind });

        const tick = async () => {
          if (!alive) return;
          try {
            const resp = await apiUser.rfidConsume(CONFIG.readerId, kind);
            if (resp.ok && resp.scan) {
              onScan(resp.scan);
              return;
            }
          } catch (e) {
            setErr(e && typeof e === "object" && "message" in e ? String((e as any).message) : "RFID poll failed");
            return;
          }
          t = window.setTimeout(tick, 250);
        };

        tick();
      } catch (e) {
        setErr(e && typeof e === "object" && "message" in e ? String((e as any).message) : "RFID setup failed");
      }
    };

    run();
    return () => {
      alive = false;
      if (t) window.clearTimeout(t);
    };
  }, [kind, onScan]);

  return (
    <div className="rounded-2xl border p-4 bg-white/5">
      <div className="text-lg font-semibold">{title}</div>
      {subtitle ? <div className="text-sm opacity-80 mt-1">{subtitle}</div> : null}
      {err ? <div className="text-sm text-red-400 mt-3">{err}</div> : <div className="text-sm opacity-70 mt-3">Waiting for scan…</div>}
    </div>
  );
}
