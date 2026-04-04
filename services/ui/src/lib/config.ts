export const API_BASE = import.meta.env.VITE_API_BASE?.replace(/\/$/, "") || "";
export const defaultReaderId = "haven_1_reader_1";

function buildCameraUrl() {
  const override = import.meta.env.VITE_CAMERA_STREAM_URL?.trim();
  if (override) return override;
  if (typeof window === "undefined") return "http://localhost:8006/stream";
  return `${window.location.protocol}//${window.location.hostname}:8006/stream`;
}

export const CONFIG = {
  apiBase: API_BASE,
  apiPrefix: "/api" as string,
  readerId: import.meta.env.VITE_READER_ID?.trim() || defaultReaderId,
  cameraStreamUrl: "/stream",
  stockRequestUrl: "https://ubcigenshop.notion.site/",
};
