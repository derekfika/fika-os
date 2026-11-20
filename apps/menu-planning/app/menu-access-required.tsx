"use client";

import type { ReactNode } from "react";
import MenuPlanningShell from "./menu-planning-shell";
import { useMenuAccess } from "./menu-access";

export default function MenuAccessRequired({ children, section, allSites = false }: { children: ReactNode; section: string; allSites?: boolean }) {
  const access = useMenuAccess();
  if (allSites ? access.canManageAllSites : access.canManageOrganisation) return children;
  return <MenuPlanningShell section={section}>
    <div className="workspace-panel">
      <p role="status">{access.status === "pending" ? "Checking permissions…" : allSites ? "This workspace requires Manage access across all sites." : "This workspace requires Menu Planning Manage access."}</p>
    </div>
  </MenuPlanningShell>;
}
