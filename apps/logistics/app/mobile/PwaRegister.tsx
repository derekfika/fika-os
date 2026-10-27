"use client";

import { useEffect } from "react";

/**
 * Registers the driver service worker, scoped to /mobile/ only. Registration is harmless if the browser does not support
 * service workers; the app works online without it. Nothing here requests notification permission.
 */
export default function PwaRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/pwa-sw.js", { scope: "/mobile/" }).catch(() => undefined);
  }, []);
  return null;
}
