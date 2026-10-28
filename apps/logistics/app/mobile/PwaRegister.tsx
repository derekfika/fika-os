"use client";

import { useEffect } from "react";

/**
 * Registers the driver service worker for THIS van only, at scope /mobile/van1 or /mobile/van2. Each van's worker sits inside that van's
 * installed-app scope (its manifest scope), which is what lets Android attribute its notifications to that app rather than to Chrome,
 * and gives each van its own push subscription. Registration is harmless without service worker support. Nothing here prompts for
 * notification permission.
 */
export default function PwaRegister({ van }: { van: "van1" | "van2" }) {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.register("/pwa-sw.js", { scope: `/mobile/${van}` }).catch(() => undefined);
  }, [van]);
  return null;
}
