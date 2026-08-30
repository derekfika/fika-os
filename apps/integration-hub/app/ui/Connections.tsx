"use client";
import ConfirmationModal from "./ConfirmationModal";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Coffee,
  ClipboardList,
  Link2,
  MapPinned,
  Package,
  Plus,
  Tags,
  Users,
  UsersRound,
  Wrench,
  X,
  type LucideIcon,
} from "lucide-react";
import CanonicalEditorModal from "./CanonicalEditorModal";
import OperationalAreasPanel from "./OperationalAreasPanel";
import OperationalConfigurationPanel from "./OperationalConfigurationPanel";
import EventStaffingPanel from "./EventStaffingPanel";
import EquipmentTypesPanel from "./EquipmentTypesPanel";
import ServicesWorkspace from "./ServicesWorkspace";
import "./MenuRoutingPanel.css";
import { CPU_PRODUCTION_WORKSTREAM_LABELS, type CpuProductionWorkstream } from "../../../shared/production-workstreams";
import { readCachedManifests, readCachedOverview, revalidateCachedManifests, writeCachedOverview } from "./integration-cache-client";
import type { CacheDataset } from "@/lib/integration-cache-shared";

type Option = { canonicalId: string; label: string };
type Oploc = Option & {
  locationType: string;
  lifecycleState: string;
  areaCount: number;
  serviceCount: number;
  activeConnections: number;
  capabilities: string[];
  providerMappings: ProviderMapping[];
  connectionHealth: "configured" | "setup-needed";
  history: History[];
  clientLabel?: string;
};
type ProviderMapping = {
  mappingId: string;
  sourceProvider: string;
  sourceEntityType: string;
  sourceIdentifier: string;
  sourceLabel?: string;
  mappingStatus: string;
  operationalAreaId?: string;
};
type History = { action: string; timestamp: string; entityReference: string };
type Legend = Option & { terminated: boolean };
type StaffingRole = Option & {
  name: string;
  description?: string;
  active: boolean;
  version: number;
  development: true;
};
type Employment = {
  canonicalId: string;
  legendId: string;
  employmentState: string;
  startDate?: string;
  terminationDate?: string;
  contractualJobTitle?: string;
  readOnlyEvidence: true;
};
type Requirement = {
  canonicalId: string;
  oplocId: string;
  staffingRoleId: string;
  staffingRoleLabel: string;
  requiredHeadcount: number;
  effectiveFrom: string;
  effectiveTo?: string;
  notes?: string;
  activeNow: boolean;
  assigned: number;
  vacancies: number;
  surplus: number;
  assignmentIds: string[];
  version: number;
};
type SiteAssignment = {
  canonicalId: string;
  legendId: string;
  legendLabel: string;
  oplocId: string;
  oplocLabel: string;
  staffingRoleId: string;
  staffingRoleLabel: string;
  effectiveFrom: string;
  effectiveTo?: string;
  primaryLocation: boolean;
  lifecycleState: "active" | "ended";
  activeNow: boolean;
  version: number;
};
type LegacyAssignment = {
  canonicalId: string;
  legendId: string;
  legendLabel: string;
  oplocId: string;
  oplocLabel: string;
  assignmentRole: string;
  designation: string;
  effectiveFrom: string;
  effectiveTo?: string;
  lifecycleState: string;
};
type Overview = {
  today: string;
  legends: Legend[];
  oplocs: Oploc[];
  employments: Employment[];
  assignments: LegacyAssignment[];
  staffingRoles: StaffingRole[];
  siteStaffingRequirements: Requirement[];
  siteRoleAssignments: SiteAssignment[];
  menuItems: MenuProductionItem[];
  siteRoleEstablishment: { developmentAvailable: true; message: string };
};
type MenuProductionItem = {
  canonicalId: string;
  name: string;
  category: string;
  description?: string;
  dietaryInformation?: string[];
  allergenInformation?: string[];
  providerMappings?: Array<{ provider: string; sourceItemId: string; sourceVersion?: string }>;
  version?: number;
  lifecycleState: string;
  publicationStatus: string;
  scopes: Array<{ oplocId: string; label: string; operationalAreaId?: string }>;
  workstreams: CpuProductionWorkstream[];
  sourceIds?: string[];
};

function groupMenuItems(items: MenuProductionItem[]) {
  const grouped = new Map<string, MenuProductionItem>();
  // Prefer an active record as the representative when the same display name
  // has both current and archived site-scoped records.
  for (const item of [...items].sort((a, b) =>
    Number(b.lifecycleState === "active") - Number(a.lifecycleState === "active"),
  )) {
    // Routing is intentionally aligned by human-facing menu name across site
    // records. Canonical records and their site-scoped offerings remain
    // separate; this only keeps production-view visibility consistent.
    const key = item.name.trim().toLocaleLowerCase("en-GB");
    const current = grouped.get(key);
    if (!current) grouped.set(key, { ...item, sourceIds: [item.canonicalId] });
    else
      grouped.set(key, {
        ...current,
        lifecycleState:
          current.lifecycleState === "active" || item.lifecycleState === "active"
            ? "active"
            : item.lifecycleState,
        sourceIds: [...(current.sourceIds || []), item.canonicalId],
        scopes: [...current.scopes, ...item.scopes].filter(
          (scope, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.oplocId === scope.oplocId &&
                candidate.operationalAreaId === scope.operationalAreaId,
            ) === index,
        ),
        workstreams: current.workstreams,
      });
  }
  return [...grouped.values()];
}
type Editor =
  | { kind: "role"; current?: StaffingRole }
  | { kind: "requirement"; current?: Requirement; oplocId: string }
  | {
      kind: "assignment";
      current?: SiteAssignment;
      legendId?: string;
      oplocId?: string;
      staffingRoleId?: string;
    }
  | { kind: "remove-assignment"; current: SiteAssignment };

type SupportedConnectionKind =
  | "area"
  | "requirement"
  | "assignment"
  | "service"
  | "equipment";
export type ConnectionsView =
  | "home"
  | "oplocs"
  | "legends"
  | "areas"
  | "services"
  | "equipment"
  | "equipment-types"
  | "teams"
  | "provider-mappings"
  | "staffing"
  | "hospitality-menu-items";

// This is intentionally a small typed registry, not a generic relationship
// engine. A future governed connection becomes visible here only after its
// model, form, validation and mutation path have been implemented.
const supportedConnectionTypes: ReadonlyArray<{
  kind: SupportedConnectionKind;
  label: string;
  description: string;
  icon: LucideIcon;
  scope: "oploc" | "operational-area" | "both";
  formRoute: string;
  detailSection: string;
  available: (role: string) => boolean;
}> = [
  {
    kind: "area",
    label: "Operational Area",
    description: "Create a subordinate operating context.",
    icon: Building2,
    scope: "oploc",
    formRoute: "operational-area",
    detailSection: "Operational Areas",
    available: (role) => role === "integration-admin",
  },
  {
    kind: "requirement",
    label: "Staffing requirement",
    description: "Set a required role and headcount for this OPLOC.",
    icon: ClipboardList,
    scope: "oploc",
    formRoute: "site-staffing-requirement",
    detailSection: "Legends & Team",
    available: (role) => role === "integration-admin",
  },
  {
    kind: "assignment",
    label: "Legend / site-role assignment",
    description: "Connect an active Legend to a typed role at this OPLOC.",
    icon: Users,
    scope: "oploc",
    formRoute: "site-role-assignment",
    detailSection: "Legends & Team",
    available: (role) => role === "integration-admin",
  },
  {
    kind: "service",
    label: "Service arrangement",
    description: "Enable a governed service at this operational context.",
    icon: Coffee,
    scope: "both",
    formRoute: "service-arrangement",
    detailSection: "Services",
    available: (role) => role === "integration-admin",
  },
  {
    kind: "equipment",
    label: "Equipment allocation",
    description:
      "Allocate a durable equipment asset to this operational context.",
    icon: Wrench,
    scope: "both",
    formRoute: "equipment-allocation",
    detailSection: "Equipment & Assets",
    available: (role) => role === "integration-admin",
  },
];

