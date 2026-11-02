"use client";

import { useMemo, useState, type ReactNode } from "react";
import "./HospitalityCatalogueOverview.css";
import { AlertTriangle, Archive, ArrowRight, ClipboardCheck, Info, MapPin, Search, Tag, Utensils } from "lucide-react";
import { SERVICE_IDS, sameServiceRule, type ServiceId, type ServiceRule } from "@fika/server-shared/hospitality-service-layout";
import type { CataloguePayload } from "../../lib/hospitality-catalogue-types";
import { SERVICE_LABELS } from "../../lib/hospitality-catalogue-types";

export type CatalogueOverviewTab = "items" | "services" | "locations";

type OverviewProps = {
  payload: CataloguePayload;
  onNavigate: (tab: CatalogueOverviewTab) => void;
};

export type CatalogueOverviewMetrics = {
  activeItems: number;
  archivedItems: number;
  itemsToReview: number;
  activeServices: number | null;
  activeLocations: number;
  locationsWithOverrides: number | null;
};

export type CatalogueAttention = {
  id: string;
  title: string;
  description: string;
  count?: number;
  tab: CatalogueOverviewTab;
};

export type CatalogueOverviewSearchResult = {
  id: string;
  kind: "Item" | "Booking Service" | "Category";
  label: string;
  detail: string;
  tab: CatalogueOverviewTab;
};

/** Derives manager-facing counts from the already-loaded catalogue payload only. */
export function deriveCatalogueOverviewMetrics(payload: CataloguePayload): CatalogueOverviewMetrics {
  const activeLocations = payload.oplocs.filter(site => site.active);
  const layout = payload.serviceLayout;

  const activeServices = layout
    ? SERVICE_IDS.filter(id => !layout.company.services[id]?.hidden).length
    : null;

  const locationsWithOverrides = layout
    ? activeLocations.filter(site => {
        const siteRules = layout.sites[site.oplocId]?.services;
        if (!siteRules) return false;
        return (Object.entries(siteRules) as Array<[ServiceId, ServiceRule]>).some(([serviceId, rule]) =>
          !sameServiceRule(rule, layout.company.services[serviceId]),
        );
      }).length
    : null;

  return {
    activeItems: payload.counts.active,
    archivedItems: payload.counts.archived,
    itemsToReview: payload.counts.needsReview,
    activeServices,
    activeLocations: activeLocations.length,
    locationsWithOverrides,
  };
}

/** Actionable findings derived from loaded Item and service-layout records. */
export function deriveCatalogueAttention(payload: CataloguePayload): CatalogueAttention[] {
  const findings: CatalogueAttention[] = [];
  const activeRows = payload.rows.filter(row => row.status === "active");
  const priceReview = activeRows.filter(row => row.needsReview.includes("price_missing")).length;
  const routingReview = activeRows.filter(row => row.needsReview.includes("routing_required") || row.needsReview.includes("routing_conflict")).length;
  const duplicateReview = payload.reviewGroups.filter(group => group.decision !== "merge" && group.decision !== "keep_separate").length;

  if (priceReview) findings.push({ id: "price-review", title: "Items need pricing review", description: "Check the effective price and booking mode for these Items.", count: priceReview, tab: "items" });
  if (routingReview) findings.push({ id: "routing-review", title: "Items need production routing review", description: "Confirm the governed production route for each Item.", count: routingReview, tab: "items" });
  if (duplicateReview) findings.push({ id: "duplicate-review", title: "Potential duplicates need a decision", description: "Review the canonical Item groups before further changes.", count: duplicateReview, tab: "items" });

  const layout = payload.serviceLayout;
  if (layout) {
    const mappedCategories = new Set<string>();
    for (const serviceId of SERVICE_IDS) {
      const rule = layout.company.services[serviceId];
      if (rule && !rule.hidden) rule.categories.forEach(category => mappedCategories.add(category));
    }

    const activeCategoryCounts = new Map<string, number>();
    for (const row of activeRows) activeCategoryCounts.set(row.category, (activeCategoryCounts.get(row.category) ?? 0) + 1);
    const unmapped = [...activeCategoryCounts.entries()].filter(([category]) => !mappedCategories.has(category));
    if (unmapped.length) {
      findings.push({
        id: "unmapped-categories",
        title: "Active Item categories are outside company services",
        description: unmapped.map(([category, count]) => `${category} (${count} Item${count === 1 ? "" : "s"})`).slice(0, 3).join(", ") + (unmapped.length > 3 ? `, and ${unmapped.length - 3} more` : ""),
        count: unmapped.length,
        tab: "services",
      });
    }

    const categoriesWithItems = new Set(activeCategoryCounts.keys());
    const emptyCategories = new Set<string>();
    for (const serviceId of SERVICE_IDS) {
      const rule = layout.company.services[serviceId];
      if (rule && !rule.hidden) for (const category of rule.categories) if (!categoriesWithItems.has(category)) emptyCategories.add(category);
    }
    if (emptyCategories.size) {
      const categories = [...emptyCategories].sort((a, b) => a.localeCompare(b, "en-GB"));
      findings.push({
        id: "empty-service-categories",
        title: "Company service categories have no active Items",
        description: categories.slice(0, 3).join(", ") + (categories.length > 3 ? `, and ${categories.length - 3} more` : ""),
        count: categories.length,
        tab: "services",
      });
    }
  }

  return findings;
}

