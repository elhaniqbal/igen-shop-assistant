import { useEffect, useRef } from "react";
import { apiAdmin, type MachineAlert } from "../lib/api.admin";
import { useAlertToastContext } from "../components/AlertToastProvider";

function normalizeSeverity(input?: string): "critical" | "error" | "warning" | "info" | "success" {
  if (!input) return "info";
  const value = input.toLowerCase();
  if (
    value === "critical" ||
    value === "error" ||
    value === "warning" ||
    value === "info" ||
    value === "success"
  ) {
    return value;
  }
  return "info";
}

function buildToast(alert: MachineAlert) {
  const id = alert.alert_id || alert.id || `${alert.code || "alert"}-${alert.ts || Date.now()}`;
  const severity = normalizeSeverity(alert.severity);
  const title = alert.code
    ? alert.code.replaceAll("_", " ")
    : severity === "critical"
      ? "Critical machine alert"
      : "Machine alert";

  return {
    id,
    title,
    message: alert.message || "Unknown machine alert",
    severity,
    sticky: Boolean(alert.sticky) || severity === "critical" || severity === "error",
    createdAt: alert.ts,
  };
}

export function useAdminAlertToasts(options?: { enabled?: boolean; intervalMs?: number }) {
  const enabled = options?.enabled ?? true;
  const intervalMs = options?.intervalMs ?? 4000;
  const { pushToast, hasSeen } = useAlertToastContext();
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;

    let timer: number | null = null;

    const poll = async () => {
      try {
        const alerts = await apiAdmin.machineAlerts();
        if (!mounted.current) return;

        const newestFirst = [...alerts].sort((a, b) => {
          const at = a.ts ? new Date(a.ts).getTime() : 0;
          const bt = b.ts ? new Date(b.ts).getTime() : 0;
          return bt - at;
        });

        for (const alert of newestFirst.slice(0, 10).reverse()) {
          const toast = buildToast(alert);
          if (!hasSeen(toast.id)) {
            pushToast(toast);
          }
        }
      } catch {
        // Keep quiet here; the persistent alert panel can show details.
      }
    };

    poll();
    timer = window.setInterval(poll, intervalMs);

    return () => {
      if (timer) window.clearInterval(timer);
    };
  }, [enabled, intervalMs, pushToast, hasSeen]);
}