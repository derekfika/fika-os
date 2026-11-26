import { cpuDestinationLabel } from "../../lib/production-presentation";
import type { ProductionOrder } from "../../lib/production-types";
import { referenceAlias } from "./run-sheet-presentation";
import { runSheetServiceKey } from "./run-sheet-printing";

export type TotalsPaxSite = {
  key: string;
  label: string;
  recordedPax: number;
  recordedServices: number;
  unrecordedServices: number;
};

export type TotalsPaxSummary = {
  sites: TotalsPaxSite[];
  totalPax?: number;
  serviceCount: number;
  recordedServices: number;
  unrecordedServices: number;
  incomplete: boolean;
};

type ServicePax = {
  siteKey: string;
  siteLabel: string;
  values: Set<number>;
  hasUnrecordedValue: boolean;
};

function siteIdentity(order: ProductionOrder) {
  const oplocId = order.destinationOplocId?.trim();
  if (oplocId) return `oploc:${oplocId}`;
  const snapshotIdentity = order.destinationAddress?.identity?.trim();
  if (snapshotIdentity) return `snapshot:${snapshotIdentity}`;
  return `order:${order.canonicalId}`;
}

function recordedPax(order: ProductionOrder) {
  if (order.origin !== "menu_planning" && order.origin !== "hospitality_booking") return undefined;
  return Number.isSafeInteger(order.guestCount) && Number(order.guestCount) > 0
    ? Number(order.guestCount)
    : undefined;
}

/**
 * Summarizes only canonical order-level PAX. A service contributes once regardless
 * of its number of production lines; missing or conflicting service values stay
 * unrecorded and make the recorded subtotal explicitly incomplete.
 */
export function summarizeTotalsPax(orders: readonly ProductionOrder[]): TotalsPaxSummary {
  const services = new Map<string, ServicePax>();
  for (const order of orders) {
    const siteKey = siteIdentity(order);
    const serviceDate = order.serviceDate || "unknown-date";
    const menuId = order.origin === "menu_planning" ? order.sourceMenuId?.trim() : undefined;
    const serviceIdentity = menuId ? `menu:${menuId}` : `order:${order.canonicalId}`;
    const identity = JSON.stringify([serviceDate, siteKey, runSheetServiceKey(order), serviceIdentity]);
    let contribution = services.get(identity);
    if (!contribution) {
      contribution = { siteKey, siteLabel: cpuDestinationLabel(order), values: new Set<number>(), hasUnrecordedValue: false };
      services.set(identity, contribution);
    }
    const pax = recordedPax(order);
    if (pax === undefined) contribution.hasUnrecordedValue = true;
    else contribution.values.add(pax);
  }

  const bySite = new Map<string, { label: string; recordedPax: number; recordedServices: number; unrecordedServices: number }>();
  let totalPax = 0;
  let recordedServices = 0;
  let unrecordedServices = 0;
  for (const contribution of services.values()) {
    const site = bySite.get(contribution.siteKey) || { label: contribution.siteLabel, recordedPax: 0, recordedServices: 0, unrecordedServices: 0 };
    const values = [...contribution.values];
    if (!contribution.hasUnrecordedValue && values.length === 1) {
      site.recordedPax += values[0];
      site.recordedServices += 1;
      totalPax += values[0];
      recordedServices += 1;
    } else {
      site.unrecordedServices += 1;
      unrecordedServices += 1;
    }
    bySite.set(contribution.siteKey, site);
  }

  const labelCounts = new Map<string, number>();
  for (const site of bySite.values()) labelCounts.set(site.label, (labelCounts.get(site.label) || 0) + 1);
  const sites = [...bySite.entries()].map(([key, site]) => ({
    key,
    ...site,
    label: labelCounts.get(site.label)! > 1 ? `${site.label} · Site ${referenceAlias(key)}` : site.label,
  })).sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));

  return {
    sites,
    ...(recordedServices ? { totalPax } : {}),
    serviceCount: services.size,
    recordedServices,
    unrecordedServices,
    incomplete: unrecordedServices > 0,
  };
}
