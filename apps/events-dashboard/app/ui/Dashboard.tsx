"use client";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  Plus,
  X,
  Users,
  ChefHat,
  CheckSquare,
  AlertTriangle,
} from "lucide-react";
import type { EventRecord, Staffing, Production, EventTask } from "@/lib/types";
import { PUBLIC_CONFIG as C } from "@/lib/config";
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
export default function Dashboard() {
  const [records, setRecords] = useState<RecordView[]>([]),
    [actor, setActor] = useState<Actor | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [current, setCurrent] = useState<EventRecord | null>(null),
    [tab, setTab] = useState("Overview"),
    [dirty, setDirty] = useState(false),
    [filters, setFilters] = useState<Record<string, string>>({});
  async function load() {
    setLoading(true);
    try {
      const r = await fetch("/api/events", { cache: "no-store" }),
        j = await r.json();
      if (!r.ok) throw Error(j.error.message);
      setRecords(j.records);
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
          FIKA<span>OS</span>
        </div>
        <div>
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
        <Filters values={filters} set={setFilters} />
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
              {["Overview", "Staffing", "Production", "Tasks", "Activity"].map(
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
                <Overview e={current} change={change} />
              ) : tab === "Staffing" ? (
                <StaffingEditor
                  rows={current.staffingRequirements}
                  set={(x) => change({ staffingRequirements: x })}
                />
              ) : tab === "Production" ? (
                <ProductionEditor
                  rows={current.productionRequirements}
                  set={(x) => change({ productionRequirements: x })}
                />
              ) : tab === "Tasks" ? (
                <TaskEditor
                  rows={current.tasks}
                  set={(x) => change({ tasks: x })}
                />
              ) : (
                <Activity e={current as RecordView} />
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
  siteId: e.siteId,
  eventContact: e.eventContact,
  accountableOwnerId: e.accountableOwnerId,
  contributorIds: e.contributorIds,
  lifecycleStatus: e.lifecycleStatus,
  staffingRequirements: e.staffingRequirements,
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
const name = (xs: readonly { id: string; name: string }[], v: string) =>
  xs.find((x) => x.id === v)?.name || "Unassigned";
function Filters({
  values,
  set,
}: {
  values: Record<string, string>;
  set: (x: Record<string, string>) => void;
}) {
  const f = (k: string, v: string) => set({ ...values, [k]: v });
  return (
    <section className="filters">
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
        list={C.oplocs}
      />
      <Select
        label="Site"
        value={values.siteId}
        onChange={(v) => f("siteId", v)}
        list={C.sites}
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
        list={C.people}
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
    </section>
  );
}
function EventCard({ r, open }: { r: RecordView; open: () => void }) {
  return (
    <button className="event" onClick={open}>
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
      <Cell l="Site" v={name(C.sites, r.siteId)} />
      <Cell l="OPLOC" v={name(C.oplocs, r.responsibleOplocId)} />
      <Cell l="Owner" v={name(C.people, r.accountableOwnerId)} />
      <Cell l="Lifecycle" v={r.lifecycleStatus} />
      <Cell
        l="Readiness"
        v={`${r.readiness.percentage}%`}
        warn={!r.readiness.complete}
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
function Overview({
  e,
  change,
}: {
  e: EventRecord;
  change: (x: Partial<EventRecord>) => void;
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
        onChange={(v) => change({ responsibleOplocId: v })}
        list={C.oplocs}
      />
      <Select
        label="Service / delivery site"
        value={e.siteId}
        onChange={(v) => change({ siteId: v })}
        list={C.sites}
      />
      <Field
        label="Event Contact"
        value={e.eventContact}
        set={(v) => change({ eventContact: v })}
      />
      <Select
        label="Accountable owner"
        value={e.accountableOwnerId}
        onChange={(v) => change({ accountableOwnerId: v })}
        list={C.people}
      />
      <label className="wide">
        Contributors
        <select
          multiple
          value={e.contributorIds}
          onChange={(x) =>
            change({
              contributorIds: [...x.target.selectedOptions].map((o) => o.value),
            })
          }
        >
          {C.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
function StaffingEditor({
  rows,
  set,
}: {
  rows: Staffing[];
  set: (x: Staffing[]) => void;
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
            list={C.staffRoles}
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
            list={[...C.oplocs, ...C.sites]}
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
              {C.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <small>
              {r.assignedPersonIds.length} of {r.requiredHeadcount}{" "}
              assigned—planning only, not a rota entry.
            </small>
          </label>
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
}: {
  rows: Production[];
  set: (x: Production[]) => void;
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
          <Select
            label="Intended producer"
            value={r.productionUnitId}
            onChange={(v) => setAt(rows, set, i, { productionUnitId: v })}
            list={C.productionUnits}
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
            list={C.people}
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
}: {
  rows: EventTask[];
  set: (x: EventTask[]) => void;
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
            list={C.people}
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
