"use client";
import Image from "next/image";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Plus,
  X,
  Users,
  ChefHat,
  CheckSquare,
  AlertTriangle,
  SlidersHorizontal,
} from "lucide-react";
import type { EventRecord, Staffing, Production, EventTask, EventZone, EventAssignment } from "@/lib/types";
import { PUBLIC_CONFIG as C } from "@/lib/config";
import { emptyHubContract, type HubOperatingReadContract } from "@/lib/hub-operating-read-contract";
type Ready = {
  percentage: number;
  complete: boolean;
  staffingGaps: number;
  productionGaps: number;
  blockedTasks: number;
  overdueTasks: number;
  areas: Record<string, { complete: boolean; reasons: string[] }>;
};
type RecordView = EventRecord & { readiness: Ready };
type Actor = { id: string; name: string; development: boolean };
type StaffingSuggestion = { legendId: string; label: string; eligibility: "primary" | "secondary" | "fallback"; suggestionRank: number; teams: string[]; reason: string };
type ActiveLegend = { canonicalId: string; label: string };
const blank = (): EventRecord => ({
  recordType: "EVENT",
  eventId: "",
  eventReference: "",
  version: 0,
  createdAt: "",
  createdBy: "",
  updatedAt: "",
  updatedBy: "",
  eventName: "",
  eventType: "",
  description: "",
  eventDate: "",
  startTime: "",
  endTime: "",
  timezone: "Europe/London",
  pax: null,
  responsibleOplocId: "",
  operationalAreaId: "",
  serviceArrangementIds: [],
  equipmentAssetIds: [],
  siteId: "",
  eventContact: "",
  accountableOwnerId: "",
  contributorIds: [],
  lifecycleStatus: "Draft",
  staffingRequirements: [],
  productionRequirements: [],
  tasks: [],
  cancelledAt: null,
  history: [],
});
const id = () => crypto.randomUUID();
const referenceIds = (event: EventRecord) => [event.responsibleOplocId, event.operationalAreaId, event.siteId, event.accountableOwnerId, ...event.contributorIds, ...(event.serviceArrangementIds || []), ...(event.equipmentAssetIds || []), ...event.staffingRequirements.flatMap(requirement => [requirement.locationId, ...requirement.assignedPersonIds]), ...event.productionRequirements.flatMap(requirement => [requirement.productionUnitId, requirement.responsiblePersonId]), ...event.tasks.map(task => task.ownerId)].filter(Boolean);
export default function Dashboard() {
  const [records, setRecords] = useState<RecordView[]>([]),
    [actor, setActor] = useState<Actor | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [current, setCurrent] = useState<EventRecord | null>(null),
    [tab, setTab] = useState("Overview"),
    [dirty, setDirty] = useState(false),
    [filters, setFilters] = useState<Record<string, string>>({}),
    [staffingSuggestions, setStaffingSuggestions] = useState<Record<string, StaffingSuggestion[]>>({}),
    [activeLegends, setActiveLegends] = useState<ActiveLegend[]>([]),
    [hub, setHub] = useState<HubOperatingReadContract>(emptyHubContract());
  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/events", { cache: "no-store" }),
        j = await r.json();
      if (!r.ok) throw Error(j.error.message);
      setRecords(j.records);
      void loadHub(j.records.flatMap(referenceIds));
      setActor(j.actor);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function loadHub(ids: string[] = []) {
    const response = await fetch(`/api/hub-operating-read-contract${ids.length ? `?ids=${encodeURIComponent(ids.join(","))}` : ""}`, { cache: "no-store" });
    const body = await response.json();
    if (!response.ok) throw Error(body.error?.message || "Governed operating references could not be loaded.");
    setHub(body); return body as HubOperatingReadContract;
  }
  useEffect(() => { void loadHub().catch(cause => setError((cause as Error).message)); }, []);
  useEffect(() => { const suggestions = Object.fromEntries(hub.eventRoles.map(role => [role.label, role.suggestions])); setStaffingSuggestions(suggestions); setActiveLegends(hub.legends); }, [hub]);
  useEffect(() => {
    const f = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    addEventListener("beforeunload", f);
    return () => removeEventListener("beforeunload", f);
  }, [dirty]);
  const view = useMemo(
    () =>
      records
        .filter((r) =>
          (!filters.lifecycleStatus && r.lifecycleStatus === "Cancelled"
            ? false
            : true) &&
          Object.entries(filters).every(([k, v]) => {
            if (!v) return true;
            if (k === "from") return r.eventDate >= v;
            if (k === "to") return r.eventDate <= v;
            if (k === "readiness")
              return v === "ready"
                ? r.readiness.complete
                : !r.readiness.complete;
            if (k === "attention")
              return v === "staffing"
                ? r.readiness.staffingGaps > 0
                : v === "production"
                  ? r.readiness.productionGaps > 0
                  : r.readiness.blockedTasks + r.readiness.overdueTasks > 0;
            return (r as unknown as Record<string, unknown>)[k] === v;
          }),
        )
        .sort((a, b) =>
          (a.eventDate + a.startTime).localeCompare(b.eventDate + b.startTime),
        ),
    [records, filters],
  );
  function close() {
    if (!dirty || confirm("Discard unsaved changes?")) {
      setCurrent(null);
      setDirty(false);
    }
  }
  async function save() {
    if (!current) return;
    if (
      current.lifecycleStatus === "Cancelled" &&
      !confirm("Cancel this Event? Its history will be preserved.")
    )
      return;
    const payload = current.eventId
      ? {
          requestId: `save:${id()}`,
          expectedVersion: current.version,
          event: input(current),
        }
      : { requestId: `create:${id()}`, event: input(current) };
    const r = await fetch(
        current.eventId
          ? `/api/events/${encodeURIComponent(current.eventId)}`
          : "/api/events",
        {
          method: current.eventId ? "PUT" : "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        },
      ),
      j = await r.json();
    if (!r.ok) {
      setError(j.error?.message || "Save failed");
      return;
    }
    setCurrent(j);
    setDirty(false);
    setError("");
    await load();
  }
  const change = (patch: Partial<EventRecord>) => {
    setCurrent((c) => (c ? { ...c, ...patch } : c));
    setDirty(true);
  };
  return (
    <>
      <header className="top">
        <div className="brand">
          <Image
            src="/fika-logo-white.png"
            alt="FIKA"
            width={116}
            height={50}
            priority
          />
          <span>OS</span>
        </div>
        <div className="app-title">
          <small>Company-wide operations</small>
          <h1>Events</h1>
        </div>
        <div className="identity">
          {actor?.development && <b>Development identity</b>}
          <span>{actor?.name || "Checking identity…"}</span>
        </div>
        <button
          className="primary"
          onClick={() => {
            setCurrent(blank());
            setTab("Overview");
          }}
        >
          <Plus />
          Create Event
        </button>
      </header>
      <main>
        <section className="hero">
          <div>
            <small>Operational schedule</small>
            <h2>Every Event. One clear plan.</h2>
            <p>Brief, Legends, production and actions—ready to scan.</p>
          </div>
          <div className="metrics">
            <Metric n={view.length} label="Events" />
            <Metric
              n={view.filter((x) => !x.readiness.complete).length}
              label="Need attention"
            />
          </div>
        </section>
        <Filters values={filters} set={setFilters} hub={hub} />
        {error && (
          <div className="error">
            <AlertTriangle />
            {error}
          </div>
        )}
        <section className="schedule">
          {loading ? (
            <Empty text="Loading the operational schedule…" />
          ) : view.length ? (
            view.map((r) => (
              <EventCard
                key={r.eventId}
                r={r}
                hub={hub}
                open={() => {
                  setCurrent(r);
                  setTab("Overview");
                  setDirty(false);
                }}
              />
            ))
          ) : (
            <Empty text="No Events match this view. Create the first Event or clear a filter." />
          )}
        </section>
      </main>
        {current && (
        <div className="modal" role="dialog" aria-modal="true">
          <div className="editor">
            <header>
              <div>
                <small>{current.eventReference || "New Event"}</small>
                <h2>{current.eventName || "Create Event"}</h2>
              </div>
              <button className="icon" aria-label="Close" onClick={close}>
                <X />
              </button>
            </header>
            <nav>
              {["Overview", "Delivery Plan", "Team", "Run Sheet"].map(
                (t) => (
                  <button
                    className={tab === t ? "active" : ""}
                    onClick={() => setTab(t)}
                    key={t}
                  >
                    {t}
                  </button>
                ),
              )}
            </nav>
            <div className="body">
              {tab === "Overview" ? (
                <Overview e={current} change={change} hub={hub} />
              ) : tab === "Team" ? (
                <TeamEditor e={current} change={change} hub={hub} suggestions={staffingSuggestions} activeLegends={activeLegends} />
              ) : tab === "Delivery Plan" ? (
                <ProductionEditor
                  rows={current.productionRequirements}
                  set={(x) => change({ productionRequirements: x })}
                  hub={hub}
                />
              ) : (
                <TaskEditor
                  rows={current.tasks}
                  set={(x) => change({ tasks: x })}
                  hub={hub}
                />
              )}
            </div>
            <footer>
              <button onClick={close}>Close</button>
              <button className="primary" onClick={save}>
                Save Event
              </button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
const input = (e: EventRecord) => ({
  eventName: e.eventName,
  eventType: e.eventType,
  description: e.description,
  eventDate: e.eventDate,
  startTime: e.startTime,
  endTime: e.endTime,
  timezone: e.timezone,
  pax: e.pax,
  responsibleOplocId: e.responsibleOplocId,
  operationalAreaId: e.operationalAreaId || "",
  serviceArrangementIds: e.serviceArrangementIds || [],
  equipmentAssetIds: e.equipmentAssetIds || [],
  siteId: e.siteId,
  eventContact: e.eventContact,
  accountableOwnerId: e.accountableOwnerId,
  contributorIds: e.contributorIds,
  lifecycleStatus: e.lifecycleStatus,
  staffingRequirements: e.staffingRequirements,
  eventZones: e.eventZones || [],
  eventAssignments: e.eventAssignments || [],
  requirements: e.requirements || [],
  risks: e.risks || [],
  productionRequirements: e.productionRequirements,
  tasks: e.tasks,
});
const Metric = ({ n, label }: { n: number; label: string }) => (
  <div className="metric">
    <strong>{n}</strong>
    <span>{label}</span>
  </div>
);
const Empty = ({ text }: { text: string }) => (
  <div className="empty">
    <CalendarDays />
    <h3>{text}</h3>
  </div>
);
const hubName = (hub: HubOperatingReadContract, id: string) =>
  [...hub.oplocs, ...hub.operationalAreas, ...hub.legends, ...hub.historical].find((item) => item.canonicalId === id)?.label || (id ? `Historic reference: ${id}` : "Unassigned");
function Filters({
  values,
  set,
  hub,
}: {
  values: Record<string, string>;
  set: (x: Record<string, string>) => void;
  hub: HubOperatingReadContract;
}) {
  const [open, setOpen] = useState(true);
  const f = (k: string, v: string) => set({ ...values, [k]: v });
  return (
    <section className="filter-panel">
      <button
        className="filter-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls="event-filters"
      >
        <SlidersHorizontal /> Filters
        <span>{Object.values(values).filter(Boolean).length || "All Events"}</span>
      </button>
      <div
        id="event-filters"
        className={`filters ${open ? "filters--open" : ""}`}
      >
      <Field
        label="From"
        type="date"
        value={values.from || ""}
        set={(v) => f("from", v)}
      />
      <Field
        label="To"
        type="date"
        value={values.to || ""}
        set={(v) => f("to", v)}
      />
      <Select
        label="OPLOC"
        value={values.responsibleOplocId}
        onChange={(v) => f("responsibleOplocId", v)}
        list={hub.oplocs.map(item => ({ id: item.canonicalId, name: item.label }))}
      />
      <Select
        label="Operational Area"
        value={values.operationalAreaId}
        onChange={(v) => f("operationalAreaId", v)}
        list={hub.operationalAreas.map(item => ({ id: item.canonicalId, name: item.label }))}
      />
      <Select
        label="Event type"
        value={values.eventType}
        onChange={(v) => f("eventType", v)}
        list={C.eventTypes}
      />
      <Select
        label="Lifecycle"
        value={values.lifecycleStatus}
        onChange={(v) => f("lifecycleStatus", v)}
        list={C.lifecycles}
      />
      <Select
        label="Owner"
        value={values.accountableOwnerId}
        onChange={(v) => f("accountableOwnerId", v)}
        list={hub.legends.map(item => ({ id: item.canonicalId, name: item.label }))}
      />
      <Select
        label="Readiness"
        value={values.readiness}
        onChange={(v) => f("readiness", v)}
        list={[
          { id: "attention", name: "Needs attention" },
          { id: "ready", name: "Ready" },
        ]}
      />
      <Select
        label="Attention required"
        value={values.attention}
        onChange={(v) => f("attention", v)}
        list={[
          { id: "staffing", name: "Staffing gaps" },
          { id: "production", name: "Production gaps" },
          { id: "tasks", name: "Task issues" },
        ]}
      />
      </div>
    </section>
  );
}
function EventCard({ r, open, hub }: { r: RecordView; open: () => void; hub: HubOperatingReadContract }) {
  const cancelled = r.lifecycleStatus === "Cancelled";
  return (
    <button
      className={`event ${cancelled ? "event--cancelled" : ""}`}
      onClick={open}
    >
      <div>
        <b className="pill">{r.recordType}</b>
        <h3>{r.eventName || "Untitled Event"}</h3>
        <small>{r.eventReference}</small>
      </div>
      <Cell
        l="When"
        v={
          [r.eventDate, r.startTime].filter(Boolean).join(" · ") ||
          "Unscheduled"
        }
      />
      <Cell l="Area" v={hubName(hub, r.operationalAreaId || r.siteId)} />
      <Cell l="OPLOC" v={hubName(hub, r.responsibleOplocId)} />
      <Cell l="Owner" v={hubName(hub, r.accountableOwnerId)} />
      <div><small>Lifecycle</small><StatusBadge status={r.lifecycleStatus} /></div>
      <Cell
        l="Readiness"
        v={cancelled ? "Archived" : `${r.readiness.percentage}%`}
        warn={!cancelled && !r.readiness.complete}
      />
      <Cell
        l="Attention"
        v={`${r.readiness.staffingGaps} staff · ${r.readiness.productionGaps} production · ${r.readiness.blockedTasks + r.readiness.overdueTasks} tasks`}
        warn={
          !!(
            r.readiness.staffingGaps +
            r.readiness.productionGaps +
            r.readiness.blockedTasks +
            r.readiness.overdueTasks
          )
        }
      />
    </button>
  );
}
const Cell = ({ l, v, warn }: { l: string; v: string; warn?: boolean }) => (
  <div>
    <small>{l}</small>
    <strong className={warn ? "warn" : ""}>{v}</strong>
  </div>
);
const StatusBadge = ({ status }: { status: string }) => (
  <strong
    className={`status status--${status.toLowerCase().replaceAll(" ", "-")}`}
  >
    {status}
  </strong>
);
function Overview({
  e,
  change,
  hub,
}: {
  e: EventRecord;
  change: (x: Partial<EventRecord>) => void;
  hub: HubOperatingReadContract;
}) {
  return (
    <div className="grid">
      <Field
        label="Event name"
        wide
        value={e.eventName}
        set={(v) => change({ eventName: v })}
      />
      <Select
        label="Event type"
        value={e.eventType}
        onChange={(v) => change({ eventType: v })}
        list={C.eventTypes}
      />
      <Select
        label="Lifecycle"
        value={e.lifecycleStatus}
        onChange={(v) => change({ lifecycleStatus: v })}
        list={C.lifecycles}
      />
      <Field
        label="Operational brief"
        wide
        area
        value={e.description}
        set={(v) => change({ description: v })}
      />
      <Field
        label="Date"
        type="date"
        value={e.eventDate}
        set={(v) => change({ eventDate: v })}
      />
      <Field
        label="Pax"
        type="number"
        value={e.pax ?? ""}
        set={(v) => change({ pax: v ? Number(v) : null })}
      />
      <Field
        label="Start"
        type="time"
        value={e.startTime}
        set={(v) => change({ startTime: v })}
      />
      <Field
        label="End"
        type="time"
        value={e.endTime}
        set={(v) => change({ endTime: v })}
      />
      <Select
        label="Responsible OPLOC"
        value={e.responsibleOplocId}
        onChange={(v) => change({ responsibleOplocId: v, operationalAreaId: "", serviceArrangementIds: [], equipmentAssetIds: [] })}
        list={hub.oplocs.map(item => ({ id: item.canonicalId, name: item.label }))}
      />
      <Select
        label="Operational Area"
        value={e.operationalAreaId || ""}
        onChange={(v) => change({ operationalAreaId: v, serviceArrangementIds: [], equipmentAssetIds: [] })}
        list={hub.operationalAreas.filter(item => item.oplocId === e.responsibleOplocId).map(item => ({ id: item.canonicalId, name: item.label }))}
      />
      {e.siteId && !e.operationalAreaId && <p className="wide form-help">Legacy service-site reference retained: {hubName(hub, e.siteId)}. Select an Operational Area only after an authorised review; the original value remains in this Event record.</p>}
      <label className="wide">Available service arrangements<select multiple value={e.serviceArrangementIds || []} onChange={(x) => change({ serviceArrangementIds: [...x.target.selectedOptions].map(option => option.value) })}>{hub.serviceArrangements.filter(item => item.oplocId === e.responsibleOplocId && (!item.operationalAreaId || item.operationalAreaId === e.operationalAreaId)).map(item => <option key={item.canonicalId} value={item.canonicalId}>{item.label} — {item.operationalAreaLabel || "OPLOC-wide"}</option>)}</select><small>Active arrangements only. This does not create or modify Hub services.</small></label>
      <label className="wide">Available equipment<select multiple value={e.equipmentAssetIds || []} onChange={(x) => change({ equipmentAssetIds: [...x.target.selectedOptions].map(option => option.value) })}>{hub.equipmentAssets.filter(item => item.oplocId === e.responsibleOplocId && (!item.operationalAreaId || item.operationalAreaId === e.operationalAreaId)).map(item => <option key={item.canonicalId} value={item.assetId}>{item.label} — {item.operationalAreaLabel || "OPLOC-wide"}</option>)}</select><small>Current allocation evidence only; no live availability is claimed.</small></label>
      <Field
        label="Event Contact"
        value={e.eventContact}
        set={(v) => change({ eventContact: v })}
      />
      <Select
        label="Event Lead"
        value={e.accountableOwnerId}
        onChange={(v) => change({ accountableOwnerId: v })}
        list={hub.legends.map(item => ({ id: item.canonicalId, name: item.label }))}
      />
      {e.contributorIds.length > 0 && <p className="wide form-help">Legacy contributor references are retained for history only. New Event planning uses Event Assignments in Team.</p>}
    </div>
  );
}
function TeamEditor({ e, change, hub, suggestions, activeLegends }: { e: EventRecord; change: (patch: Partial<EventRecord>) => void; hub: HubOperatingReadContract; suggestions: Record<string, StaffingSuggestion[]>; activeLegends: ActiveLegend[] }) {
  const zones = e.eventZones || [];
  const assignments = e.eventAssignments || [];
  const overlaps = assignments.filter((assignment, index) => assignments.some((other, otherIndex) => index !== otherIndex && assignment.legendId && assignment.legendId === other.legendId && assignment.shiftStart && assignment.shiftEnd && other.shiftStart && other.shiftEnd && assignment.shiftStart < other.shiftEnd && other.shiftStart < assignment.shiftEnd)).map(assignment => assignment.id);
  return <><Editor title="Event Zones / Service Points" icon={<CheckSquare />} add={() => change({ eventZones: [...zones, { id: id(), name: "", purpose: "", notes: "" }] })}>{zones.map((zone, index) => <Row key={zone.id} remove={() => change({ eventZones: zones.filter((_, item) => item !== index) })}><Field label="Service point" value={zone.name} set={(value) => change({ eventZones: zones.map((item, n) => n === index ? { ...item, name: value } : item) })} /><Field label="Purpose" value={zone.purpose} set={(value) => change({ eventZones: zones.map((item, n) => n === index ? { ...item, purpose: value } : item) })} /><Field label="Notes" wide value={zone.notes} set={(value) => change({ eventZones: zones.map((item, n) => n === index ? { ...item, notes: value } : item) })} /></Row>)}</Editor><Editor title="Event Assignments" icon={<Users />} add={() => change({ eventAssignments: [...assignments, { id: id(), legendId: "", eventRole: "", eventZoneId: "", shiftStart: "", shiftEnd: "", timingNotes: "", manualAssignmentReason: "" }] })}>{assignments.map((assignment, index) => <Row key={assignment.id} remove={() => change({ eventAssignments: assignments.filter((_, item) => item !== index) })}><Select label="Legend" value={assignment.legendId} onChange={(value) => change({ eventAssignments: assignments.map((item, n) => n === index ? { ...item, legendId: value } : item) })} list={hub.legends.map(item => ({ id: item.canonicalId, name: item.label }))} /><Select label="Event role" value={assignment.eventRole} onChange={(value) => change({ eventAssignments: assignments.map((item, n) => n === index ? { ...item, eventRole: value } : item) })} list={hub.eventRoles.map(item => ({ id: item.label, name: item.label }))} /><Select label="Service point" value={assignment.eventZoneId} onChange={(value) => change({ eventAssignments: assignments.map((item, n) => n === index ? { ...item, eventZoneId: value } : item) })} list={zones.map(item => ({ id: item.id, name: item.name || "Untitled service point" }))} /><Field label="Shift start" type="time" value={assignment.shiftStart} set={(value) => change({ eventAssignments: assignments.map((item, n) => n === index ? { ...item, shiftStart: value } : item) })} /><Field label="Shift end" type="time" value={assignment.shiftEnd} set={(value) => change({ eventAssignments: assignments.map((item, n) => n === index ? { ...item, shiftEnd: value } : item) })} /><Field label="Timing notes" wide value={assignment.timingNotes} set={(value) => change({ eventAssignments: assignments.map((item, n) => n === index ? { ...item, timingNotes: value } : item) })} /><Field label="Manual overlap / assignment reason" wide value={assignment.manualAssignmentReason} set={(value) => change({ eventAssignments: assignments.map((item, n) => n === index ? { ...item, manualAssignmentReason: value } : item) })} />{overlaps.includes(assignment.id) && <p className="wide form-help">Overlapping shift for this Legend. Record an operational reason before retaining it.</p>}</Row>)}</Editor><StaffingEditor rows={e.staffingRequirements} set={(rows) => change({ staffingRequirements: rows })} suggestions={suggestions} activeLegends={activeLegends} hub={hub} /></>;
}

function StaffingEditor({
  rows,
  set,
  suggestions,
  activeLegends,
  hub,
}: {
  rows: Staffing[];
  set: (x: Staffing[]) => void;
  suggestions: Record<string, StaffingSuggestion[]>;
  activeLegends: ActiveLegend[];
  hub: HubOperatingReadContract;
}) {
  return (
    <Editor
      title="Staffing requirements"
      icon={<Users />}
      add={() =>
        set([
          ...rows,
          {
            id: id(),
            role: "",
            requiredHeadcount: 1,
            assignedPersonIds: [],
            startTime: "",
            endTime: "",
            locationId: "",
            notes: "",
            planningStatus: "Unfilled",
          },
        ])
      }
    >
      {rows.map((r, i) => (
        <Row key={r.id} remove={() => set(rows.filter((_, n) => n !== i))}>
          <Select
            label="Role"
            value={r.role}
            onChange={(v) => setAt(rows, set, i, { role: v })}
            list={hub.eventRoles.map(item => ({ id: item.label, name: item.label }))}
          />
          <Field
            label="Required"
            type="number"
            value={r.requiredHeadcount}
            set={(v) => setAt(rows, set, i, { requiredHeadcount: Number(v) })}
          />
          <Select
            label="Status"
            value={r.planningStatus}
            onChange={(v) =>
              setAt(rows, set, i, {
                planningStatus: v as Staffing["planningStatus"],
              })
            }
            list={[
              "Unfilled",
              "Partially Assigned",
              "Fully Assigned",
              "Unresolved",
            ]}
          />
          <Field
            label="Start"
            type="time"
            value={r.startTime}
            set={(v) => setAt(rows, set, i, { startTime: v })}
          />
          <Field
            label="End"
            type="time"
            value={r.endTime}
            set={(v) => setAt(rows, set, i, { endTime: v })}
          />
          <Select
            label="Working location"
            value={r.locationId}
            onChange={(v) => setAt(rows, set, i, { locationId: v })}
            list={[...hub.oplocs, ...hub.operationalAreas].map(item => ({ id: item.canonicalId, name: item.label }))}
          />
          <label className="wide">
            Assigned Legends
            <select
              multiple
              value={r.assignedPersonIds}
              onChange={(x) =>
                setAt(rows, set, i, {
                  assignedPersonIds: [...x.target.selectedOptions].map(
                    (o) => o.value,
                  ),
                })
              }
            >
              {activeLegends.map((legend) => <option key={legend.canonicalId} value={legend.canonicalId}>{legend.label}</option>)}
              {(suggestions[r.role] || [])
                .map((suggestion) => (
                  <option key={suggestion.legendId} value={suggestion.legendId}>
                    {suggestion.label} — {suggestion.reason}
                  </option>
                ))}
            </select>
            <small>
              {r.assignedPersonIds.length} of {r.requiredHeadcount}{" "}
              assigned—planning only, not a rota entry.
            </small>
            {(suggestions[r.role] || []).length > 0 && <span className="form-help">Suggested in governed eligibility order: {(suggestions[r.role] || []).map((suggestion) => `${suggestion.label} (${suggestion.reason})`).join("; ")}. You may still select another active Legend manually.</span>}
          </label>
          <Field label="Manual selection reason" wide value={r.manualSelectionReason || ""} set={(v) => setAt(rows, set, i, { manualSelectionReason: v })} />
          <Field
            label="Notes"
            wide
            value={r.notes}
            set={(v) => setAt(rows, set, i, { notes: v })}
          />
        </Row>
      ))}
    </Editor>
  );
}
function ProductionEditor({
  rows,
  set,
  hub,
}: {
  rows: Production[];
  set: (x: Production[]) => void;
  hub: HubOperatingReadContract;
}) {
  return (
    <Editor
      title="Production planning"
      icon={<ChefHat />}
      add={() =>
        set([
          ...rows,
          {
            id: id(),
            item: "",
            quantity: null,
            unit: "",
            requiredAt: "",
            productionUnitId: "",
            destination: "",
            dietaryWarning: "",
            notes: "",
            planningStatus: "Incomplete",
            responsiblePersonId: "",
          },
        ])
      }
    >
      {rows.map((r, i) => (
        <Row key={r.id} remove={() => set(rows.filter((_, n) => n !== i))}>
          <Field
            label="Requested item"
            value={r.item}
            set={(v) => setAt(rows, set, i, { item: v })}
          />
          <Field
            label="Quantity"
            type="number"
            value={r.quantity ?? ""}
            set={(v) => setAt(rows, set, i, { quantity: v ? Number(v) : null })}
          />
          <Field
            label="Unit"
            value={r.unit}
            set={(v) => setAt(rows, set, i, { unit: v })}
          />
          <Field
            label="Required at"
            type="datetime-local"
            value={r.requiredAt}
            set={(v) => setAt(rows, set, i, { requiredAt: v })}
          />
          <Field
            label="Intended producer reference"
            value={r.productionUnitId}
            set={(v) => setAt(rows, set, i, { productionUnitId: v })}
          />
          <Field
            label="Destination"
            value={r.destination}
            set={(v) => setAt(rows, set, i, { destination: v })}
          />
          <Select
            label="Responsible person"
            value={r.responsiblePersonId}
            onChange={(v) => setAt(rows, set, i, { responsiblePersonId: v })}
            list={hub.legends.map(item => ({ id: item.canonicalId, name: item.label }))}
          />
          <Select
            label="Planning status"
            value={r.planningStatus}
            onChange={(v) =>
              setAt(rows, set, i, {
                planningStatus: v as Production["planningStatus"],
              })
            }
            list={["Incomplete", "Planned", "Ready for Handoff", "Unresolved"]}
          />
          <Field
            label="Dietary / allergen warning"
            wide
            value={r.dietaryWarning}
            set={(v) => setAt(rows, set, i, { dietaryWarning: v })}
          />
          <Field
            label="Sanitised notes"
            wide
            value={r.notes}
            set={(v) => setAt(rows, set, i, { notes: v })}
          />
        </Row>
      ))}
    </Editor>
  );
}
function TaskEditor({
  rows,
  set,
  hub,
}: {
  rows: EventTask[];
  set: (x: EventTask[]) => void;
  hub: HubOperatingReadContract;
}) {
  return (
    <Editor
      title="Operational tasks"
      icon={<CheckSquare />}
      add={() =>
        set([
          ...rows,
          {
            id: id(),
            title: "",
            description: "",
            ownerId: "",
            dueAt: "",
            status: "To Do",
            blockedReason: "",
            completedAt: "",
          },
        ])
      }
    >
      {rows.map((r, i) => (
        <Row key={r.id} remove={() => set(rows.filter((_, n) => n !== i))}>
          <Field
            label="Task title"
            value={r.title}
            set={(v) => setAt(rows, set, i, { title: v })}
          />
          <Select
            label="Owner"
            value={r.ownerId}
            onChange={(v) => setAt(rows, set, i, { ownerId: v })}
            list={hub.legends.map(item => ({ id: item.canonicalId, name: item.label }))}
          />
          <Field
            label="Due"
            type="datetime-local"
            value={r.dueAt}
            set={(v) => setAt(rows, set, i, { dueAt: v })}
          />
          <Select
            label="Status"
            value={r.status}
            onChange={(v) =>
              setAt(rows, set, i, {
                status: v as EventTask["status"],
                completedAt:
                  v === "Done" ? new Date().toISOString() : r.completedAt,
              })
            }
            list={C.taskStatuses}
          />
          <Field
            label="Blocked reason"
            value={r.blockedReason}
            set={(v) => setAt(rows, set, i, { blockedReason: v })}
          />
          <Field
            label="Completed at"
            type="datetime-local"
            value={r.completedAt.slice(0, 16)}
            set={(v) => setAt(rows, set, i, { completedAt: v })}
          />
          <Field
            label="Description"
            wide
            value={r.description}
            set={(v) => setAt(rows, set, i, { description: v })}
          />
        </Row>
      ))}
    </Editor>
  );
}
function Activity({ e }: { e: RecordView }) {
  return (
    <>
      <h3>Readiness</h3>
      <div className="readiness">
        {e.readiness ? (
          Object.entries(e.readiness.areas).map(([k, v]) => (
            <article className={v.complete ? "complete" : ""} key={k}>
              <b>{k}</b>
              <span>{v.complete ? "Complete" : "Needs attention"}</span>
              {v.reasons.map((x) => (
                <small key={x}>{x}</small>
              ))}
            </article>
          ))
        ) : (
          <p>Save to calculate readiness.</p>
        )}
      </div>
      <h3>Activity</h3>
      <div className="history">
        {[...e.history].reverse().map((h, i) => (
          <article key={i}>
            <b>{h.action}</b>
            <span>
              {h.at} · version {h.version}
            </span>
            <small>{h.details}</small>
          </article>
        ))}
      </div>
    </>
  );
}
function Editor({
  title,
  icon,
  add,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  add: () => void;
  children: React.ReactNode;
}) {
  return (
    <>
      <div className="sectionHead">
        <h3>
          {icon}
          {title}
        </h3>
        <button onClick={add}>
          <Plus />
          Add
        </button>
      </div>
      <div className="rows">
        {children || <Empty text="Nothing added yet." />}
      </div>
    </>
  );
}
function Row({
  children,
  remove,
}: {
  children: React.ReactNode;
  remove: () => void;
}) {
  return (
    <article className="row grid">
      {children}
      <button className="remove" onClick={remove}>
        Remove
      </button>
    </article>
  );
}
function Field({
  label,
  value,
  set,
  type = "text",
  wide = false,
  area = false,
}: {
  label: string;
  value: string | number;
  set: (v: string) => void;
  type?: string;
  wide?: boolean;
  area?: boolean;
}) {
  return (
    <label className={wide ? "wide" : ""}>
      {label}
      {area ? (
        <textarea value={value} onChange={(e) => set(e.target.value)} />
      ) : (
        <input
          type={type}
          value={value}
          onChange={(e) => set(e.target.value)}
        />
      )}
    </label>
  );
}
function Select({
  label,
  value,
  onChange,
  list,
}: {
  label: string;
  value?: string;
  onChange: (v: string) => void;
  list: readonly (string | { id: string; name: string })[];
}) {
  return (
    <label>
      {label}
      <select value={value || ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">All / choose</option>
        {list.map((x) =>
          typeof x === "string" ? (
            <option key={x}>{x}</option>
          ) : (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ),
        )}
      </select>
    </label>
  );
}
function setAt<T>(rows: T[], set: (x: T[]) => void, i: number, p: Partial<T>) {
  set(rows.map((x, n) => (n === i ? { ...x, ...p } : x)));
}