// The home is deliberately driven from a typed registry. It contains only
// workflows with a concrete record model, screen and governed mutation path.
export const managementTypes: ReadonlyArray<{
  view: ConnectionsView;
  title: string;
  description: string;
  action: string;
  createAction?: string;
  icon: LucideIcon;
  count: (overview: Overview) => number | undefined;
}> = [
  {
    view: "oplocs",
    title: "OPLOCs",
    description:
      "Canonical Operational Locations and their governed local context.",
    action: "View OPLOCs",
    createAction: "Create OPLOC",
    icon: MapPinned,
    count: (overview) => overview.oplocs.length,
  },
  {
    view: "legends",
    title: "Legends",
    description:
      "Working locations, operational roles, teams and event preferences.",
    action: "View Legends",
    icon: Users,
    count: (overview) => overview.legends.length,
  },
  {
    view: "areas",
    title: "Operational Areas",
    description: "Subordinate operating contexts within an OPLOC.",
    action: "Manage Areas",
    createAction: "Add Area",
    icon: Building2,
    count: (overview) =>
      overview.oplocs.reduce((total, oploc) => total + oploc.areaCount, 0),
  },
  {
    view: "services",
    title: "Services",
    description: "Controlled service definitions and their local arrangements.",
    action: "Manage Services",
    createAction: "Add Service",
    icon: Coffee,
    count: (overview) =>
      overview.oplocs.reduce((total, oploc) => total + oploc.serviceCount, 0),
  },
  {
    view: "equipment",
    title: "Equipment & Assets",
    description: "Durable assets and effective-dated local allocations.",
    action: "Manage Equipment",
    createAction: "Add Equipment",
    icon: Package,
    count: () => undefined,
  },
  {
    view: "equipment-types",
    title: "Equipment Types",
    description:
      "Controlled catalogue used when registering durable Equipment Assets.",
    action: "Manage Equipment Types",
    createAction: "Add Equipment Type",
    icon: Tags,
    count: () => undefined,
  },
  {
    view: "teams",
    title: "Teams",
    description:
      "Operational team membership and explicit Event staffing preferences.",
    action: "Manage Teams",
    icon: UsersRound,
    count: () => undefined,
  },
  {
    view: "provider-mappings",
    title: "Provider Mappings",
    description:
      "External mapping evidence; never a competing canonical record.",
    action: "View Mapping Evidence",
    icon: Link2,
    count: (overview) =>
      overview.oplocs.reduce(
        (total, oploc) => total + oploc.providerMappings.length,
        0,
      ),
  },
  {
    view: "staffing",
    title: "Site Staffing",
    description:
      "Governed staffing requirements and effective-dated role assignments.",
    action: "Manage Staffing",
    createAction: "Add Role Requirement",
    icon: ClipboardList,
    count: (overview) =>
      overview.siteRoleAssignments.filter((item) => item.activeNow).length,
  },
  {
    view: "hospitality-menu-items",
    title: "Hospitality Menu Items",
    description:
      "Choose which production dashboard should receive each hospitality menu item.",
    action: "Manage menu routing",
    icon: ClipboardList,
    count: (overview) => overview.menuItems.length,
  },
];