/** In-memory search over the one loaded payload; it performs no network requests. */
export function searchCatalogueOverview(payload: CataloguePayload, query: string, limit = 9): CatalogueOverviewSearchResult[] {
  const term = query.trim().toLocaleLowerCase("en-GB");
  if (!term) return [];

  const results: CatalogueOverviewSearchResult[] = [];
  for (const row of payload.rows) {
    if (`${row.name} ${row.category}`.toLocaleLowerCase("en-GB").includes(term)) {
      results.push({ id: `item:${row.itemId}`, kind: "Item", label: row.name, detail: `${row.category} · ${row.status === "active" ? "Active" : "Archived"} Item`, tab: "items" });
    }
  }

  for (const serviceId of SERVICE_IDS) {
    const label = SERVICE_LABELS[serviceId];
    const rule = payload.serviceLayout?.company.services[serviceId];
    if (`${label} ${(rule?.categories ?? []).join(" ")}`.toLocaleLowerCase("en-GB").includes(term)) {
      const categoryCount = rule?.categories.length;
      results.push({
        id: `service:${serviceId}`,
        kind: "Booking Service",
        label,
        detail: rule ? `${categoryCount} company categor${categoryCount === 1 ? "y" : "ies"}${rule.hidden ? " · hidden by company setting" : ""}` : "Service settings unavailable in this load",
        tab: "services",
      });
    }
  }

  const categoryNames = new Set<string>([
    ...payload.rows.map(row => row.category).filter(Boolean),
    ...SERVICE_IDS.flatMap(id => payload.serviceLayout?.company.services[id]?.categories ?? []),
  ]);
  for (const category of categoryNames) {
    if (category.toLocaleLowerCase("en-GB").includes(term)) {
      const count = payload.rows.filter(row => row.status === "active" && row.category === category).length;
      results.push({ id: `category:${category}`, kind: "Category", label: category, detail: `${count} active Item${count === 1 ? "" : "s"} in this category`, tab: "items" });
    }
  }

  return results.slice(0, limit);
}

