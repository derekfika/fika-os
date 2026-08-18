import { randomUUID } from "node:crypto";
import { EVENT_TYPES, LIFECYCLES, TASK_STATUSES } from "./config";
import type { EventRecord, EventTask, Production, Staffing } from "./types";

const txt = (value: unknown, limit = 1000) => typeof value === "string" ? value.trim().slice(0, limit) : "";
const arr = (value: unknown) => Array.isArray(value) ? value : [];

export function readiness(event: EventRecord, now = new Date()) {
  const labels = ["Event name", "Event type", "brief", "date", "start time", "end time", "timezone", "pax", "OPLOC", "Event Contact", "owner"];
  const values = [event.eventName, event.eventType, event.description, event.eventDate, event.startTime, event.endTime, event.timezone, event.pax, event.responsibleOplocId, event.eventContact, event.accountableOwnerId];
  const missing = labels.filter((_, index) => !values[index]);
  const staffingGaps = event.staffingRequirements.reduce((count, requirement) => count + Math.max(0, requirement.requiredHeadcount - requirement.assignedPersonIds.length), 0);
  const staffingIncomplete = event.staffingRequirements.filter(requirement => !requirement.role || !requirement.requiredHeadcount || !requirement.startTime || !requirement.endTime || (requirement.requiredHeadcount > requirement.assignedPersonIds.length && requirement.planningStatus !== "Unresolved"));
  const productionIncomplete = event.productionRequirements.filter(requirement => !requirement.item || !requirement.quantity || !requirement.unit || !requirement.requiredAt || !requirement.productionUnitId || !requirement.destination);
  const activeTasks = event.tasks.filter(task => !["Done", "Cancelled"].includes(task.status));
  const blocked = activeTasks.filter(task => task.status === "Blocked");
  const overdue = activeTasks.filter(task => task.dueAt && new Date(task.dueAt) < now);
  const areas = { details: { complete: !missing.length, reasons: missing.map(item => `Missing ${item}`) }, staffing: { complete: !staffingIncomplete.length, reasons: staffingIncomplete.length ? [`${staffingGaps} staffing place(s) unfilled or incomplete`] : [] }, production: { complete: !productionIncomplete.length, reasons: productionIncomplete.length ? [`${productionIncomplete.length} production requirement(s) incomplete`] : [] }, tasks: { complete: !activeTasks.length, reasons: activeTasks.length ? [`${activeTasks.length} task(s) outstanding`] : [] } };
  const percentage = Object.values(areas).filter(area => area.complete).length * 25;
  return { areas, percentage, complete: percentage === 100, staffingGaps, productionGaps: productionIncomplete.length, blockedTasks: blocked.length, overdueTasks: overdue.length };
}

export function createEvent(input: Partial<EventRecord>, actor: string, now = new Date(), uuid = randomUUID): EventRecord {
  const iso = now.toISOString(); const date = txt(input.eventDate);
  const base: EventRecord = { recordType: "EVENT", eventId: `event:${uuid()}`, eventReference: `EVT-${date.replaceAll("-", "") || "DRAFT"}-${uuid().slice(0, 6).toUpperCase()}`, version: 1, createdAt: iso, createdBy: actor, updatedAt: iso, updatedBy: actor, eventName: "", eventType: "", description: "", eventDate: "", startTime: "", endTime: "", timezone: "Europe/London", pax: null, responsibleOplocId: "", operationalAreaId: "", serviceArrangementIds: [], equipmentAssetIds: [], siteId: "", eventContact: "", accountableOwnerId: "", contributorIds: [], lifecycleStatus: "Draft", staffingRequirements: [], productionRequirements: [], tasks: [], cancelledAt: null, history: [{ at: iso, by: actor, action: "CREATED", version: 1 }] };
  return normalise({ ...base, ...input }, base);
}

export function normalise(input: Partial<EventRecord>, base: EventRecord): EventRecord {
  const event = { ...base };
  for (const key of ["eventName", "eventType", "description", "eventDate", "startTime", "endTime", "timezone", "responsibleOplocId", "operationalAreaId", "siteId", "eventContact", "accountableOwnerId", "lifecycleStatus"] as const) if (key in input) (event as unknown as Record<string, unknown>)[key] = txt(input[key], key === "description" ? 3000 : 240);
  if ("pax" in input) event.pax = input.pax === null || input.pax === undefined || input.pax === ("" as never) ? null : Number(input.pax);
  if ("contributorIds" in input) event.contributorIds = arr(input.contributorIds).map(value => txt(value, 128)).filter(Boolean);
  if ("serviceArrangementIds" in input) event.serviceArrangementIds = arr(input.serviceArrangementIds).map(value => txt(value, 160)).filter(Boolean);
  if ("equipmentAssetIds" in input) event.equipmentAssetIds = arr(input.equipmentAssetIds).map(value => txt(value, 160)).filter(Boolean);
  if ("staffingRequirements" in input) event.staffingRequirements = arr(input.staffingRequirements).map(value => staffing(value as Partial<Staffing>));
  if ("productionRequirements" in input) event.productionRequirements = arr(input.productionRequirements).map(value => production(value as Partial<Production>));
  if ("tasks" in input) event.tasks = arr(input.tasks).map(value => task(value as Partial<EventTask>));
  return event;
}

