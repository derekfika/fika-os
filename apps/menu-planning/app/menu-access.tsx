"use client";

import { createContext, Fragment, useContext, useEffect, useState, type ReactNode } from "react";

const blocked = {
  canManage: false, canManageOrganisation: false, canManageAllSites: false,
  canPublish: false, canPublishAllSites: false, manageOplocIds: [] as string[], scopeKey: "",
};
type MenuAccess = typeof blocked & { status: "pending" | "ready" | "unavailable" };
const MenuAccessContext = createContext<MenuAccess>({ ...blocked, status: "pending" });

export function MenuAccessProvider({ children }: { children: ReactNode }) {
  const [access, setAccess] = useState<MenuAccess>({ ...blocked, status: "pending" });
  useEffect(() => {
    let request: AbortController | undefined;
    const refresh = () => {
      request?.abort();
      const controller = new AbortController();
      request = controller;
      void fetch("/api/access", { cache: "no-store", signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error("Menu Planning access could not be checked.");
        const permissions = await response.json() as typeof blocked;
        if (!controller.signal.aborted) setAccess({ ...permissions, status: "ready" });
      }).catch(() => {
        if (!controller.signal.aborted) setAccess({ ...blocked, status: "unavailable" });
      });
    };
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("fika-menu-access-refresh", refresh);
    return () => {
      request?.abort();
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("fika-menu-access-refresh", refresh);
    };
  }, []);
  return <MenuAccessContext.Provider value={access}><Fragment key={access.scopeKey}>{children}</Fragment></MenuAccessContext.Provider>;
}

export const useMenuAccess = () => useContext(MenuAccessContext);