export default function Connections({
  role,
  refreshSession,
}: {
  role: string;
  refreshSession: () => Promise<boolean>;
}) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [view, setView] = useState<ConnectionsView>(() => viewFromUrl());
  const [legendId, setLegendId] = useState("");
  const [oplocId, setOplocId] = useState("");
  const [editor, setEditor] = useState<Editor | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [locationType, setLocationType] = useState("all");
  const [lifecycle, setLifecycle] = useState("active");
  const [client, setClient] = useState("all");
  const [health, setHealth] = useState("all");
  const [capability, setCapability] = useState("all");
  const [createOploc, setCreateOploc] = useState(false);
  const [addConnection, setAddConnection] = useState<string | null>(null);
  const [areaCreateFor, setAreaCreateFor] = useState<string | null>(null);
  const [configurationCreateFor, setConfigurationCreateFor] = useState<{
    kind: "service" | "equipment";
    oplocId: string;
  } | null>(null);
  const navigate = (next: ConnectionsView) => {
    setView(next);
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}?connectionView=${next}`,
    );
  };
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sessionResponse = await fetch("/api/auth/session", { cache: "no-store" });
      if (!sessionResponse.ok) throw new Error("Your FIKA OS session is no longer valid.");
      const session = await sessionResponse.json() as { principal?: { identityId?: string } };
      const identityScope = String(session.principal?.identityId || "anonymous");
      const datasets: CacheDataset[] = ["oplocs", "legends", "serviceDefinitions", "equipmentAssets", "referenceEntities"];
      const cached = await readCachedOverview<Overview>(identityScope).catch(() => undefined);
      const previousManifests = await readCachedManifests().catch(() => []);
      if (cached && previousManifests.length === datasets.length) {
        setOverview(cached);
        setError("");
        setLoading(false);
        void revalidateCachedManifests(datasets).then(async manifests => {
          const unchanged = manifests.every(manifest => previousManifests.find(previous => previous.dataset === manifest.dataset)?.version === manifest.version);
          if (!unchanged) {
            const refreshed = await fetch("/api/connections", { cache: "no-store" });
            if (refreshed.ok) { const next = await refreshed.json() as Overview; setOverview(next); await writeCachedOverview(identityScope, next); }
          }
        }).catch(() => undefined);
        return;
      }
      let response = await fetch("/api/connections", { cache: "no-store" });
      if (response.status === 401 && (await refreshSession()))
        response = await fetch("/api/connections", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message || "Connections could not be loaded.",
        );
      setOverview(body);
      await writeCachedOverview(identityScope, body).catch(() => undefined);
      await revalidateCachedManifests(datasets).catch(() => undefined);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }, [refreshSession]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(command: Record<string, unknown>) {
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const send = () =>
        fetch("/api/connections", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(command),
        });
      let response = await send();
      if (response.status === 401 && (await refreshSession()))
        response = await send();
      const body = await response.json();
      if (!response.ok)
        throw new Error(
          body.error?.message || "The staffing change could not be saved.",
        );
      setOverview(body);
      setEditor(null);
      setSuccess(
        "Staffing updated. Both views now show the latest record. By OPLOC and By Legend now show the same saved relationships.",
      );
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setLoading(false);
    }
  }

  if (loading && !overview) return <p>Loading governed connections…</p>;
  const disabled = loading || role !== "integration-admin";
  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const filteredOplocs =
    overview?.oplocs.filter((oploc) => {
      const query = search.trim().toLocaleLowerCase("en-GB");
      return (
        (!query ||
          `${oploc.label} ${oploc.locationType} ${oploc.capabilities.join(" ")}`
            .toLocaleLowerCase("en-GB")
            .includes(query)) &&
        (locationType === "all" || oploc.locationType === locationType) &&
        (lifecycle === "all" || oploc.lifecycleState === lifecycle) &&
        (client === "all" || (client === "unlinked" && !oploc.clientLabel)) &&
        (health === "all" || oploc.connectionHealth === health) &&
        (capability === "all" || oploc.capabilities.includes(capability))
      );
    }) || [];
  return (
    <>
      <header className="page-heading connections-heading">
        <small>Governed operational configuration</small>
        <h2>
          {view === "home"
            ? "Connections"
            : managementTypes.find((item) => item.view === view)?.title ||
              "Connections"}
        </h2>
        <p>
          {view === "home"
            ? "Start with a record type. Each workspace keeps canonical identity, lifecycle history and governed relationships in one clear place."
            : "Use the focused workspace to configure governed records and relationships without creating parallel identities."}
        </p>
        <div className="actions">
          {view !== "home" && (
            <button onClick={() => navigate("home")}>
              <ChevronLeft /> Back to Connections
            </button>
          )}
          {view === "home" && (
            <button
              className="primary"
              disabled={disabled}
              onClick={() => setCreateOploc(true)}
            >
              <Plus /> Create OPLOC
            </button>
          )}
        </div>
      </header>
      {error && (
        <div className="error">
          <AlertTriangle />
          {error}
        </div>
      )}
      {success && (
        <div className="success">
          <CheckCircle2 />
          {success}
        </div>
      )}
      {overview && view === "home" && (
        <ConnectionsHome
          overview={overview}
          disabled={disabled}
          open={(next) => navigate(next)}
          createOploc={() => setCreateOploc(true)}
        />
      )}
      {overview && view === "oplocs" && (
        <OplocDirectory
          overview={overview}
          oplocs={filteredOplocs}
          expanded={expanded}
          toggle={toggle}
          expandAll={() =>
            setExpanded(
              new Set(filteredOplocs.map((oploc) => oploc.canonicalId)),
            )
          }
          collapseAll={() => setExpanded(new Set())}
          search={search}
          setSearch={setSearch}
          locationType={locationType}
          setLocationType={setLocationType}
          lifecycle={lifecycle}
          setLifecycle={setLifecycle}
          client={client}
          setClient={setClient}
          health={health}
          setHealth={setHealth}
          capability={capability}
          setCapability={setCapability}
          edit={setEditor}
          disabled={disabled}
          openAdd={setAddConnection}
          areaCreateFor={areaCreateFor}
          clearAreaCreate={() => setAreaCreateFor(null)}
          configurationCreateFor={configurationCreateFor}
          clearConfigurationCreate={() => setConfigurationCreateFor(null)}
          refreshSession={refreshSession}
          manageEquipmentTypes={() => navigate("equipment-types")}
        />
      )}
      {overview && view === "legends" && (
        <ByLegend
          overview={overview}
          legendId={legendId}
          chooseLegend={setLegendId}
          edit={setEditor}
          disabled={disabled}
          refreshSession={refreshSession}
        />
      )}
      {overview &&
        [
          "areas",
          "services",
          "equipment",
          "equipment-types",
          "staffing",
          "teams",
          "provider-mappings",
          "hospitality-menu-items",
        ].includes(view) && (
          <FocusedConnectionScreen
            view={
              view as Exclude<ConnectionsView, "home" | "oplocs" | "legends">
            }
            overview={overview}
            legendId={legendId}
            setLegendId={setLegendId}
            oplocId={oplocId}
            setOplocId={setOplocId}
            disabled={disabled}
            edit={setEditor}
            refreshSession={refreshSession}
            reloadOverview={load}
            navigate={navigate}
          />
        )}
      {overview && editor?.kind === "role" && (
        <RoleModal
          current={editor.current}
          close={() => setEditor(null)}
          save={save}
          disabled={disabled}
        />
      )}
      {overview && editor?.kind === "requirement" && (
        <RequirementModal
          overview={overview}
          oplocId={editor.oplocId}
          current={editor.current}
          close={() => setEditor(null)}
          save={save}
          disabled={disabled}
        />
      )}
      {overview && editor?.kind === "assignment" && (
        <AssignmentModal
          overview={overview}
          current={editor.current}
          fixedLegendId={editor.legendId}
          fixedOplocId={editor.oplocId}
          fixedRoleId={editor.staffingRoleId}
          close={() => setEditor(null)}
          remove={(current) =>
            setEditor({ kind: "remove-assignment", current })
          }
          save={save}
          disabled={disabled}
        />
      )}
      {editor?.kind === "remove-assignment" && (
        <RemoveAssignmentModal
          current={editor.current}
          close={() => setEditor(null)}
          save={save}
          disabled={disabled}
        />
      )}
      {overview && addConnection && (
        <ConnectionChooser
          oploc={
            overview.oplocs.find(
              (oploc) => oploc.canonicalId === addConnection,
            )!
          }
          close={() => setAddConnection(null)}
          choose={(kind) => {
            setAddConnection(null);
            if (kind === "area") setAreaCreateFor(addConnection);
            if (kind === "requirement")
              setEditor({ kind: "requirement", oplocId: addConnection });
            if (kind === "assignment")
              setEditor({ kind: "assignment", oplocId: addConnection });
            if (kind === "service" || kind === "equipment")
              setConfigurationCreateFor({ kind, oplocId: addConnection });
          }}
        />
      )}
      {createOploc && (
        <CanonicalEditorModal
          initialEntityType="OPLOC"
          refreshSession={refreshSession}
          close={() => setCreateOploc(false)}
          saved={async () => {
            setCreateOploc(false);
            await load();
          }}
        />
      )}
    </>
  );
}

function ConnectionsHome({
  overview,
  disabled,
  open,
  createOploc,
}: {
  overview: Overview;
  disabled: boolean;
  open: (view: ConnectionsView) => void;
  createOploc: () => void;
}) {
  return (
    <section className="connections-home" aria-label="Connection workspaces">
      <div className="connections-home__intro">
        <span>Record-first control centre</span>
        <p>
          Choose a governed workspace. Provider evidence remains separate, and
          no workflow creates a generic connection record.
        </p>
      </div>
      <div className="connection-home-grid">
        {managementTypes.map((item) => {
          const count = item.count(overview);
          const Icon = item.icon;
          return (
            <article className="connection-home-card" key={item.view}>
              <Icon aria-hidden="true" />
              <div>
                <h3>{item.title}</h3>
                <p>{item.description}</p>
                {count !== undefined && (
                  <span className="connection-home-card__count">
                    {count} record{count === 1 ? "" : "s"}
                  </span>
                )}
              </div>
              <footer>
                <button className="primary" onClick={() => open(item.view)}>
                  {item.action}
                </button>
                {item.createAction && (
                  <button
                    disabled={disabled}
                    onClick={() =>
                      item.view === "oplocs" ? createOploc() : open(item.view)
                    }
                  >
                    {item.createAction}
                  </button>
                )}
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function FocusedConnectionScreen({
  view,
  overview,
  legendId,
  setLegendId,
  oplocId,
  setOplocId,
  disabled,
  edit,
  refreshSession,
  reloadOverview,
  navigate,
}: {
  view: Exclude<ConnectionsView, "home" | "oplocs" | "legends">;
  overview: Overview;
  legendId: string;
  setLegendId: (value: string) => void;
  oplocId: string;
  setOplocId: (value: string) => void;
  disabled: boolean;
  edit: (editor: Editor) => void;
  refreshSession: () => Promise<boolean>;
  reloadOverview: () => Promise<void>;
  navigate: (view: ConnectionsView) => void;
}) {
  if (view === "equipment-types")
    return (
      <EquipmentTypesPanel
        canManage={!disabled}
        refreshSession={refreshSession}
      />
    );
  if (view === "hospitality-menu-items")
    return (
      <HospitalityMenuProductionRoutingPanel
        items={overview.menuItems}
        canManage={!disabled}
        refreshSession={refreshSession}
        reloadOverview={reloadOverview}
      />
    );
  if (view === "services")
    return (
      <ServicesWorkspace
        canManage={!disabled}
        refreshSession={refreshSession}
      />
    );
  if (view === "provider-mappings")
    return <ProviderMappingsDirectory overview={overview} />;
  if (view === "teams")
    return (
      <section className="connection-workspace">
        <SearchableSelector
          label="Legend"
          options={overview.legends.filter((legend) => !legend.terminated)}
          value={legendId}
          onChange={setLegendId}
          placeholder="Search Legends"
        />
        {legendId ? (
          <EventStaffingPanel
            legendId={legendId}
            legendLabel={
              overview.legends.find((legend) => legend.canonicalId === legendId)
                ?.label || "Legend"
            }
            canManage={!disabled}
            refreshSession={refreshSession}
          />
        ) : (
          <p className="empty">
            Choose an active Legend to manage team membership and Event staffing
            preferences.
          </p>
        )}
      </section>
    );
  if (view === "staffing")
    return (
      <ByOploc
        overview={overview}
        oplocId={oplocId}
        chooseOploc={setOplocId}
        edit={edit}
        disabled={disabled}
      />
    );
  const title = view === "areas" ? "Operational Areas" : "Equipment & Assets";
  return (
    <section className="connection-workspace focused-connection-workspace">
      <OplocScopeDirectory
        title={title}
        view={view}
        oplocs={overview.oplocs}
        value={oplocId}
        onChange={setOplocId}
      />
      {!oplocId ? (
        <p className="empty">
          Choose an OPLOC to view its {title.toLocaleLowerCase("en-GB")} in
          canonical context.
        </p>
      ) : view === "areas" ? (
        <OperationalAreasPanel
          oplocId={oplocId}
          canManage={!disabled}
          refreshSession={refreshSession}
        />
      ) : (
        <OperationalConfigurationPanel
          oplocId={oplocId}
          section="equipment"
          canManage={!disabled}
          refreshSession={refreshSession}
          manageEquipmentTypes={() => navigate("equipment-types")}
        />
      )}
    </section>
  );
}

function HospitalityMenuProductionRoutingPanel({
  items,
  canManage,
  refreshSession,
  reloadOverview,
}: {
  items: MenuProductionItem[];
  canManage: boolean;
  refreshSession: () => Promise<boolean>;
  reloadOverview: () => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<
    Record<string, CpuProductionWorkstream[]>
  >(() =>
    Object.fromEntries(items.map((item) => [item.canonicalId, item.workstreams])),
  );
  const [saving, setSaving] = useState("");
  const [message, setMessage] = useState("");
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editor, setEditor] = useState<MenuProductionItem | "new" | null>(null);
  const [confirmation, setConfirmation] = useState<MenuProductionItem | null>(null);
  const [form, setForm] = useState({ name: "", category: "", description: "", lifecycleState: "active" as "active" | "archived" });
  useEffect(() => {
    setDraft(
      Object.fromEntries(items.map((item) => [item.canonicalId, item.workstreams])),
    );
  }, [items]);
  const visible = groupMenuItems(items.filter((item) => includeArchived || item.lifecycleState !== "archived")).filter((item) =>
    `${item.name} ${item.category} ${item.canonicalId} ${(item.sourceIds || []).join(" ")}`
      .toLocaleLowerCase("en-GB")
      .includes(query.trim().toLocaleLowerCase("en-GB")),
  );
  function openEditor(item: MenuProductionItem | "new") {
    setEditor(item);
    setForm(item === "new" ? { name: "", category: "", description: "", lifecycleState: "active" } : { name: item.name, category: item.category, description: item.description || "", lifecycleState: item.lifecycleState === "archived" ? "archived" : "active" });
    setMessage("");
  }
  async function postCatalogue(payload: Record<string, unknown>) {
    const send = () =>
      fetch("/api/hospitality-menu/catalogue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
    let response = await send();
    if (response.status === 401 && (await refreshSession())) response = await send();
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error?.message || "The menu item could not be saved.");
    return body;
  }
  async function saveCatalogue() {
    if (!editor || !form.name.trim() || !form.category.trim()) return;
    setSaving("catalogue"); setMessage("");
    try {
      const source = editor === "new" ? undefined : editor;
      await postCatalogue({
        ...(source ? { canonicalId: source.canonicalId, expectedVersion: source.version || 1 } : {}),
        name: form.name.trim(), category: form.category.trim(), description: form.description.trim() || undefined,
        lifecycleState: form.lifecycleState, dietaryInformation: source?.dietaryInformation || [], allergenInformation: source?.allergenInformation || [], providerMappings: source?.providerMappings || [],
      });
      setEditor(null); await refreshSession(); await reloadOverview(); setMessage("Menu item saved.");
    } catch (error) { setMessage((error as Error).message); } finally { setSaving(""); }
  }
  async function setLifecycle(item: MenuProductionItem) {
    const action = item.lifecycleState === "archived" ? "restore" : "archive";
    setSaving(item.canonicalId); setMessage("");
    try {
      await postCatalogue({ canonicalId: item.canonicalId, expectedVersion: item.version || 1, name: item.name, category: item.category, description: item.description || undefined, lifecycleState: item.lifecycleState === "archived" ? "active" : "archived", dietaryInformation: item.dietaryInformation || [], allergenInformation: item.allergenInformation || [], providerMappings: item.providerMappings || [] });
      await refreshSession(); await reloadOverview(); setConfirmation(null); setMessage(`${item.name} ${item.lifecycleState === "archived" ? "restored" : "archived"}.`);
    } catch (error) { setMessage((error as Error).message); } finally { setSaving(""); }
  }
  const toggle = (id: string, workstream: CpuProductionWorkstream) =>
    setDraft((current) => {
      const selected = current[id] || [];
      const next = selected.includes(workstream)
        ? selected.filter((value) => value !== workstream)
        : [...selected, workstream];
      return { ...current, [id]: next };
    });
  async function save(item: MenuProductionItem) {
    setSaving(item.canonicalId);
    setMessage("");
    try {
      for (const menuItemId of item.sourceIds || [item.canonicalId]) {
        const send = () =>
          fetch("/api/connections", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              action: "save-hospitality-menu-production-routing",
              menuItemId,
              workstreams: draft[menuItemId] || draft[item.canonicalId] || [],
            }),
          });
        let response = await send();
        if (response.status === 401 && (await refreshSession()))
          response = await send();
        const body = await response.json();
        if (!response.ok)
          throw new Error(
            body.error?.message ||
              "The production view routing could not be saved.",
          );
      }
      setMessage(
        `${item.name} routing saved for ${(item.sourceIds || [item.canonicalId]).length} canonical record${(item.sourceIds || [item.canonicalId]).length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setSaving("");
    }
  }
  return (
    <section className="connection-workspace menu-routing-workspace">
      <div className="connection-workspace__intro">
        <span>Production view routing</span>
        <p>
          One row is shown per menu name to make setup quick. Site offerings
          remain separate, and saving a row applies the chosen visibility to
          every matching canonical record.
        </p>
      </div>
      <label className="connection-search">
        Search menu items
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Name, category or canonical ID"
        />
      </label>
      <div className="menu-routing-toolbar">
        <button className="primary" type="button" disabled={!canManage} onClick={() => openEditor("new")}>Add menu item</button>
        <label><input type="checkbox" checked={includeArchived} onChange={(event) => setIncludeArchived(event.target.checked)} /> Include archived</label>
      </div>
      {message && (
        <p className="form-help" role="status">
          {message}
        </p>
      )}
      {visible.length ? (
        <div className="menu-routing-list">
          {visible.map((item) => {
            const selected = draft[item.canonicalId] || [];
            return (
              <article className="menu-routing-row" key={item.canonicalId}>
                <div>
                  <h3>{item.name}</h3>
                  <p>
                    {item.category} · {item.lifecycleState} ·{" "}
                    {item.publicationStatus}
                  </p>
                  <div className="menu-routing-scopes">
                    <strong>Site availability</strong>
                    {item.scopes.length ? (
                      item.scopes.map((scope) => (
                        <span
                          key={`${scope.oplocId}:${scope.operationalAreaId || "wide"}`}
                        >
                          {scope.label}
                          {scope.operationalAreaId
                            ? " · area-scoped"
                            : " · OPLOC-wide"}
                        </span>
                      ))
                    ) : (
                      <span>
                        Canonical item only — no linked site offering yet
                      </span>
                    )}
                  </div>
                  <details>
                    <summary>Technical details</summary>
                    <p>Canonical Menu Item ID(s)</p>
                    <code>
                      {(item.sourceIds || [item.canonicalId]).join(" · ")}
                    </code>
                  </details>
                </div>
                  <div className="menu-routing-actions">
                    <button type="button" className="secondary" disabled={!canManage} onClick={() => openEditor(item)}>Edit</button>
                    <button type="button" className="danger" disabled={!canManage || saving === item.canonicalId} onClick={() => setConfirmation(item)}>{item.lifecycleState === "archived" ? "Restore" : "Archive"}</button>
                  </div>
                  <fieldset
                  disabled={!canManage || item.lifecycleState === "archived"}
                >
                  <legend>Production visibility</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes("sandwiches")}
                      onChange={() => toggle(item.canonicalId, "sandwiches")}
                    />{" "}
                    {CPU_PRODUCTION_WORKSTREAM_LABELS.sandwiches}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes("hospitality")}
                      onChange={() => toggle(item.canonicalId, "hospitality")}
                    />{" "}
                    {CPU_PRODUCTION_WORKSTREAM_LABELS.hospitality}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.includes("delivered_in")}
                      onChange={() => toggle(item.canonicalId, "delivered_in")}
                    />{" "}
                    {CPU_PRODUCTION_WORKSTREAM_LABELS.delivered_in}
                  </label>
                  <button
                    className="primary"
                    type="button"
                    disabled={saving === item.canonicalId}
                    onClick={() => void save(item)}
                  >
                    {saving === item.canonicalId ? "Saving…" : "Save routing"}
                  </button>
                </fieldset>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="empty">No Hospitality Menu Items match this search.</p>
      )}
      <p className="form-help">
        Site-manager-only items are excluded from both production-chef views.
        Matching names are grouped for setup only; their canonical records and
        site offerings are not merged.
      </p>
      {confirmation && <ConfirmationModal title={`${confirmation.lifecycleState === "archived" ? "Restore" : "Archive"} ${confirmation.name}?`} description={confirmation.lifecycleState === "archived" ? "It will become available for new portal selections again." : "It will disappear from new portal selections, while history and source evidence are retained."} confirmLabel={confirmation.lifecycleState === "archived" ? "Restore menu item" : "Archive menu item"} destructive={confirmation.lifecycleState !== "archived"} busy={saving === confirmation.canonicalId} onCancel={() => setConfirmation(null)} onConfirm={() => setLifecycle(confirmation)} />}
      {editor && <div className="menu-item-editor" role="dialog" aria-modal="true">
        <div className="menu-item-editor__panel">
          <h2>{editor === "new" ? "Add menu item" : "Edit menu item"}</h2>
          <label>Name<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
          <label>Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} /></label>
          <label>Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <p className="form-help">Imported provider evidence and canonical IDs are preserved. Archive removes an item from new portal choices without deleting history.</p>
          <div><button type="button" className="secondary" onClick={() => setEditor(null)}>Cancel</button> <button type="button" className="primary" disabled={saving === "catalogue"} onClick={() => void saveCatalogue()}>Save item</button></div>
        </div>
      </div>}
    </section>
  );
}