const staffing = (row: Partial<Staffing>): Staffing => ({ id: txt(row.id) || `staffing:${randomUUID()}`, role: txt(row.role), requiredHeadcount: Number(row.requiredHeadcount) || 0, assignedPersonIds: arr(row.assignedPersonIds).map(value => txt(value)), startTime: txt(row.startTime), endTime: txt(row.endTime), locationId: txt(row.locationId), notes: txt(row.notes), manualSelectionReason: txt(row.manualSelectionReason), planningStatus: row.planningStatus || "Unfilled" });
const production = (row: Partial<Production>): Production => ({ id: txt(row.id) || `production:${randomUUID()}`, item: txt(row.item), quantity: row.quantity == null ? null : Number(row.quantity), unit: txt(row.unit), requiredAt: txt(row.requiredAt), productionUnitId: txt(row.productionUnitId), destination: txt(row.destination), dietaryWarning: txt(row.dietaryWarning), notes: txt(row.notes), planningStatus: row.planningStatus || "Incomplete", responsiblePersonId: txt(row.responsiblePersonId) });
const task = (row: Partial<EventTask>): EventTask => ({ id: txt(row.id) || `task:${randomUUID()}`, title: txt(row.title), description: txt(row.description), ownerId: txt(row.ownerId), dueAt: txt(row.dueAt), status: row.status || "To Do", blockedReason: txt(row.blockedReason), completedAt: txt(row.completedAt) });

export function validate(event: EventRecord) { const errors: string[] = []; if (!LIFECYCLES.includes(event.lifecycleStatus as never)) errors.push("Unknown lifecycle"); if (event.eventType && !EVENT_TYPES.includes(event.eventType as never)) errors.push("Unknown Event type"); if (event.pax !== null && (!Number.isInteger(event.pax) || event.pax < 1)) errors.push("Pax must be a positive whole number"); if (event.startTime && event.endTime && event.startTime >= event.endTime) errors.push("End time must be after start time"); event.productionRequirements.forEach(requirement => { if (requirement.quantity !== null && requirement.quantity <= 0) errors.push("Production quantity must be positive"); }); event.tasks.forEach(task => { if (!TASK_STATUSES.includes(task.status as never)) errors.push("Unknown task status"); if (task.status === "Blocked" && !task.blockedReason) errors.push("Blocked task requires a reason"); }); return [...new Set(errors)]; }
const transitions: Record<string, string[]> = { Draft: ["Planned", "Cancelled"], Planned: ["Draft", "Confirmed", "Cancelled"], Confirmed: ["Planned", "In Progress", "Cancelled"], "In Progress": ["Completed", "Cancelled"], Completed: [], Cancelled: ["Draft"] };
export function updateEvent(old: EventRecord, input: Partial<EventRecord>, expected: number, actor: string, now = new Date()) { if (old.version !== expected) throw Object.assign(new Error("Event changed elsewhere. Reload before saving."), { code: "VERSION_CONFLICT" }); const event = normalise(input, old); if (event.lifecycleStatus !== old.lifecycleStatus) { if (!transitions[old.lifecycleStatus]?.includes(event.lifecycleStatus)) throw new Error(`Cannot move from ${old.lifecycleStatus}`); const gaps = readiness(event, now).areas.details.reasons; if (event.lifecycleStatus !== "Draft" && event.lifecycleStatus !== "Cancelled" && gaps.length) throw new Error(`Complete essential details first: ${gaps.join(", ")}`); } event.version = old.version + 1; event.updatedAt = now.toISOString(); event.updatedBy = actor; if (event.lifecycleStatus === "Cancelled" && old.lifecycleStatus !== "Cancelled") event.cancelledAt = event.updatedAt; event.history = [...old.history, { at: event.updatedAt, by: actor, action: event.lifecycleStatus !== old.lifecycleStatus ? event.lifecycleStatus === "Cancelled" ? "CANCELLED" : "LIFECYCLE_CHANGED" : "UPDATED", version: event.version, details: input.staffingRequirements ? "Staffing selections updated; any manual selection rationale is retained with the Event." : undefined }]; const errors = validate(event); if (errors.length) throw new Error(errors.join("; ")); return event; }
