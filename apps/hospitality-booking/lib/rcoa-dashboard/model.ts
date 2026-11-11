import type { GallagherBooking } from "../gallagher-dashboard";

export type RcoaDashboardService = {
  reference: string;
  eventType: string;
  eventDate: string;
  startTime: string;
  endTime: string;
  location: string;
  guestCount: number | null;
  lifecycleStatus: string;
  amended: boolean;
  groupId?: string;
  groupSize?: number;
  groupSequence?: number;
  items: Array<{ name: string; quantity: number | null }>;
};

export type RcoaDashboardServiceDetail = Omit<RcoaDashboardService, "groupId" | "groupSize" | "groupSequence">;

export type RcoaDashboardBooking = GallagherBooking & {
  displayStatus: string;
  persistedCompleted: boolean;
  persistedCancelled: boolean;
  services: RcoaDashboardServiceDetail[];
};

const cancelled = (service: RcoaDashboardService) => /^cancelled$/i.test(service.lifecycleStatus);
const completed = (service: RcoaDashboardService) => /^completed$/i.test(service.lifecycleStatus);
const compareService = (a: RcoaDashboardService, b: RcoaDashboardService) => a.eventDate.localeCompare(b.eventDate) || a.startTime.localeCompare(b.startTime) || (a.groupSequence || 0) - (b.groupSequence || 0) || a.reference.localeCompare(b.reference);

function displayStatus(services: RcoaDashboardService[]) {
  const cancelledCount = services.filter(cancelled).length;
  if (cancelledCount === services.length) return "Cancelled";
  if (cancelledCount) return "Partially cancelled";
  if (services.every(completed)) return "Completed";
  if (services.some(service => service.amended)) return "Amended";
  const statuses = [...new Set(services.map(service => service.lifecycleStatus).filter(Boolean))];
  return statuses.length === 1 ? statuses[0] : "In progress";
}

function dashboardRow(servicesInput: RcoaDashboardService[]): RcoaDashboardBooking {
  const services = [...servicesInput].sort(compareService);
  const first = services[0];
  const status = displayStatus(services);
  const group = Boolean(first.groupId);
  const reference = group ? first.reference : first.reference;
  const items = services.flatMap(service => service.items.map(item => ({ ...item, ...(group ? { notes: service.eventType } : {}) })));
  return {
    source: "fika-os",
    sourceBookingId: reference,
    bookingReference: reference,
    date: first.eventDate,
    startTime: group ? services.map(service => service.startTime).filter(Boolean).sort()[0] || "" : first.startTime,
    endTime: group ? services.map(service => service.endTime).filter(Boolean).sort().at(-1) || "" : first.endTime,
    guestCount: group ? null : first.guestCount,
    items,
    totalPrice: null,
    company: first.eventType || "Hospitality booking",
    bookingCompany: "",
    endClientCompany: "",
    requesterName: "",
    requesterEmail: "",
    location: [...new Set(services.map(service => service.location).filter(Boolean))].join(" · "),
    poReference: "",
    status: status === "Cancelled" ? "Cancelled" : status === "Completed" ? "Completed" : "Upcoming",
    notes: "",
    createdAt: "",
    updatedAt: "",
    displayStatus: status,
    persistedCompleted: services.every(completed),
    persistedCancelled: services.every(cancelled),
    services: services.map(({ groupId: _groupId, groupSize: _groupSize, groupSequence: _groupSequence, ...service }) => service),
  };
}

/** Group All Day child records into one dashboard row without summing repeated service guests. */
export function buildRcoaDashboardRows(services: RcoaDashboardService[]): RcoaDashboardBooking[] {
  const groups = new Map<string, RcoaDashboardService[]>();
  const standalone: RcoaDashboardService[] = [];
  const references = new Set<string>();
  for (const service of services) {
    if (!service.reference || references.has(service.reference)) throw new Error("RCoA dashboard data contains a duplicate or missing booking reference.");
    references.add(service.reference);
    if (service.groupId) groups.set(service.groupId, [...(groups.get(service.groupId) || []), service]);
    else standalone.push(service);
  }
  const rows = standalone.map(service => dashboardRow([service]));
  for (const [groupId, children] of groups) {
    const expected = new Set(children.map(child => child.groupSize).filter((size): size is number => typeof size === "number" && Number.isInteger(size) && size > 0));
    const sequences = new Set(children.map(child => child.groupSequence).filter((sequence): sequence is number => typeof sequence === "number" && Number.isInteger(sequence) && sequence > 0));
    const dates = new Set(children.map(child => child.eventDate));
    if (expected.size !== 1 || sequences.size !== children.length || dates.size !== 1 || children.length !== [...expected][0]) {
      throw new Error(`RCoA grouped booking ${groupId} is incomplete or inconsistent.`);
    }
    rows.push(dashboardRow(children));
  }
  return rows.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.bookingReference.localeCompare(b.bookingReference));
}