function OplocScopeDirectory({
  title,
  view,
  oplocs,
  value,
  onChange,
}: {
  title: string;
  view: "areas" | "services" | "equipment";
  oplocs: Oploc[];
  value: string;
  onChange: (value: string) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = oplocs
    .filter((oploc) =>
      `${oploc.label} ${oploc.locationType}`
        .toLocaleLowerCase("en-GB")
        .includes(query.trim().toLocaleLowerCase("en-GB")),
    )
    .slice(0, 30);
  const metric = (oploc: Oploc) =>
    view === "areas"
      ? `${oploc.areaCount} area${oploc.areaCount === 1 ? "" : "s"}`
      : view === "services"
        ? `${oploc.serviceCount} service${oploc.serviceCount === 1 ? "" : "s"}`
        : "Open asset register";
  return (
    <>
      <div className="connection-filters connection-filters--simple">
        <label>
          Search {title}
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search Operational Locations"
          />
        </label>
      </div>
      <SearchableSelector
        label="Selected Operational Location"
        options={oplocs}
        value={value}
        onChange={onChange}
        placeholder="Search OPLOCs"
      />
      <div className="scoped-oploc-list">
        {filtered.map((oploc) => (
          <button
            key={oploc.canonicalId}
            className={value === oploc.canonicalId ? "selected" : ""}
            onClick={() => onChange(oploc.canonicalId)}
          >
            <span>
              <b>{oploc.label}</b>
              <small>
                {oploc.locationType} · {oploc.lifecycleState}
              </small>
            </span>
            <em>{metric(oploc)}</em>
          </button>
        ))}
      </div>
    </>
  );
}

function ProviderMappingsDirectory({ overview }: { overview: Overview }) {
  const [query, setQuery] = useState("");
  const mappings = overview.oplocs
    .flatMap((oploc) =>
      oploc.providerMappings.map((mapping) => ({
        ...mapping,
        oplocId: oploc.canonicalId,
        oplocLabel: oploc.label,
      })),
    )
    .filter((mapping) =>
      `${mapping.oplocLabel} ${mapping.sourceProvider} ${mapping.sourceEntityType} ${mapping.sourceIdentifier} ${mapping.sourceLabel || ""}`
        .toLocaleLowerCase("en-GB")
        .includes(query.trim().toLocaleLowerCase("en-GB")),
    );
  return (
    <section className="connection-workspace">
      <div className="connection-filters connection-filters--simple">
        <label>
          Search mapping evidence
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Provider, source label or OPLOC"
          />
        </label>
      </div>
      <p className="form-help">
        {mappings.length} external mapping record
        {mappings.length === 1 ? "" : "s"}. These are provider evidence, not
        canonical identities.
      </p>
      {mappings.length ? (
        <div className="connection-list">
          {mappings.map((mapping) => (
            <article className="connection-row" key={mapping.mappingId}>
              <Link2 />
              <div>
                <b>{mapping.sourceLabel || mapping.sourceIdentifier}</b>
                <span>
                  {mapping.sourceProvider} · {mapping.sourceEntityType} ·{" "}
                  {mapping.mappingStatus}
                </span>
                <small>Resolves in OPLOC context: {mapping.oplocLabel}</small>
              </div>
              <details>
                <summary>Technical details</summary>
                <p>{mapping.mappingId}</p>
                <p>{mapping.oplocId}</p>
                <p>{mapping.sourceIdentifier}</p>
              </details>
            </article>
          ))}
        </div>
      ) : (
        <p className="empty">
          No provider mapping evidence matches this search.
        </p>
      )}
    </section>
  );
}

function viewFromUrl(): ConnectionsView {
  if (typeof window === "undefined") return "home";
  const value = new URLSearchParams(window.location.search).get(
    "connectionView",
  );
  return managementTypes.some((item) => item.view === value)
    ? (value as ConnectionsView)
    : "home";
}

function OplocDirectory({
  overview,
  oplocs,
  expanded,
  toggle,
  expandAll,
  collapseAll,
  search,
  setSearch,
  locationType,
  setLocationType,
  lifecycle,
  setLifecycle,
  client,
  setClient,
  health,
  setHealth,
  capability,
  setCapability,
  edit,
  disabled,
  openAdd,
  areaCreateFor,
  clearAreaCreate,
  configurationCreateFor,
  clearConfigurationCreate,
  refreshSession,
  manageEquipmentTypes,
}: {
  overview: Overview;
  oplocs: Oploc[];
  expanded: Set<string>;
  toggle: (id: string) => void;
  expandAll: () => void;
  collapseAll: () => void;
  search: string;
  setSearch: (value: string) => void;
  locationType: string;
  setLocationType: (value: string) => void;
  lifecycle: string;
  setLifecycle: (value: string) => void;
  client: string;
  setClient: (value: string) => void;
  health: string;
  setHealth: (value: string) => void;
  capability: string;
  setCapability: (value: string) => void;
  edit: (editor: Editor) => void;
  disabled: boolean;
  openAdd: (id: string) => void;
  areaCreateFor: string | null;
  clearAreaCreate: () => void;
  configurationCreateFor: {
    kind: "service" | "equipment";
    oplocId: string;
  } | null;
  clearConfigurationCreate: () => void;
  refreshSession: () => Promise<boolean>;
  manageEquipmentTypes: () => void;
}) {
  const types = [
    ...new Set(
      overview.oplocs.map((oploc) => oploc.locationType).filter(Boolean),
    ),
  ];
  const capabilities = [
    ...new Set(overview.oplocs.flatMap((oploc) => oploc.capabilities)),
  ];
  const reset = () => {
    setSearch("");
    setLocationType("all");
    setLifecycle("active");
    setClient("all");
    setHealth("all");
    setCapability("all");
  };
  return (
    <section className="connection-workspace oploc-directory">
      <div className="connection-filters">
        <label>
          Search OPLOCs
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Name, type or capability"
          />
        </label>
        <label>
          Lifecycle
          <select
            value={lifecycle}
            onChange={(event) => setLifecycle(event.target.value)}
          >
            <option value="active">Active</option>
          </select>
        </label>
        <label>
          Client
          <select
            value={client}
            onChange={(event) => setClient(event.target.value)}
          >
            <option value="all">All client states</option>
            <option value="unlinked">No client link</option>
          </select>
        </label>
        <label>
          Location type
          <select
            value={locationType}
            onChange={(event) => setLocationType(event.target.value)}
          >
            <option value="all">All types</option>
            {types.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label>
          Connection health
          <select
            value={health}
            onChange={(event) => setHealth(event.target.value)}
          >
            <option value="all">All</option>
            <option value="configured">Configured</option>
            <option value="setup-needed">Setup needed</option>
          </select>
        </label>
        <label>
          Enabled capability
          <select
            value={capability}
            onChange={(event) => setCapability(event.target.value)}
          >
            <option value="all">All capabilities</option>
            {capabilities.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className="actions">
          <button onClick={reset}>Reset filters</button>
          <button onClick={expandAll}>Expand all</button>
          <button onClick={collapseAll}>Collapse all</button>
        </div>
      </div>
      <p className="form-help">
        {oplocs.length} active Operational Location
        {oplocs.length === 1 ? "" : "s"}. Client relationship, Contacts and
        documents will appear here when their governed Hub models are available.
      </p>
      {oplocs.map((oploc) => (
        <article className="oploc-connection-card" key={oploc.canonicalId}>
          <button
            className="oploc-connection-summary"
            onClick={() => toggle(oploc.canonicalId)}
            aria-expanded={expanded.has(oploc.canonicalId)}
          >
            {expanded.has(oploc.canonicalId) ? (
              <ChevronDown />
            ) : (
              <ChevronRight />
            )}
            <span>
              <b>{oploc.label}</b>
              <small>
                {oploc.locationType} · {oploc.lifecycleState} ·{" "}
                {oploc.areaCount} area{oploc.areaCount === 1 ? "" : "s"} ·{" "}
                {oploc.serviceCount} services · {oploc.activeConnections} active
                connections
              </small>
            </span>
            <span
              className={`status status--${oploc.connectionHealth === "configured" ? "approved" : "partial"}`}
            >
              {oploc.connectionHealth === "configured"
                ? "Configured"
                : "Setup needed"}
            </span>
          </button>
          {expanded.has(oploc.canonicalId) && (
            <OplocExpanded
              overview={overview}
              oploc={oploc}
              edit={edit}
              disabled={disabled}
              openAdd={openAdd}
              openAreaCreate={areaCreateFor === oploc.canonicalId}
              clearAreaCreate={clearAreaCreate}
              configurationCreateFor={configurationCreateFor}
              clearConfigurationCreate={clearConfigurationCreate}
              refreshSession={refreshSession}
            />
          )}
        </article>
      ))}
    </section>
  );
}

function OplocExpanded({
  overview,
  oploc,
  edit,
  disabled,
  openAdd,
  openAreaCreate,
  clearAreaCreate,
  configurationCreateFor,
  clearConfigurationCreate,
  refreshSession,
  manageEquipmentTypes,
}: {
  overview: Overview;
  oploc: Oploc;
  edit: (editor: Editor) => void;
  disabled: boolean;
  openAdd: (id: string) => void;
  openAreaCreate: boolean;
  clearAreaCreate: () => void;
  configurationCreateFor: {
    kind: "service" | "equipment";
    oplocId: string;
  } | null;
  clearConfigurationCreate: () => void;
  refreshSession: () => Promise<boolean>;
  manageEquipmentTypes?: () => void;
}) {
  return (
    <div className="oploc-connection-expanded">
      <section className="connection-section">
        <header>
          <h3>Overview</h3>
          <button
            className="connection-action"
            onClick={() => openAdd(oploc.canonicalId)}
            disabled={disabled}
          >
            <Plus /> Add connection
          </button>
        </header>
        <p>
          <b>Canonical OPLOC:</b> {oploc.canonicalId}
        </p>
        <p>
          <b>Client:</b>{" "}
          {oploc.clientLabel ||
            "No client relationship modelled in this local Hub yet."}
        </p>
        <p>
          <b>Capabilities:</b>{" "}
          {oploc.capabilities.length
            ? oploc.capabilities.join(", ")
            : "None enabled"}
        </p>
      </section>
      <section className="connection-section">
        <header>
          <h3>Legends & Team</h3>
          <span>
            {
              overview.siteRoleAssignments.filter(
                (item) => item.oplocId === oploc.canonicalId && item.activeNow,
              ).length
            }{" "}
            active
          </span>
        </header>
        <ByOploc
          overview={overview}
          oplocId={oploc.canonicalId}
          chooseOploc={() => undefined}
          edit={edit}
          disabled={disabled}
          embedded
        />
      </section>
      <section className="connection-section">
        <header>
          <h3>Operational Areas ({oploc.areaCount})</h3>
        </header>
        <OperationalAreasPanel
          oplocId={oploc.canonicalId}
          canManage={!disabled}
          refreshSession={refreshSession}
          openCreateSignal={openAreaCreate ? 1 : 0}
          onCreateHandled={clearAreaCreate}
        />
      </section>
      <OperationalConfigurationPanel
        oplocId={oploc.canonicalId}
        section="services"
        canManage={!disabled}
        refreshSession={refreshSession}
        openCreateSignal={
          configurationCreateFor?.oplocId === oploc.canonicalId &&
          configurationCreateFor.kind === "service"
            ? 1
            : 0
        }
        onCreateHandled={clearConfigurationCreate}
      />
      <OperationalConfigurationPanel
        oplocId={oploc.canonicalId}
        section="equipment"
        canManage={!disabled}
        refreshSession={refreshSession}
        openCreateSignal={
          configurationCreateFor?.oplocId === oploc.canonicalId &&
          configurationCreateFor.kind === "equipment"
            ? 1
            : 0
        }
        onCreateHandled={clearConfigurationCreate}
      />
      <section className="connection-section">
        <h3>Provider Mappings ({oploc.providerMappings.length})</h3>
        {oploc.providerMappings.length ? (
          oploc.providerMappings.map((mapping) => (
            <article className="connection-row" key={mapping.mappingId}>
              <div>
                <b>{mapping.sourceProvider}</b>
                <span>
                  {mapping.sourceLabel || mapping.sourceIdentifier} ·{" "}
                  {mapping.mappingStatus}
                  {mapping.operationalAreaId
                    ? " · associated with an Operational Area"
                    : " · OPLOC-level"}
                </span>
                <small>External provider evidence</small>
              </div>
              <details>
                <summary>Technical details</summary>
                <p>{mapping.sourceIdentifier}</p>
                <p>{mapping.operationalAreaId || oploc.canonicalId}</p>
              </details>
            </article>
          ))
        ) : (
          <p>
            No provider mappings yet — add one when a governed source-mapping
            review is available.
          </p>
        )}
      </section>
      <EmptyConnectionSection
        title="Contacts & Responsibilities"
        text="No client-contact or responsibility-link model is available in this local Hub yet."
      />
      <section className="connection-section">
        <h3>Operational Configuration</h3>
        <p>
          {oploc.capabilities.length
            ? `Enabled capabilities: ${oploc.capabilities.join(", ")}`
            : "No capability enablements."}
        </p>
        <p className="form-help">
          Opening hours, documents and instructions remain attached only where
          their governed configuration models exist.
        </p>
      </section>
      <section className="connection-section">
        <h3>History</h3>
        {oploc.history.length ? (
          oploc.history.map((item) => (
            <p key={`${item.timestamp}:${item.entityReference}`}>
              <b>{item.action}</b> · {item.timestamp}
            </p>
          ))
        ) : (
          <p>No local audit history is available for this OPLOC.</p>
        )}
      </section>
    </div>
  );
}

function EmptyConnectionSection({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <section className="connection-section">
      <h3>{title}</h3>
      <p className="form-help">{text}</p>
    </section>
  );
}

function ConnectionChooser({
  oploc,
  close,
  choose,
}: {
  oploc: Oploc;
  close: () => void;
  choose: (kind: SupportedConnectionKind) => void;
}) {
  return (
    <Modal title={`Add connection — ${oploc.label}`} close={close}>
      <p>
        Choose a supported typed connection. The Hub will not create
        unstructured generic records.
      </p>
      <div className="connection-list">
        {supportedConnectionTypes
          .filter(
            (connection) =>
              connection.scope !== "operational-area" &&
              connection.available("integration-admin"),
          )
          .map((connection) => (
            <button
              key={connection.kind}
              onClick={() => choose(connection.kind)}
            >
              <connection.icon /> <b>{connection.label}</b>
              <span>{connection.description}</span>
            </button>
          ))}
      </div>
      <p className="form-help">
        Contact/responsibility links, documents, opening hours, capability
        configuration and provider-mapping creation remain unavailable until
        their governed models and forms exist.
      </p>
    </Modal>
  );
}

function ByOploc({
  overview,
  oplocId,
  chooseOploc,
  edit,
  disabled,
  embedded = false,
}: {
  overview: Overview;
  oplocId: string;
  chooseOploc: (value: string) => void;
  edit: (editor: Editor) => void;
  disabled: boolean;
  embedded?: boolean;
}) {
  const requirements = overview.siteStaffingRequirements.filter(
    (item) => item.oplocId === oplocId && item.activeNow,
  );
  const history = overview.siteRoleAssignments.filter(
    (item) => item.oplocId === oplocId && !item.activeNow,
  );
  return (
    <section className="connection-workspace">
      {!embedded && (
        <SearchableSelector
          label="Operational Location"
          options={overview.oplocs}
          value={oplocId}
          onChange={chooseOploc}
          placeholder="Search OPLOCs"
        />
      )}
      {!oplocId ? (
        <p className="empty">
          Choose an OPLOC to configure its development staffing structure.
        </p>
      ) : (
        <>
          <div className="staffing-toolbar">
            <div>
              <b>Site Staffing</b>
              <span>Development records · immediately usable</span>
            </div>
            <button onClick={() => edit({ kind: "role" })} disabled={disabled}>
              Create staffing role
            </button>
            <button
              className="primary"
              onClick={() => edit({ kind: "requirement", oplocId })}
              disabled={disabled}
            >
              <Plus />
              Add role requirement
            </button>
          </div>
          <details className="staffing-role-catalogue">
            <summary>
              Staffing role catalogue ({overview.staffingRoles.length})
            </summary>
            {overview.staffingRoles.length ? (
              overview.staffingRoles.map((role) => (
                <article className="connection-row" key={role.canonicalId}>
                  <div>
                    <b>{role.name}</b>
                    <span>
                      {role.description || "No description"} ·{" "}
                      {role.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <button onClick={() => edit({ kind: "role", current: role })}>
                    Edit
                  </button>
                  <details>
                    <summary>Technical details</summary>
                    <p>{role.canonicalId}</p>
                    <p>Development model</p>
                  </details>
                </article>
              ))
            ) : (
              <p>No staffing roles have been created.</p>
            )}
          </details>
          <div className="table-wrap staffing-table">
            <table>
              <thead>
                <tr>
                  <th>Role</th>
                  <th>Required</th>
                  <th>Assigned Legends</th>
                  <th>Vacant / Surplus</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {requirements.length ? (
                  requirements.map((requirement) => {
                    const assigned = overview.siteRoleAssignments.filter(
                      (assignment) =>
                        requirement.assignmentIds.includes(
                          assignment.canonicalId,
                        ),
                    );
                    return (
                      <tr key={requirement.canonicalId}>
                        <td>
                          <b>{requirement.staffingRoleLabel}</b>
                          {requirement.notes && (
                            <small>{requirement.notes}</small>
                          )}
                        </td>
                        <td>{requirement.requiredHeadcount}</td>
                        <td>
                          {assigned.length ? (
                            <ul className="compact-assignees">
                              {assigned.map((assignment) => (
                                <li key={assignment.canonicalId}>
                                  <button
                                    onClick={() =>
                                      edit({
                                        kind: "assignment",
                                        current: assignment,
                                      })
                                    }
                                  >
                                    {assignment.legendLabel}
                                    {assignment.primaryLocation
                                      ? " · Primary"
                                      : ""}
                                  </button>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            "None assigned"
                          )}
                        </td>
                        <td>
                          {requirement.vacancies ? (
                            <span className="status status--partial">
                              {requirement.vacancies} vacant
                            </span>
                          ) : requirement.surplus ? (
                            <span className="status status--possible-duplicate">
                              {requirement.surplus} surplus
                            </span>
                          ) : (
                            <span className="status status--approved">
                              Filled
                            </span>
                          )}
                        </td>
                        <td>
                          <div className="actions">
                            <button
                              onClick={() =>
                                edit({
                                  kind: "requirement",
                                  current: requirement,
                                  oplocId,
                                })
                              }
                            >
                              Edit requirement
                            </button>
                            <button
                              onClick={() =>
                                edit({
                                  kind: "assignment",
                                  oplocId,
                                  staffingRoleId: requirement.staffingRoleId,
                                })
                              }
                            >
                              Assign Legend
                            </button>
                          </div>
                          <details>
                            <summary>Technical details</summary>
                            <p>{requirement.canonicalId}</p>
                            <p>{requirement.staffingRoleId}</p>
                          </details>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5}>
                      No active staffing requirements. Add the first role
                      requirement for this OPLOC.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <UnrequiredAssignments
            overview={overview}
            oplocId={oplocId}
            edit={edit}
          />
          {history.length > 0 && (
            <details className="staffing-history">
              <summary>Historical assignments ({history.length})</summary>
              {history.map((assignment) => (
                <AssignmentCard
                  key={assignment.canonicalId}
                  assignment={assignment}
                  edit={edit}
                />
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}

function ByLegend({
  overview,
  legendId,
  chooseLegend,
  edit,
  disabled,
  refreshSession,
}: {
  overview: Overview;
  legendId: string;
  chooseLegend: (value: string) => void;
  edit: (editor: Editor) => void;
  disabled: boolean;
  refreshSession: () => Promise<boolean>;
}) {
  const activeLegends = overview.legends.filter((legend) => !legend.terminated);
  const current = overview.siteRoleAssignments.filter(
    (item) => item.legendId === legendId && item.activeNow,
  );
  const history = overview.siteRoleAssignments.filter(
    (item) => item.legendId === legendId && !item.activeNow,
  );
  const evidence = overview.employments.filter(
    (item) => item.legendId === legendId,
  );
  const legacy = overview.assignments.filter(
    (item) => item.legendId === legendId,
  );
  return (
    <section className="connection-workspace">
      <SearchableSelector
        label="Active Legend"
        options={activeLegends}
        value={legendId}
        onChange={chooseLegend}
        placeholder="Search Legends"
      />
      {!legendId ? (
        <p className="empty">
          Choose an active Legend to see their staffing connections.
        </p>
      ) : (
        <>
          <section className="connection-section">
            <header>
              <h3>Working locations and roles</h3>
              <button
                onClick={() => edit({ kind: "assignment", legendId })}
                disabled={disabled}
              >
                <Plus />
                Add assignment
              </button>
            </header>
            {current.length ? (
              current.map((assignment) => (
                <AssignmentCard
                  key={assignment.canonicalId}
                  assignment={assignment}
                  edit={edit}
                />
              ))
            ) : (
              <p>No active development staffing assignment.</p>
            )}
          </section>
          {history.length > 0 && (
            <details className="staffing-history">
              <summary>Historical assignments ({history.length})</summary>
              {history.map((assignment) => (
                <AssignmentCard
                  key={assignment.canonicalId}
                  assignment={assignment}
                  edit={edit}
                />
              ))}
            </details>
          )}
          {legacy.length > 0 && (
            <details className="staffing-history">
              <summary>
                Existing governed Operational Assignments ({legacy.length})
              </summary>
              {legacy.map((assignment) => (
                <article
                  className="connection-row"
                  key={assignment.canonicalId}
                >
                  <div>
                    <b>{assignment.oplocLabel}</b>
                    <span>
                      {assignment.assignmentRole} · {assignment.designation}
                    </span>
                    <small>
                      {assignment.effectiveFrom}
                      {assignment.effectiveTo
                        ? ` to ${assignment.effectiveTo}`
                        : " onwards"}
                    </small>
                  </div>
                  <details>
                    <summary>Technical details</summary>
                    <p>{assignment.canonicalId}</p>
                  </details>
                </article>
              ))}
            </details>
          )}
          <section className="connection-section">
            <h3>BrightHR employment evidence</h3>
            <p className="form-help">
              Read-only source evidence. It is separate from development site
              staffing and is not promoted here.
            </p>
            {evidence.length ? (
              evidence.map((item) => (
                <article className="connection-row" key={item.canonicalId}>
                  <div>
                    <b>{item.employmentState}</b>
                    <span>
                      {item.startDate || "Start date not supplied"}
                      {item.terminationDate
                        ? ` to ${item.terminationDate}`
                        : ""}
                    </span>
                    {item.contractualJobTitle && (
                      <small>{item.contractualJobTitle}</small>
                    )}
                  </div>
                  <details>
                    <summary>Technical details</summary>
                    <p>{item.canonicalId}</p>
                  </details>
                </article>
              ))
            ) : (
              <p>No separate Employment evidence is available.</p>
            )}
          </section>
          <EventStaffingPanel
            legendId={legendId}
            legendLabel={
              overview.legends.find((legend) => legend.canonicalId === legendId)
                ?.label || "Legend"
            }
            canManage={!disabled}
            refreshSession={refreshSession}
          />
        </>
      )}
    </section>
  );
}

function UnrequiredAssignments({
  overview,
  oplocId,
  edit,
}: {
  overview: Overview;
  oplocId: string;
  edit: (editor: Editor) => void;
}) {
  const requiredRoles = new Set(
    overview.siteStaffingRequirements
      .filter((item) => item.oplocId === oplocId && item.activeNow)
      .map((item) => item.staffingRoleId),
  );
  const extras = overview.siteRoleAssignments.filter(
    (item) =>
      item.oplocId === oplocId &&
      item.activeNow &&
      !requiredRoles.has(item.staffingRoleId),
  );
  if (!extras.length) return null;
  return (
    <section className="connection-section">
      <h3>Additional staffing</h3>
      <p className="form-help">
        Allowed assignments without a matching active requirement.
      </p>
      {extras.map((assignment) => (
        <AssignmentCard
          key={assignment.canonicalId}
          assignment={assignment}
          edit={edit}
        />
      ))}
    </section>
  );
}

function AssignmentCard({
  assignment,
  edit,
}: {
  assignment: SiteAssignment;
  edit: (editor: Editor) => void;
}) {
  return (
    <article className="connection-row">
      <Users />
      <div>
        <b>
          {assignment.legendLabel} · {assignment.staffingRoleLabel}
        </b>
        <span>
          {assignment.oplocLabel}
          {assignment.primaryLocation
            ? " · Primary working location"
            : " · Additional working location"}
        </span>
        <small>
          {assignment.effectiveFrom}
          {assignment.effectiveTo
            ? ` to ${assignment.effectiveTo}`
            : " onwards"}
        </small>
      </div>
      <button onClick={() => edit({ kind: "assignment", current: assignment })}>
        Edit
      </button>
      <details>
        <summary>Technical details</summary>
        <p>{assignment.canonicalId}</p>
        <p>{assignment.legendId}</p>
        <p>{assignment.oplocId}</p>
        <p>{assignment.staffingRoleId}</p>
      </details>
    </article>
  );
}

function RoleModal({
  current,
  close,
  save,
  disabled,
}: {
  current?: StaffingRole;
  close: () => void;
  save: (command: Record<string, unknown>) => Promise<void>;
  disabled: boolean;
}) {
  const [name, setName] = useState(current?.name || "");
  const [description, setDescription] = useState(current?.description || "");
  const [active, setActive] = useState(current?.active ?? true);
  return (
    <Modal
      title={current ? "Edit Staffing Role" : "Create Staffing Role"}
      close={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save({
            action: "save-staffing-role",
            ...(current
              ? {
                  canonicalId: current.canonicalId,
                  expectedVersion: current.version,
                }
              : {}),
            name,
            ...(description ? { description } : {}),
            active,
          });
        }}
      >
        <div className="editor-grid">
          <label>
            Name
            <input
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label>
            Description
            <input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            Active and available for new staffing
          </label>
        </div>
        {current && (
          <details>
            <summary>Technical details</summary>
            <p>{current.canonicalId}</p>
            <p>Development model</p>
          </details>
        )}
        <ModalActions
          close={close}
          disabled={disabled}
          label="Save staffing role"
        />
      </form>
    </Modal>
  );
}

function RequirementModal({
  overview,
  oplocId,
  current,
  close,
  save,
  disabled,
}: {
  overview: Overview;
  oplocId: string;
  current?: Requirement;
  close: () => void;
  save: (command: Record<string, unknown>) => Promise<void>;
  disabled: boolean;
}) {
  const [roleId, setRoleId] = useState(current?.staffingRoleId || "");
  const [headcount, setHeadcount] = useState(
    String(current?.requiredHeadcount || 1),
  );
  const [from, setFrom] = useState(current?.effectiveFrom || overview.today);
  const [until, setUntil] = useState(current?.effectiveTo || "");
  const [notes, setNotes] = useState(current?.notes || "");
  return (
    <Modal
      title={current ? "Edit Staffing Requirement" : "Add Staffing Requirement"}
      close={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save({
            action: "save-site-staffing-requirement",
            ...(current
              ? {
                  canonicalId: current.canonicalId,
                  expectedVersion: current.version,
                }
              : {}),
            oplocId,
            staffingRoleId: roleId,
            requiredHeadcount: Number(headcount),
            effectiveFrom: from,
            ...(until ? { effectiveTo: until } : {}),
            ...(notes ? { notes } : {}),
          });
        }}
      >
        <div className="editor-grid">
          <SearchableSelector
            label="Staffing Role"
            options={overview.staffingRoles.filter(
              (role) =>
                role.active || role.canonicalId === current?.staffingRoleId,
            )}
            value={roleId}
            onChange={setRoleId}
            placeholder="Search staffing roles"
            required
          />
          <label>
            Required headcount
            <input
              required
              type="number"
              min="1"
              step="1"
              value={headcount}
              onChange={(event) => setHeadcount(event.target.value)}
            />
          </label>
          <label>
            Effective from
            <input
              required
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            Effective until (optional)
            <input
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
          <label className="wide-field">
            Notes
            <input
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </label>
        </div>
        <details>
          <summary>Technical details</summary>
          <p>OPLOC: {oplocId}</p>
          {current && <p>{current.canonicalId}</p>}
          <p>Development model</p>
        </details>
        <ModalActions
          close={close}
          disabled={disabled || !roleId}
          label="Save requirement"
        />
      </form>
    </Modal>
  );
}

function AssignmentModal({
  overview,
  current,
  fixedLegendId,
  fixedOplocId,
  fixedRoleId,
  close,
  remove,
  save,
  disabled,
}: {
  overview: Overview;
  current?: SiteAssignment;
  fixedLegendId?: string;
  fixedOplocId?: string;
  fixedRoleId?: string;
  close: () => void;
  remove: (current: SiteAssignment) => void;
  save: (command: Record<string, unknown>) => Promise<void>;
  disabled: boolean;
}) {
  const [legendId, setLegendId] = useState(
    fixedLegendId || current?.legendId || "",
  );
  const [oplocId, setOplocId] = useState(
    fixedOplocId || current?.oplocId || "",
  );
  const [roleId, setRoleId] = useState(
    fixedRoleId || current?.staffingRoleId || "",
  );
  const [from, setFrom] = useState(current?.effectiveFrom || overview.today);
  const [until, setUntil] = useState(current?.effectiveTo || "");
  const [primary, setPrimary] = useState(current?.primaryLocation || false);
  const activeLegends = overview.legends.filter(
    (legend) => !legend.terminated || legend.canonicalId === current?.legendId,
  );
  const command = (
    lifecycleState: "active" | "ended",
    effectiveTo = until,
  ) => ({
    action: "save-site-role-assignment",
    ...(current
      ? { canonicalId: current.canonicalId, expectedVersion: current.version }
      : {}),
    legendId,
    oplocId,
    staffingRoleId: roleId,
    effectiveFrom: from,
    ...(effectiveTo ? { effectiveTo } : {}),
    primaryLocation: primary,
    lifecycleState,
  });
  return (
    <Modal
      title={
        current ? "Edit Site Role Assignment" : "Assign Legend to Site Role"
      }
      close={close}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void save(command("active"));
        }}
      >
        <div className="editor-grid">
          <SearchableSelector
            label="Active Legend"
            options={activeLegends}
            value={legendId}
            onChange={setLegendId}
            placeholder="Search Legends"
            required
          />
          <SearchableSelector
            label="Operational Location"
            options={overview.oplocs}
            value={oplocId}
            onChange={setOplocId}
            placeholder="Search OPLOCs"
            required
          />
          <SearchableSelector
            label="Staffing Role"
            options={overview.staffingRoles.filter(
              (role) =>
                role.active || role.canonicalId === current?.staffingRoleId,
            )}
            value={roleId}
            onChange={setRoleId}
            placeholder="Search staffing roles"
            required
          />
          <label>
            Effective from
            <input
              required
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            Effective until (optional)
            <input
              type="date"
              value={until}
              onChange={(event) => setUntil(event.target.value)}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={primary}
              onChange={(event) => setPrimary(event.target.checked)}
            />
            Primary working location
          </label>
        </div>
        <p className="form-help">
          Operational roles never grant FIKA OS permissions. Surplus staffing is
          allowed and displayed rather than blocked.
        </p>
        <details>
          <summary>Technical details</summary>
          {current && <p>{current.canonicalId}</p>}
          <p>Legend: {legendId || "Not selected"}</p>
          <p>OPLOC: {oplocId || "Not selected"}</p>
          <p>Staffing Role: {roleId || "Not selected"}</p>
          <p>Development model</p>
        </details>
        <div className="modal-actions">
          <button type="button" onClick={close}>
            Cancel
          </button>
          {current && current.lifecycleState === "active" && (
            <button
              type="button"
              onClick={() =>
                void save(command("ended", until || overview.today))
              }
            >
              End assignment
            </button>
          )}
          {current && (
            <button
              className="danger"
              type="button"
              onClick={() => remove(current)}
            >
              Remove erroneous assignment
            </button>
          )}
          <button
            className="primary"
            disabled={disabled || !legendId || !oplocId || !roleId}
          >
            Save assignment
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RemoveAssignmentModal({
  current,
  close,
  save,
  disabled,
}: {
  current: SiteAssignment;
  close: () => void;
  save: (command: Record<string, unknown>) => Promise<void>;
  disabled: boolean;
}) {
  return (
    <Modal title="Remove erroneous assignment" close={close}>
      <p>
        This removes the development record from active data while retaining
        revision and audit evidence. Use End assignment for genuine history.
      </p>
      <div className="modal-actions">
        <button onClick={close}>Cancel</button>
        <button
          className="danger"
          disabled={disabled}
          onClick={() =>
            void save({
              action: "remove-site-role-assignment",
              canonicalId: current.canonicalId,
              expectedVersion: current.version,
            })
          }
        >
          Remove development assignment
        </button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <section className="detail-modal staffing-modal">
        <header>
          <h2>{title}</h2>
          <button
            className="icon"
            aria-label="Cancel and close"
            onClick={close}
          >
            <X />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function ModalActions({
  close,
  disabled,
  label,
}: {
  close: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <div className="modal-actions">
      <button type="button" onClick={close}>
        Cancel
      </button>
      <button className="primary" disabled={disabled}>
        {label}
      </button>
    </div>
  );
}

function SearchableSelector({
  label,
  options,
  value,
  onChange,
  placeholder,
  required = false,
}: {
  label: string;
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  required?: boolean;
}) {
  const selected = options.find((option) => option.canonicalId === value);
  const [query, setQuery] = useState("");
  const matches = useMemo(
    () =>
      options
        .filter((option) =>
          option.label.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 12),
    [options, query],
  );
  return (
    <div className="searchable-selector">
      <label>
        {label}
        {selected ? (
          <span className="selected-connection">
            <b>{selected.label}</b>
            <button
              type="button"
              onClick={() => {
                onChange("");
                setQuery("");
              }}
            >
              Change
            </button>
          </span>
        ) : (
          <input
            aria-label={label}
            required={required}
            role="combobox"
            aria-expanded={Boolean(query)}
            placeholder={placeholder}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        )}
      </label>
      {!selected && query && (
        <div className="selector-results" role="listbox">
          {matches.length ? (
            matches.map((option) => (
              <button
                type="button"
                role="option"
                aria-selected="false"
                key={option.canonicalId}
                onClick={() => {
                  onChange(option.canonicalId);
                  setQuery("");
                }}
              >
                {option.label}
              </button>
            ))
          ) : (
            <p>No matching records.</p>
          )}
        </div>
      )}
      {selected && (
        <details>
          <summary>Technical details</summary>
          <p>{selected.canonicalId}</p>
        </details>
      )}
    </div>
  );
}