export default function HospitalityCatalogueOverview({ payload, onNavigate }: OverviewProps) {
  const [query, setQuery] = useState("");
  const metrics = useMemo(() => deriveCatalogueOverviewMetrics(payload), [payload]);
  const attention = useMemo(() => deriveCatalogueAttention(payload), [payload]);
  const searchResults = useMemo(() => searchCatalogueOverview(payload, query), [payload, query]);
  const categories = [...new Set(payload.rows.filter(row => row.status === "active").map(row => row.category).filter(Boolean))].slice(0, 4);

  return (
    <section className="hco" aria-labelledby="hco-title">
      <header className="hco-header">
        <div>
          <h2 id="hco-title">Hospitality Catalogue</h2>
          <p>Manage what we offer, how customers book it, and where it is available.</p>
        </div>
        {!payload.canManage && <span className="hco-viewonly" role="status">View only</span>}
      </header>

      <div className="hco-metrics" role="group" aria-label="Catalogue summary">
        <Metric icon={<Tag aria-hidden="true" />} value={metrics.activeItems} label="Active Items" detail="Company catalogue" onClick={() => onNavigate("items")} />
        <Metric icon={<Utensils aria-hidden="true" />} value={metrics.activeServices ?? "—"} label="Active Booking Services" detail={metrics.activeServices === null ? "Service settings unavailable" : "Company settings"} onClick={() => onNavigate("services")} />
        <Metric icon={<MapPin aria-hidden="true" />} value={metrics.locationsWithOverrides ?? "—"} label="Locations with custom service settings" detail={metrics.locationsWithOverrides === null ? "Service settings unavailable" : `Of ${metrics.activeLocations} active locations`} onClick={() => onNavigate("locations")} />
        <Metric icon={<ClipboardCheck aria-hidden="true" />} value={metrics.itemsToReview} label="Items to review" detail="Current Item review flags" onClick={() => onNavigate("items")} />
        <Metric icon={<Archive aria-hidden="true" />} value={metrics.archivedItems} label="Archived Items" detail="Retained with history" onClick={() => onNavigate("items")} />
      </div>

      <section className="hco-search" aria-labelledby="hco-search-title">
        <label id="hco-search-title" htmlFor="hco-search-input"><Search size={18} aria-hidden="true" /> Search Items, Booking Services or Categories</label>
        <input id="hco-search-input" type="search" value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" />
        {query.trim() && <div className="hco-search-results" role="region" aria-label="Catalogue search results" aria-live="polite">
          {!searchResults.length ? <p>No matching Items, Booking Services or Categories. Try another search.</p> : <>
            <p>{searchResults.length} result{searchResults.length === 1 ? "" : "s"}. Choose a result to open its catalogue area.</p>
            <ul>{searchResults.map(result => <li key={result.id}>
              <button type="button" onClick={() => onNavigate(result.tab)}>
                <span className="hco-result-kind">{result.kind}</span><strong>{result.label}</strong><small>{result.detail}</small><ArrowRight size={16} aria-hidden="true" />
              </button>
            </li>)}</ul>
          </>}
        </div>}
      </section>

      <div className="hco-management" aria-label="Catalogue management areas">
        <ManagementCard title="Items" icon={<Tag aria-hidden="true" />} description="Products, prices, minimums, production routing and site permission." detail={categories.length ? `Current categories include ${categories.join(", ")}.` : "No active Item categories are loaded."} action="Manage Items" onClick={() => onNavigate("items")} />
        <ManagementCard title="Booking Services" icon={<Utensils aria-hidden="true" />} description="Choose the categories customers can browse in each supported service." detail={metrics.activeServices === null ? "Service configuration is unavailable in this load." : `${metrics.activeServices} of ${SERVICE_IDS.length} supported services are active at company level.`} action="Manage Services" onClick={() => onNavigate("services")} />
        <ManagementCard title="Locations" icon={<MapPin aria-hidden="true" />} description="Review service settings by location and see which settings differ from the company default." detail={`${metrics.activeLocations} active location${metrics.activeLocations === 1 ? "" : "s"}${metrics.locationsWithOverrides === null ? "" : ` · ${metrics.locationsWithOverrides} with custom service settings`}.`} action="Manage Locations" onClick={() => onNavigate("locations")} />
      </div>

      <div className="hco-lower">
        <section className="hco-panel" aria-labelledby="hco-attention-title">
          <h3 id="hco-attention-title"><AlertTriangle size={18} aria-hidden="true" /> Needs attention</h3>
          {attention.length === 0 && payload.serviceLayout ? <p className="hco-empty">No current Item or company service review flags are reported.</p> : null}
          {!payload.serviceLayout && <p className="hco-info"><Info size={16} aria-hidden="true" /> Service settings were not included in this load, so service-category checks are unavailable.</p>}
          {attention.length > 0 && <ul className="hco-attention-list">{attention.slice(0, 5).map(issue => <li key={issue.id}>
            <div><strong>{issue.title}</strong><p>{issue.description}</p></div>
            {issue.count !== undefined && <span className="hco-count">{issue.count}</span>}
            <button type="button" className="hco-link-button" onClick={() => onNavigate(issue.tab)} aria-label={`Review ${issue.title}`}><span>Review</span><ArrowRight size={16} aria-hidden="true" /></button>
          </li>)}</ul>}
        </section>

        <section className="hco-panel hco-how" aria-labelledby="hco-how-title">
          <h3 id="hco-how-title"><Info size={18} aria-hidden="true" /> How it works</h3>
          <p>Services organise the customer journey. Each service contains Categories, and each category can show eligible Items. Locations choose whether to offer a service and may inherit or override the company setup.</p>
          <ol>
            <li><span>1</span><strong>Services</strong><small>Supported booking journeys</small></li>
            <li><span>2</span><strong>Categories</strong><small>Groups within a service</small></li>
            <li><span>3</span><strong>Items</strong><small>Products with their own prices and routing</small></li>
            <li><span>4</span><strong>Locations</strong><small>Availability and local exceptions</small></li>
          </ol>
          <p className="hco-caveat">A service setting alone does not confirm that an Item is permitted, correctly priced, or available through a customer portal.</p>
        </section>
      </div>
    </section>
  );
}

function Metric({ icon, value, label, detail, onClick }: { icon: ReactNode; value: number | string; label: string; detail: string; onClick: () => void }) {
  return <button type="button" className="hco-metric" onClick={onClick}>
    <span className="hco-metric-icon">{icon}</span><span className="hco-metric-main"><strong>{value}</strong><span>{label}</span><small>{detail}</small></span>
  </button>;
}

function ManagementCard({ title, icon, description, detail, action, onClick }: { title: string; icon: ReactNode; description: string; detail: string; action: string; onClick: () => void }) {
  return <article className="hco-card">
    <span className="hco-card-icon">{icon}</span><div className="hco-card-copy"><h3>{title}</h3><p>{description}</p><small>{detail}</small></div>
    <button type="button" onClick={onClick}>{action}<ArrowRight size={16} aria-hidden="true" /></button>
  </article>;
}
