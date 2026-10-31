"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { quantityFromInput, quantityMinimumMessage, stepQuantityDown, stepQuantityUp } from "@/lib/quantity-entry";
import { portalBookingId, type PortalMenuItem } from "@/lib/mnk-contract";
import { hospitalitySiteThemeStyle, portalSite } from "@/lib/portal-sites";
import { BookingDatePicker, useBookingClock } from "./BookingDatePicker";
import { bookingPolicyFor } from "@fika/server-shared/hospitality-effective-offering";
import { BOOKING_NOTICE_SHORT } from "../../lib/booking-notice";
import StartAgainButton from "./StartAgainButton";
import GuestCountInput, { GuestCountNotice } from "./GuestCountInput";
import { guestCountMessage } from "../../lib/guest-count";
import {
  addAllDayService,
  applyAllDayDefaults,
  applyServiceItems,
  applySharedView,
  changeAllDayServiceCategory,
  composeServiceDraft,
  composeSharedView,
  createEmptyAllDay,
  duplicateAllDayService,
  RCOA_ALL_DAY,
  removeAllDayService,
  removeAllDayServiceItem,
  sortedAllDayServices,
  summarizeAllDay,
  updateAllDayService,
  validateAllDay,
  type AllDayDraft,
} from "@/lib/rcoa-all-day";
import {
  calculateRcoaTotal,
  createEmptyRcoaDraft,
  RCOA_MAX_SERVICES,
  type RcoaEventType,
  filterRcoaMenu,
  rcoaAcknowledgementLabels,
  rcoaAllowedCategories,
  rcoaEventTypes,
  rcoaMinimumQuantity,
  rcoaGuestMinimum,
  rcoaNoticeWarnings,
  retainRcoaLinesForOccasion,
  rcoaSuggestedQuantity,
  validateRcoaStep,
  type RcoaBookingDraft,
  type RcoaChoiceValue,
  type RcoaLine,
  integerFieldText,
} from "@/lib/rcoa-portal";
import { buildAllDayClientRequests, buildRcoaClientRequest } from "@/lib/rcoa-booking-request-client";
import { loadHospitalityPortalMenu } from "@/lib/hospitality-portal-catalogue";
import styles from "./RcoaBookingPortal.module.css";

const stepLabels = ["Occasion", "Contact", "Event", "Menu", "Dietaries", "Review"];
const allDayStepLabels = ["Offering", "Event details", "Build your day", "Dietaries", "Review"];
const summaryKey = "fika-rcoa-confirmed-summary:v1";
const attemptKey = "fika-rcoa-submit-attempt:v1";
const draftKey = "fika-rcoa-booking-draft:v1";
const contactKey = "fika-rcoa-remembered-contact:v1";
const requestIdKey = "fika-rcoa-request-id:v1";
const submissionKey = "fika-rcoa-confirmed-request:v1";
const dietaryFields = [
  ["vegetarian", "Vegetarian"],
  ["vegan", "Vegan"],
  ["glutenFree", "Gluten-free"],
  ["coeliac", "Coeliac"],
  ["dairyFree", "Dairy-free"],
  ["halal", "Halal"],
  ["otherCount", "Other dietary guests"],
] as const;

type Errors = Record<string, string>;
const fieldErrorId = (field: string) => `rcoa-error-${field.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
const money = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

function ErrorMessage({ field, errors }: { field: string; errors: Errors }) {
  return errors[field] ? <span className={styles.fieldError} id={fieldErrorId(field)}>{errors[field]}</span> : null;
}

function fieldProps(field: string, errors: Errors) {
  return errors[field]
    ? { "aria-invalid": true as const, "aria-describedby": fieldErrorId(field) }
    : { "aria-invalid": undefined, "aria-describedby": undefined };
}

function safeDraft(value: unknown): RcoaBookingDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const empty = createEmptyRcoaDraft();
  const candidate = value as Partial<RcoaBookingDraft>;
  if (typeof candidate.occasion !== "string" || !Array.isArray(candidate.lines)) return undefined;
  return {
    ...empty,
    ...candidate,
    contact: { ...empty.contact, ...(candidate.contact || {}) },
    event: { ...empty.event, ...(candidate.event || {}) },
    dietaries: { ...empty.dietaries, ...(candidate.dietaries || {}) },
    acknowledgements: { ...empty.acknowledgements, ...(candidate.acknowledgements || {}) },
    lines: candidate.lines.filter((line): line is RcoaLine => Boolean(line && typeof line.itemId === "string" && Number.isFinite(line.quantity))),
  };
}

function safeAllDay(value: unknown): AllDayDraft | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<AllDayDraft>;
  if (!Array.isArray(candidate.services) || !candidate.services.length) return undefined;
  const empty = createEmptyAllDay();
  return {
    ...empty, ...candidate,
    contact: { ...empty.contact, ...(candidate.contact || {}) },
    dietaries: { ...empty.dietaries, ...(candidate.dietaries || {}) },
    acknowledgements: { ...empty.acknowledgements, ...(candidate.acknowledgements || {}) },
    services: candidate.services.slice(0, RCOA_MAX_SERVICES).map((service, index) => ({
      id: typeof service?.id === "string" ? service.id : `restored-${index}`, category: typeof service?.category === "string" ? service.category : "", startTime: typeof service?.startTime === "string" ? service.startTime : "",
      guestCount: Number.isFinite(service?.guestCount) ? service.guestCount : 0, location: typeof service?.location === "string" ? service.location : "", notes: typeof service?.notes === "string" ? service.notes : "",
      lines: (Array.isArray(service?.lines) ? service.lines : []).filter((line): line is RcoaLine => Boolean(line && typeof line.itemId === "string" && Number.isFinite(line.quantity))),
    })),
  };
}

export default function RcoaBookingPortal({ configured }: { configured: boolean }) {
  const site = portalSite("rcoa");
  const theme = hospitalitySiteThemeStyle(site) as CSSProperties;
  // Two flows share this screen: the ordinary single-offering booking (unchanged) and All Day Hospitality.
  const [flow, setFlow] = useState<"standard" | "all-day">("standard");
  const [standardDraft, setStandardDraft] = useState<RcoaBookingDraft>(createEmptyRcoaDraft);
  const now = useBookingClock();
  const [allDay, setAllDay] = useState<AllDayDraft>(createEmptyAllDay);
  const [editingServiceId, setEditingServiceId] = useState<string | null>(null);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [openNoteIds, setOpenNoteIds] = useState<string[]>([]);
  const [quantityTouched, setQuantityTouched] = useState<string[]>([]);
  const touchQuantity = (itemId: string) => setQuantityTouched((current) => current.includes(itemId) ? current : [...current, itemId]);
  const [confirmation, setConfirmation] = useState<Array<{ time: string; label: string; guests: number }> | null>(null);
  // The item screen, contact, dietaries and acknowledgements all operate on an ordinary RcoaBookingDraft: a service row while choosing its
  // items, otherwise the shared event. This is what lets the existing catalogue rules and validation apply unchanged.
  const editingService = editingServiceId ? allDay.services.find((service) => service.id === editingServiceId) : undefined;
  const draft = useMemo<RcoaBookingDraft>(() => flow === "standard" ? standardDraft : editingService ? composeServiceDraft(allDay, editingService.id) : composeSharedView(allDay), [flow, standardDraft, allDay, editingService]);
  const setDraft = (update: RcoaBookingDraft | ((current: RcoaBookingDraft) => RcoaBookingDraft)) => {
    if (flow === "standard") { setStandardDraft(update); return; }
    if (editingServiceId) { setAllDay((previous) => applyServiceItems(previous, editingServiceId, typeof update === "function" ? update(composeServiceDraft(previous, editingServiceId)) : update)); return; }
    setAllDay((previous) => applySharedView(previous, typeof update === "function" ? update(composeSharedView(previous)) : update));
  };
  const labels = flow === "all-day" ? allDayStepLabels : stepLabels;
  const [step, setStep] = useState(0);
  const [menu, setMenu] = useState<PortalMenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState("");
  const [catalogueWarning, setCatalogueWarning] = useState("");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [rememberContact, setRememberContact] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [bookingId, setBookingId] = useState("");
  const [restoredDraft, setRestoredDraft] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [message, setMessage] = useState("");
  const [resetOpen, setResetOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [reference, setReference] = useState("");
  const sendingRef = useRef(false);
  // A submission only counts when the person pressed the send button (see the button keys below).
  const submitIntentRef = useRef(false);
  const wasResetOpen = useRef(false);
  const resetTriggerRef = useRef<HTMLButtonElement>(null);
  const resetCancelRef = useRef<HTMLButtonElement>(null);
  const resetDialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const newRequestId = portalBookingId("rcoa");
    setBookingId(newRequestId);
    try {
      const completedRequestId = window.localStorage.getItem(submissionKey);
      const hasConfirmedRequest = Boolean(completedRequestId && /^RCOA-[A-Z0-9-]{8,80}$/i.test(completedRequestId));
      if (hasConfirmedRequest) setReference(completedRequestId!);
      const savedRequestId = window.localStorage.getItem(requestIdKey);
      const storedRequestId = hasConfirmedRequest ? completedRequestId : savedRequestId;
      const stableRequestId = storedRequestId && /^RCOA-[A-Z0-9-]{8,80}$/i.test(storedRequestId) ? storedRequestId : newRequestId;
      setBookingId(stableRequestId);
      window.localStorage.setItem(requestIdKey, stableRequestId);
      const saved = hasConfirmedRequest ? undefined : JSON.parse(window.localStorage.getItem(draftKey) || "null");
      if (hasConfirmedRequest) { try { const summary = JSON.parse(window.localStorage.getItem(summaryKey) || "null"); if (Array.isArray(summary) && summary.length) setConfirmation(summary); } catch { /* optional */ } }
      if (saved && saved.flow === "all-day") {
        const restoredAllDay = safeAllDay(saved.allDay);
        if (restoredAllDay) {
          setFlow("all-day");
          setAllDay(restoredAllDay);
          setStep(Math.max(0, Math.min(allDayStepLabels.length - 1, Number(saved.step) || 0)));
          setRestoredDraft(true);
        }
      } else {
        const restored = safeDraft(saved);
        if (restored) {
          setStandardDraft(restored);
          setStep(Math.max(0, Math.min(stepLabels.length - 1, Number((restored as RcoaBookingDraft & { step?: number }).step) || 0)));
          setRestoredDraft(true);
        }
      }
      const savedContact = JSON.parse(window.localStorage.getItem(contactKey) || "null") as RcoaBookingDraft["contact"] | null;
      if (savedContact && typeof savedContact === "object") {
        setRememberContact(true);
        setDraft((current) => ({ ...current, contact: { ...current.contact, ...savedContact } }));
      }
    } catch {
      try { window.localStorage.removeItem(draftKey); } catch { /* Storage is optional. */ }
    } finally {
      setDraftReady(true);
    }
  }, []);

  useEffect(() => {
    if (!draftReady || reference) return;
    try {
      window.localStorage.setItem(draftKey, JSON.stringify(flow === "all-day" ? { flow, allDay, step } : { ...standardDraft, step }));
    } catch {
      // A full or unavailable browser store must not block a booking request.
    }
  }, [draftReady, flow, standardDraft, allDay, step, reference]);

  useEffect(() => {
    if (!draftReady) return;
    try {
      if (rememberContact) window.localStorage.setItem(contactKey, JSON.stringify(draft.contact));
      else window.localStorage.removeItem(contactKey);
    } catch {
      // Remembered contact details are optional convenience data.
    }
  }, [draftReady, rememberContact, draft.contact]);

  useEffect(() => {
    let active = true;
    loadHospitalityPortalMenu("rcoa")
      .then(({ menu: nextMenu, catalogue }) => {
        if (!active) return;
        setMenu(nextMenu);
        setCatalogueWarning(catalogue.source === "cache-unverified" ? "Showing the last saved menu. Its current version could not be verified; check your connection and refresh before submitting." : "");
      })
      .catch((cause) => { if (active) setMenuError((cause as Error).message); })
      .finally(() => { if (active) setMenuLoading(false); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!resetOpen) return;
    resetCancelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setResetOpen(false);
      if (event.key === "Tab" && resetDialogRef.current) {
        const buttons = [...resetDialogRef.current.querySelectorAll<HTMLButtonElement>("button:not([disabled])")];
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [resetOpen]);

  useEffect(() => {
    if (!resetOpen && wasResetOpen.current) resetTriggerRef.current?.focus();
    wasResetOpen.current = resetOpen;
  }, [resetOpen]);

  const allowedCategories = useMemo(() => rcoaAllowedCategories(draft.occasion, menu), [draft.occasion, menu]);
  useEffect(() => {
    if (category !== "all" && !allowedCategories.some((allowedCategory) => allowedCategory === category)) setCategory("all");
  }, [allowedCategories, category]);
  const fridayBlocked = (item: PortalMenuItem) => !!draft.event.eventDate && new Date(draft.event.eventDate + "T12:00:00Z").getUTCDay() === 5 && (item.bookingPolicy?.fridayUnavailable || bookingPolicyFor(item.id).fridayUnavailable);
  const visibleMenu = filterRcoaMenu(menu, draft.occasion, category, search).filter(item => !fridayBlocked(item));
  const unavailableLines = draft.lines.filter((line) => {
    const item = menu.find((candidate) => candidate.id === line.itemId);
    return !item || fridayBlocked(item) || (Boolean(draft.occasion) && !allowedCategories.some((category) => category === item.category));
  });
  const total = calculateRcoaTotal(draft.lines, menu);
  const selected = draft.lines.flatMap((line) => {
    const item = menu.find((candidate) => candidate.id === line.itemId);
    return item && line.quantity > 0 ? [{ line, item }] : [];
  });
  const guestMinimum = rcoaGuestMinimum(draft, menu);
  const guestIssue = guestCountMessage(draft.event.guestCount, guestMinimum);
  const invalidService = allDay.services.find(service => guestCountMessage(service.guestCount, rcoaGuestMinimum({ contact: allDay.contact, lines: service.lines }, menu)));
  const warnings = rcoaNoticeWarnings(draft, menu);
  const currentEvent = rcoaEventTypes.find((event) => event.id === draft.occasion);
  const rcoaConfigured = configured;

  const updateContact = (key: keyof RcoaBookingDraft["contact"], value: string) => setDraft((current) => ({ ...current, contact: { ...current.contact, [key]: value } }));
  /** A newly chosen date supersedes any earlier date error; it is re-validated on Continue. */
  const clearEventDateError = () => setErrors(current => { if (!("eventDate" in current)) return current; const next = { ...current }; delete next.eventDate; return next; });
  const updateEvent = (key: keyof RcoaBookingDraft["event"], value: string | number) => setDraft((current) => ({ ...current, event: { ...current.event, [key]: value } }));
  // Text shown while a dietary count is being edited (so "01" never appears and the field can be cleared); the stored value is numeric.
  const [dietaryText, setDietaryText] = useState<Record<string, string>>({});
  const updateDietary = (key: keyof RcoaBookingDraft["dietaries"], value: string | number | boolean) => setDraft((current) => ({ ...current, dietaries: { ...current.dietaries, [key]: value, ...(key !== "hasDietaries" ? { hasDietaries: true } : {}) } }));

  const setQuantity = (item: PortalMenuItem, requested: number) => {
    setDraft((current) => {
      // Free entry: the minimum is not applied here (it ran on every keystroke and turned 10 into 80). It is reported on blur and by step validation.
      const quantity = quantityFromInput(requested);
      const existing = current.lines.find((line) => line.itemId === item.id);
      const lines = quantity > 0
        ? [...current.lines.filter((line) => line.itemId !== item.id), { itemId: item.id, quantity, choices: existing?.choices || {} }]
        : current.lines.filter((line) => line.itemId !== item.id);
      return { ...current, lines };
    });
  };

  const setChoice = (item: PortalMenuItem, groupId: string, value: RcoaChoiceValue) => {
    setDraft((current) => ({
      ...current,
      lines: current.lines.map((line) => line.itemId === item.id ? { ...line, choices: { ...line.choices, [groupId]: value } } : line),
    }));
  };

  const changeOccasion = (occasion: RcoaBookingDraft["occasion"]) => {
    setFlow("standard");
    const retainedLines = retainRcoaLinesForOccasion(draft.lines, occasion, menu);
    const removedCount = draft.lines.length - retainedLines.length;
    setDraft((current) => ({ ...current, occasion, lines: retainRcoaLinesForOccasion(current.lines, occasion, menu) }));
    setErrors({});
    setMessage(removedCount ? `${removedCount} menu selection${removedCount === 1 ? " was" : "s were"} removed because ${removedCount === 1 ? "it is" : "they are"} not available for this occasion.` : "");
  };

  // ---- All Day Hospitality ---------------------------------------------------------------------------------------------------
  const focusField = (field: string) => window.setTimeout(() => {
    const target = document.querySelector<HTMLElement>(`[data-rcoa-field="${CSS.escape(field)}"]`);
    (target?.matches("input, select, textarea, button") ? target : target?.querySelector<HTMLElement>("input, select, textarea, button") || target)?.focus();
  }, 0);

  const chooseAllDay = () => { setFlow("all-day"); setEditingServiceId(null); setErrors({}); setMessage(""); };

  const goToAllDayStep = (nextStep: number) => {
    if (nextStep > step) {
      const failure = validateAllDay(allDay, menu);
      if (failure && failure.step <= step) {
        setStep(failure.step);
        setErrors(failure.errors);
        setMessage("Please review the highlighted information before continuing.");
        focusField(Object.keys(failure.errors)[0]);
        return;
      }
    }
    setErrors({});
    setMessage("");
    if (nextStep === 2) setAllDay((current) => applyAllDayDefaults(current));
    setStep(Math.max(0, Math.min(allDayStepLabels.length - 1, nextStep)));
  };

  const openItems = (serviceId: string) => {
    const service = allDay.services.find((candidate) => candidate.id === serviceId);
    if (!service?.category) { setErrors({ [`service:${serviceId}`]: "Choose a service type first." }); focusField(`service:${serviceId}`); return; }
    setErrors({}); setMessage(""); setSearch(""); setCategory("all"); setEditingServiceId(serviceId);
    window.scrollTo({ top: 0 });
  };
  const closeItems = (validate: boolean) => {
    if (validate) {
      const itemErrors = validateRcoaStep(3, draft, menu);
      if (Object.keys(itemErrors).length) {
        const guestError = itemErrors.guestCount;
        setErrors(guestError ? { items: `${guestError} Change the guest count for this service on your day.` } : itemErrors);
        setMessage("Please review the highlighted information before saving.");
        return;
      }
    }
    setErrors({}); setMessage(""); setEditingServiceId(null);
  };
  const changeServiceCategory = (serviceId: string, category: RcoaEventType | "") => {
    const result = changeAllDayServiceCategory(allDay, serviceId, category, menu);
    setAllDay(result.draft);
    setMessage(result.removed ? `${result.removed} menu selection${result.removed === 1 ? " was" : "s were"} removed because ${result.removed === 1 ? "it is" : "they are"} not available for this service.` : "");
  };
  const addService = () => { setAllDay((current) => addAllDayService(current)); setMessage(""); };
  const duplicateService = (serviceId: string) => { setAllDay((current) => duplicateAllDayService(current, serviceId)); setMessage("Service duplicated with its type, guests, location and items. Choose the new time."); };
  /** Removes one item from a service immediately; the basket, quantities and totals are derived from the same state, so they update with it. */
  const removeServiceItem = (serviceId: string, itemId: string) => { setAllDay((current) => removeAllDayServiceItem(current, serviceId, itemId)); setErrors((current) => { const next = { ...current }; delete next[`items:${serviceId}`]; return next; }); };
  const removeService = (serviceId: string) => { setAllDay((current) => removeAllDayService(current, serviceId)); setRemoveConfirmId(null); setErrors({}); setMessage("Service removed."); };
  const selectedItems = (lines: RcoaLine[]) => lines.flatMap((line) => { const item = menu.find((candidate) => candidate.id === line.itemId); return item && line.quantity > 0 ? [{ id: item.id, name: item.name, quantity: line.quantity }] : []; });
  const longDate = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${iso}T12:00:00Z`)) : "";
  const allDaySummary = summarizeAllDay(allDay);
  const view = flow === "standard"
    ? (["occasion", "contact", "event", "menu", "dietaries", "review"] as const)[step]
    : editingServiceId ? "menu" : (["occasion", "details", "build", "dietaries", "review"] as const)[step];

  const goToStep = (nextStep: number) => {
    if (flow === "all-day") { goToAllDayStep(nextStep); return; }
    const validation = validateRcoaStep(step, draft, menu);
    if (nextStep > step && Object.keys(validation).length) {
      setErrors(validation);
      setMessage("Please review the highlighted information before continuing.");
      const firstField = Object.keys(validation)[0];
      const guestMinimumError = validation.guestCount;
      if (step >= 3 && guestMinimumError) {
        setErrors({ guestCount: guestMinimumError });
        setMessage("Please update the guest count for the selected menu items.");
        setStep(2);
        window.setTimeout(() => document.querySelector<HTMLElement>('[data-rcoa-field="guestCount"]')?.focus(), 0);
        return;
      }
      window.setTimeout(() => {
        const target = document.querySelector<HTMLElement>(`[data-rcoa-field="${CSS.escape(firstField)}"]`);
        (target?.matches("input, select, textarea, button") ? target : target?.querySelector<HTMLElement>("input, select, textarea, button") || target)?.focus();
      }, 0);
      return;
    }
    setErrors({});
    setMessage("");
    setStep(Math.max(0, Math.min(stepLabels.length - 1, nextStep)));
  };

  const submitAllDay = async () => {
    if (!rcoaConfigured) { setMessage("RCoA booking is not available until the governed site mapping is configured."); return; }
    // Every service row is validated BEFORE anything is created.
    const failure = validateAllDay(allDay, menu);
    if (failure) {
      setStep(failure.step);
      setErrors(failure.errors);
      setMessage(failure.step === 4 ? "Please confirm each acknowledgement before sending your request." : "Please review the highlighted information before sending.");
      focusField(Object.keys(failure.errors)[0]);
      return;
    }
    if (!rcoaConfigured) { setMessage("RCoA booking is not available until the governed site mapping is configured."); return; }
    sendingRef.current = true;
    setSending(true);
    setErrors({});
    setMessage("");
    try {
      const stableRequestId = bookingId || portalBookingId("rcoa");
      if (!bookingId) setBookingId(stableRequestId);
      try { window.localStorage.setItem(requestIdKey, stableRequestId); } catch { /* The in-memory ID still protects retries in this page. */ }
      const submission = buildAllDayClientRequests(allDay, menu, { groupId: stableRequestId, submittedAt: new Date().toISOString() });
      const signature = JSON.stringify(submission.requests.map(({ submittedAt: _submittedAt, ...rest }) => rest));
      // A retry resends the same request. If part of an earlier attempt was already received, edits cannot be applied silently.
      let previous: { groupId?: string; signature?: string; completed?: number } | null = null;
      try { previous = JSON.parse(window.localStorage.getItem(attemptKey) || "null"); } catch { previous = null; }
      if (previous && previous.groupId === stableRequestId && (previous.completed || 0) > 0 && previous.signature !== signature) {
        setMessage("Part of your earlier request was already received, so it cannot be changed here. Please contact the hospitality team to amend it, or use Start again to send a new request.");
        return;
      }
      const response = await fetch("/api/bookings/rcoa/group", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(submission) });
      const result = await response.json();
      if (!response.ok) {
        try { window.localStorage.setItem(attemptKey, JSON.stringify({ groupId: stableRequestId, signature, completed: Number(result.group?.completed) || 0 })); } catch { /* optional */ }
        throw new Error(result.error?.message || "We could not send your request. Your saved draft is still available.");
      }
      const services = sortedAllDayServices(allDay).map((service) => ({ time: service.startTime, label: rcoaEventTypes.find((event) => event.id === service.category)?.label || "Service", guests: service.guestCount }));
      setConfirmation(services);
      setReference(stableRequestId);
      try {
        window.localStorage.setItem(submissionKey, stableRequestId);
        window.localStorage.setItem(summaryKey, JSON.stringify(services));
        window.localStorage.removeItem(attemptKey);
        window.localStorage.removeItem(draftKey);
      } catch { /* A confirmed request stays confirmed even when browser storage is unavailable. */ }
      setRestoredDraft(false);
    } catch (cause) {
      setMessage((cause as Error).message || "We could not send your request. Your saved draft is still available.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sendingRef.current) return;
    // Arriving on the review step swaps "Continue" for the send button in the same spot; that click must never count as a send attempt.
    if (!submitIntentRef.current) return;
    submitIntentRef.current = false;
    if (flow === "all-day") { await submitAllDay(); return; }
    const validation = validateRcoaStep(5, draft, menu);
    if (Object.keys(validation).length) {
      setErrors(validation);
      if (validation.guestCount) { setStep(2); focusField("guestCount"); }
      setMessage(validation.guestCount ? "Please update the guest count before sending your request." : "Please confirm each acknowledgement before sending your request.");
      return;
    }
    if (!rcoaConfigured) {
      setMessage("RCoA booking is not available until the governed site mapping is configured.");
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setErrors({});
    setMessage("");
    try {
      const stableRequestId = bookingId || portalBookingId("rcoa");
      if (!bookingId) setBookingId(stableRequestId);
      try { window.localStorage.setItem(requestIdKey, stableRequestId); } catch { /* The in-memory ID still protects retries in this page. */ }
      const body = buildRcoaClientRequest(draft, menu, { bookingId: stableRequestId, submittedAt: new Date().toISOString() });
      const response = await fetch("/api/bookings/rcoa", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message || "We could not send your request. Your saved draft is still available.");
      setReference(body.bookingId);
      try {
        window.localStorage.setItem(submissionKey, body.bookingId);
        window.localStorage.removeItem(draftKey);
      } catch { /* A confirmed request stays confirmed even when browser storage is unavailable. */ }
      setRestoredDraft(false);
    } catch (cause) {
      setMessage((cause as Error).message || "We could not send your request. Your saved draft is still available.");
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const reset = () => {
    const newRequestId = portalBookingId("rcoa");
    setBookingId(newRequestId);
    const sharedContact = rememberContact ? draft.contact : createEmptyRcoaDraft().contact;
    setFlow("standard");
    setStandardDraft({ ...createEmptyRcoaDraft(), contact: sharedContact });
    setAllDay({ ...createEmptyAllDay(), contact: sharedContact });
    setEditingServiceId(null);
    setRemoveConfirmId(null);
    setConfirmation(null);
    setStep(0);
    setSearch("");
    setCategory("all");
    setErrors({});
    setMessage("");
    setReference("");
    setRestoredDraft(false);
    setResetOpen(false);
    try {
      window.localStorage.removeItem(draftKey);
      window.localStorage.removeItem(submissionKey);
      window.localStorage.removeItem(summaryKey);
      window.localStorage.removeItem(attemptKey);
      window.localStorage.setItem(requestIdKey, newRequestId);
    } catch { /* Storage is optional. */ }
  };

  return (
    <main className={`${styles.page} ${site.cssClass}`} data-surface="client-branded-portal" data-client-brand="rcoa" style={theme}>
      <header className={styles.header}>
        <a className={styles.brand} href="/rcoa" aria-label="RCoA Hospitality home">
          <img src={site.logoPath} alt={site.displayName} onError={(event) => { event.currentTarget.hidden = true; const fallback = event.currentTarget.nextElementSibling as HTMLElement | null; if (fallback) fallback.style.display = "inline"; }} />
          <span className={styles.logoFallback} aria-hidden="true">RCoA</span>
        </a>
        <nav className={styles.categoryNav} aria-label="Booking categories">
          <span>Booking</span><span>Breakfast</span><span>Lunch</span><span>Afternoon</span>
          <span>Finger food</span><span>Bowl food &amp; canapes</span><span>Events</span>
        </nav>
        <StartAgainButton buttonRef={resetTriggerRef} className={styles.resetButton} onClick={() => setResetOpen(true)} />
      </header>

      <section className={styles.hero}>
        <div className={styles.heroInner}>
          <div>
            <p className={styles.eyebrow}>Royal College of Anaesthetists</p>
            <h1>Hospitality, thoughtfully arranged.</h1>
            <p className={styles.heroCopy}>Plan refreshments, working lunches and events at the College in one clear request.</p>
          </div>
          <div className={styles.heroGuide} aria-label="Booking overview"><span>Choose</span><i aria-hidden="true" /><span>Plan</span><i aria-hidden="true" /><span>Submit</span></div>
        </div>
      </section>

      {catalogueWarning && <p className="catalogue-warning" role="status">{catalogueWarning}</p>}

      {restoredDraft && <p className={styles.restoredNotice} role="status">Your unfinished booking has been restored.</p>}
      {reference ? (
        <section className={styles.confirmation} aria-labelledby="rcoa-confirm-title">
          <p className={styles.eyebrow}>Request received</p>
          <h2 id="rcoa-confirm-title">{confirmation ? "All Day Hospitality request submitted" : "Thank you. We will take it from here."}</h2>
          {confirmation && <ul className={styles.confirmationList}>{confirmation.map((service, index) => <li key={`${service.time}-${index}`}><strong>{service.time}</strong> — {service.label} — {service.guests} guests</li>)}</ul>}
          <p>Your reference is <strong>{reference}</strong>.</p>
          <p>The hospitality team will review availability, labour, equipment and VAT before confirming your booking.</p>
          <button className={styles.primaryButton} type="button" onClick={reset}>Make another booking</button>
        </section>
      ) : (
        <div className={styles.appShell}>
          <nav className={styles.stepper} aria-label="Booking progress">
            {labels.map((label, index) => (
              <button key={label} type="button" className={index === step ? styles.stepActive : index < step ? styles.stepComplete : styles.step} disabled={index > step} aria-current={index === step ? "step" : undefined} onClick={() => { setEditingServiceId(null); goToStep(index); }}>
                <span>0{index + 1}</span>{label}
              </button>
            ))}
          </nav>

          <form className={styles.formPanel} onSubmit={submit}>
            {message && <p className={styles.formMessage} role="alert" aria-live="polite">{message}</p>}
            {menuError && <p className={styles.formMessage} role="alert">{menuError}</p>}

            {view === "occasion" && (
              <section aria-labelledby="rcoa-occasion-title">
                <div className={styles.sectionHeading}>
                  <p className={styles.eyebrow}>Your occasion</p><h2 id="rcoa-occasion-title">What are we arranging?</h2>
                  <p>We will tailor the menu and notice guidance around your selection.</p>
                </div>
                <div className={styles.occasionGrid} data-rcoa-field="occasion" tabIndex={-1} aria-describedby={errors.occasion ? fieldErrorId("occasion") : undefined}>
                  {rcoaEventTypes.map((event) => (
                    <button className={draft.occasion === event.id ? styles.occasionSelected : styles.occasion} key={event.id} type="button" aria-pressed={draft.occasion === event.id} onClick={() => changeOccasion(event.id)}>
                      <strong>{event.label}</strong><span>{event.id === "bespoke" ? "A tailored proposal for a special event." : `Plan ${event.label.toLocaleLowerCase("en-GB")} hospitality at the College.`}</span>
                    </button>
                  ))}
                  <button className={flow === "all-day" ? styles.occasionSelected : styles.occasion} type="button" aria-pressed={flow === "all-day"} onClick={chooseAllDay}>
                    <strong>{RCOA_ALL_DAY.label}</strong><span>{RCOA_ALL_DAY.description}</span>
                  </button>
                </div>
                <ErrorMessage field="occasion" errors={errors} />
                {draft.occasion && <div className={styles.guidance} role="status"><strong>Notice guidance</strong><span>{currentEvent?.noticeType === "large" ? "Please allow at least seven working days for larger events." : BOOKING_NOTICE_SHORT}</span></div>}
              </section>
            )}

            {(view === "contact" || view === "details") && (
              <section aria-labelledby="rcoa-contact-title">
                <div className={styles.sectionHeading}><p className={styles.eyebrow}>Contact details</p><h2 id="rcoa-contact-title">Who should we speak to?</h2></div>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}><span>Name *</span><input {...fieldProps("name", errors)} data-rcoa-field="name" autoComplete="name" value={draft.contact.name} onChange={(event) => updateContact("name", event.target.value)} /><ErrorMessage field="name" errors={errors} /></label>
                  <label className={styles.field}><span>Work email *</span><input {...fieldProps("email", errors)} data-rcoa-field="email" type="email" autoComplete="email" value={draft.contact.email} onChange={(event) => updateContact("email", event.target.value)} /><ErrorMessage field="email" errors={errors} /></label>
                  <label className={styles.field}><span>Contact number *</span><input {...fieldProps("phone", errors)} data-rcoa-field="phone" type="tel" autoComplete="tel" value={draft.contact.phone} onChange={(event) => updateContact("phone", event.target.value)} /><ErrorMessage field="phone" errors={errors} /></label>
                  <label className={styles.field}><span>Company name *</span><input {...fieldProps("companyName", errors)} data-rcoa-field="companyName" autoComplete="organization" value={draft.contact.companyName} onChange={(event) => updateContact("companyName", event.target.value)} /><ErrorMessage field="companyName" errors={errors} /></label>
                  <label className={`${styles.field} ${styles.fieldWide}`}><span>Invoice / purchase order reference <small>(optional)</small></span><input value={draft.contact.invoiceReference} onChange={(event) => updateContact("invoiceReference", event.target.value)} placeholder="e.g. PO number, cost centre or internal reference" /></label>
                </div>
                <div className={styles.rememberRow}>
                  <label><input type="checkbox" checked={rememberContact} onChange={(event) => setRememberContact(event.target.checked)} /><span><strong>Remember my contact details on this browser</strong><small>Saved only in this browser.</small></span></label>
                  {rememberContact && <button type="button" className={styles.textButton} onClick={() => { setRememberContact(false); setDraft((current) => ({ ...current, contact: { ...current.contact, name: "", email: "", phone: "", companyName: "", invoiceReference: "" } })); }}>Forget saved details</button>}
                </div>
              </section>
            )}

            {view === "details" && (
              <section className={styles.allDayEventSection} aria-labelledby="rcoa-allday-event-title">
                <div className={styles.sectionHeading}><p className={styles.eyebrow}>All Day Hospitality</p><h2 id="rcoa-allday-event-title">Tell us about the event.</h2><p>Entered once. The guest count and location below pre-fill each service, and you can change them service by service.</p></div>
                <div className={styles.fieldGrid}>
                  <label className={`${styles.field} ${styles.fieldWide}`}><span>Event, lecture or meeting name <small>(optional)</small></span><input value={allDay.eventName} onChange={(event) => setAllDay((current) => ({ ...current, eventName: event.target.value }))} /></label>
                  <div className={styles.field}><BookingDatePicker value={allDay.eventDate} onChange={eventDate => { setAllDay(current => ({ ...current, eventDate })); clearEventDateError(); }} items={allDay.services.flatMap(service => service.lines.flatMap(line => menu.filter(item => item.id === line.itemId && line.quantity > 0)))} context={{ site: "rcoa", occasion: allDay.services.some(service => ["event_catering", "dining", "bespoke"].includes(service.category)) ? "event_catering" : "" }} now={now} /><ErrorMessage field="eventDate" errors={errors} /></div>
                  <label className={styles.field}><span>Usual number of guests</span><GuestCountInput value={allDay.defaultGuests} minimum={1} field="defaultGuests" surface="rcoa" submittedError={errors.defaultGuests} onChange={(value) => setAllDay((current) => ({ ...current, defaultGuests: value }))} /></label>
                  <label className={styles.field}><span>Usual room or location</span><input value={allDay.defaultLocation} onChange={(event) => setAllDay((current) => ({ ...current, defaultLocation: event.target.value }))} placeholder="e.g. Lecture Hall" /></label>
                  <label className={styles.field}><span>Floor level *</span><input {...fieldProps("floorLevel", errors)} data-rcoa-field="floorLevel" aria-required="true" value={allDay.floorLevel} onChange={(event) => setAllDay((current) => ({ ...current, floorLevel: event.target.value }))} placeholder="e.g. 7" /><ErrorMessage field="floorLevel" errors={errors} /></label>
                  <label className={styles.field}><span>Onsite contact name</span><input value={allDay.onsiteContactName} onChange={(event) => setAllDay((current) => ({ ...current, onsiteContactName: event.target.value }))} /></label>
                  <label className={styles.field}><span>Onsite contact phone</span><input type="tel" value={allDay.onsiteContactPhone} onChange={(event) => setAllDay((current) => ({ ...current, onsiteContactPhone: event.target.value }))} /></label>
                </div>
              </section>
            )}

            {view === "build" && (
              <section aria-labelledby="rcoa-build-title">
                <div className={styles.sectionHeading}>
                  <p className={styles.eyebrow}>All Day Hospitality</p><h2 id="rcoa-build-title">Build your day</h2>
                  <p>Add each service in the order it will happen. Choose a time, service type and menu for each one.</p>
                  {longDate(allDay.eventDate) && <p className={styles.eventDateLine}>{longDate(allDay.eventDate)}</p>}
                </div>
                <ol className={styles.dayList} aria-label="Services in your day">
                  {allDay.services.map((service, index) => {
                    const items = selectedItems(service.lines);
                    const typeLabel = rcoaEventTypes.find((type) => type.id === service.category)?.label;
                    const title = service.startTime && typeLabel ? `${service.startTime} — ${typeLabel}` : service.startTime || typeLabel || "New service";
                    const meta = [service.guestCount > 0 ? `${service.guestCount} guests` : "", service.location.trim()].filter(Boolean).join(" · ");
                    const noteOpen = Boolean(service.notes) || openNoteIds.includes(service.id);
                    return (
                      <li className={styles.dayRow} key={service.id} data-service-row={service.id}>
                        <div className={styles.serviceHead}>
                          <div>
                            <span className={styles.serviceNumber}>Service {index + 1}</span>
                            <h3 className={styles.serviceTitle}>{title}</h3>
                            {meta && <p className={styles.serviceMeta}>{meta}</p>}
                          </div>
                          <div className={styles.serviceMinor}>
                            <button type="button" className={styles.textAction} onClick={() => duplicateService(service.id)} disabled={allDay.services.length >= RCOA_MAX_SERVICES}>Duplicate</button>
                            <button type="button" className={`${styles.textAction} ${styles.textActionDanger}`} onClick={() => setRemoveConfirmId(service.id)} disabled={allDay.services.length <= 1}>Remove</button>
                          </div>
                        </div>
                        {removeConfirmId === service.id && <div className={styles.removeConfirm} role="alertdialog" aria-label="Remove this service"><span>Remove this service and its items?</span><button type="button" className={styles.dangerButton} onClick={() => removeService(service.id)}>Remove</button><button type="button" className={styles.secondaryButton} onClick={() => setRemoveConfirmId(null)}>Keep</button></div>}
                        <div className={styles.dayBoard}>
                          <div className={styles.serviceFields}>
                            <label className={styles.dayCell}><span className={styles.cellLabel}>Time</span><input {...fieldProps(`startTime:${service.id}`, errors)} data-rcoa-field={`startTime:${service.id}`} type="time" value={service.startTime} onChange={(event) => setAllDay((current) => updateAllDayService(current, service.id, { startTime: event.target.value }))} /><ErrorMessage field={`startTime:${service.id}`} errors={errors} /></label>
                            <label className={styles.dayCell}><span className={styles.cellLabel}>Service</span>
                              <select {...fieldProps(`service:${service.id}`, errors)} data-rcoa-field={`service:${service.id}`} value={service.category} onChange={(event) => changeServiceCategory(service.id, event.target.value as RcoaEventType | "")}>
                                <option value="">Choose a service</option>
                                {rcoaEventTypes.map((type) => <option key={type.id} value={type.id}>{type.label}</option>)}
                              </select><ErrorMessage field={`service:${service.id}`} errors={errors} /></label>
                            <label className={styles.dayCell}><span className={styles.cellLabel}>Guests</span><GuestCountInput value={service.guestCount} minimum={rcoaGuestMinimum({ contact: allDay.contact, lines: service.lines }, menu)} field={`guestCount:${service.id}`} surface="rcoa" submittedError={errors[`guestCount:${service.id}`]} onChange={guestCount => setAllDay(current => updateAllDayService(current, service.id, { guestCount }))} /></label>
                            <label className={styles.dayCell}><span className={styles.cellLabel}>Location</span><input {...fieldProps(`location:${service.id}`, errors)} data-rcoa-field={`location:${service.id}`} value={service.location} onChange={(event) => setAllDay((current) => updateAllDayService(current, service.id, { location: event.target.value }))} placeholder="e.g. Lecture Hall" /><ErrorMessage field={`location:${service.id}`} errors={errors} /></label>
                          </div>
                        </div>
                        <div className={styles.serviceItems}>
                          <div className={styles.serviceItemList}>
                            <span className={styles.cellLabel}>Items</span>
                            {items.length
                              ? <ul>{items.map((item) => <li key={item.id}><span>{item.name}<small> ×{item.quantity}</small></span><button type="button" className={styles.itemRemove} aria-label={`Remove ${item.name} from service ${index + 1}`} title="Remove item" onClick={() => removeServiceItem(service.id, item.id)}><span aria-hidden="true">×</span></button></li>)}</ul>
                              : <p className={styles.noItems}>No items selected yet</p>}
                            <ErrorMessage field={`items:${service.id}`} errors={errors} />
                          </div>
                          <button type="button" className={styles.itemsButton} data-rcoa-field={`items:${service.id}`} onClick={() => openItems(service.id)}>{items.length ? "Edit items" : "Add items"}</button>
                        </div>
                        {noteOpen ? (
                          <div className={styles.noteBlock}>
                            <label className={styles.dayCell}><span className={styles.cellLabel}>Note for this service</span><input value={service.notes} onChange={(event) => setAllDay((current) => updateAllDayService(current, service.id, { notes: event.target.value }))} placeholder="Anything the team should know about this service" /></label>
                            <button type="button" className={styles.textAction} onClick={() => { setAllDay((current) => updateAllDayService(current, service.id, { notes: "" })); setOpenNoteIds((current) => current.filter((id) => id !== service.id)); }}>Remove note</button>
                          </div>
                        ) : (
                          <button type="button" className={`${styles.textAction} ${styles.addNote}`} onClick={() => setOpenNoteIds((current) => [...current, service.id])}>+ Add note</button>
                        )}
                      </li>
                    );
                  })}
                </ol>
                <button type="button" className={styles.addService} onClick={addService} disabled={allDay.services.length >= RCOA_MAX_SERVICES}>+ Add service</button>
                <div className={styles.daySummary} role="status">
                  <strong>{allDaySummary.count} service{allDaySummary.count === 1 ? "" : "s"}</strong>
                  {allDaySummary.first && <span>{allDaySummary.first}{allDaySummary.last !== allDaySummary.first ? ` – ${allDaySummary.last}` : ""}</span>}
                  {allDaySummary.maxGuests > 0 && <span>{allDaySummary.minGuests === allDaySummary.maxGuests ? `${allDaySummary.maxGuests} guests each` : `Guest counts vary from ${allDaySummary.minGuests}–${allDaySummary.maxGuests}`}</span>}
                </div>
              </section>
            )}

            {view === "event" && (
              <section aria-labelledby="rcoa-event-title">
                <div className={styles.sectionHeading}><p className={styles.eyebrow}>Event details</p><h2 id="rcoa-event-title">When and where?</h2></div>
                <div className={styles.fieldGrid}>
                  <div className={styles.field}><BookingDatePicker value={draft.event.eventDate} onChange={eventDate => { updateEvent("eventDate", eventDate); clearEventDateError(); }} items={draft.lines.flatMap(line => menu.filter(item => item.id === line.itemId && line.quantity > 0))} context={{ site: "rcoa", occasion: draft.occasion, startTime: draft.event.startTime || undefined }} now={now} /><ErrorMessage field="eventDate" errors={errors} /></div>
                  <label className={styles.field}><span>Number of guests *</span><GuestCountInput value={draft.event.guestCount} minimum={guestMinimum} field="guestCount" surface="rcoa" submittedError={errors.guestCount} onChange={guestCount => updateEvent("guestCount", guestCount)} /></label>
                  <label className={styles.field}><span>Start / service time *</span><input {...fieldProps("startTime", errors)} data-rcoa-field="startTime" type="time" value={draft.event.startTime} onChange={(event) => updateEvent("startTime", event.target.value)} /><ErrorMessage field="startTime" errors={errors} /></label>
                  <label className={styles.field}><span>End time</span><input {...fieldProps("endTime", errors)} data-rcoa-field="endTime" type="time" value={draft.event.endTime} onChange={(event) => updateEvent("endTime", event.target.value)} /><ErrorMessage field="endTime" errors={errors} /></label>
                  <fieldset className={`${styles.field} ${styles.fieldWide}`}>
                    <legend>Delivery location</legend>
                    <p>These details help the Hospitality team find the correct room. * Required</p>
                    <label className={styles.field}><span>Floor level *</span><input {...fieldProps("floorLevel", errors)} data-rcoa-field="floorLevel" aria-required="true" value={draft.event.floorLevel} onChange={(event) => updateEvent("floorLevel", event.target.value)} placeholder="e.g. 7" /><ErrorMessage field="floorLevel" errors={errors} /></label>
                    <label className={styles.field}><span>Room or area *</span><input {...fieldProps("roomOrArea", errors)} data-rcoa-field="roomOrArea" aria-required="true" value={draft.event.roomOrArea} onChange={(event) => updateEvent("roomOrArea", event.target.value)} placeholder="e.g. Boardroom" /><ErrorMessage field="roomOrArea" errors={errors} /></label>
                    <label className={styles.field}><span>Delivery point, if different <small>(optional)</small></span><input value={draft.event.deliveryPoint} onChange={(event) => updateEvent("deliveryPoint", event.target.value)} /></label>
                  </fieldset>
                  <label className={styles.field}><span>Onsite contact name</span><input value={draft.event.onsiteContactName} onChange={(event) => updateEvent("onsiteContactName", event.target.value)} /></label>
                  <label className={styles.field}><span>Onsite contact phone</span><input type="tel" value={draft.event.onsiteContactPhone} onChange={(event) => updateEvent("onsiteContactPhone", event.target.value)} /></label>
                </div>
                {warnings.length > 0 && <div className={styles.warningList} role="status"><strong>Please note</strong>{warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
              </section>
            )}

            {view === "menu" && guestIssue && <GuestCountNotice message={guestIssue} label={editingServiceId ? "Edit service guest count" : "Edit guest count"} onEdit={() => { if (editingServiceId) { const serviceId = editingServiceId; setEditingServiceId(null); setStep(2); focusField(`guestCount:${serviceId}`); } else { setStep(2); focusField("guestCount"); } }} />}
            {flow === "all-day" && step > 2 && !editingServiceId && invalidService && <GuestCountNotice message={guestCountMessage(invalidService.guestCount, rcoaGuestMinimum({ contact: allDay.contact, lines: invalidService.lines }, menu))} label="Edit service guest count" onEdit={() => { setStep(2); focusField(`guestCount:${invalidService.id}`); }} />}
            {flow === "standard" && step > 3 && guestIssue && <GuestCountNotice message={guestIssue} onEdit={() => { setStep(2); focusField("guestCount"); }} />}
            {view === "menu" && (
              <section aria-labelledby="rcoa-menu-title">
                {editingService && <div className={styles.pickerBanner} role="status"><strong>Choosing items for {editingService.startTime || "this service"} · {rcoaEventTypes.find((type) => type.id === editingService.category)?.label} · {editingService.guestCount} guests</strong>{warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
                <div className={styles.menuHeading}>
                  <div className={styles.sectionHeading}><p className={styles.eyebrow}>Build your menu</p><h2 id="rcoa-menu-title">Choose what feels right.</h2></div>
                  <label className={styles.searchBox}><span>Search menu</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Try fruit, sushi or canapes" /></label>
                </div>
                <div className={styles.categoryTabs} role="group" aria-label="Menu categories">
                  <button type="button" aria-pressed={category === "all"} className={category === "all" ? styles.categoryActive : ""} onClick={() => setCategory("all")}>All available</button>
                  {allowedCategories.map((value) => <button type="button" key={value} aria-pressed={category === value} className={category === value ? styles.categoryActive : ""} onClick={() => setCategory(value)}>{value}</button>)}
                </div>
                {unavailableLines.length > 0 && <div className={styles.warningList} role="alert"><strong>Review saved menu selections</strong><span>Some saved items are no longer available or do not match this occasion. Remove them before continuing.</span>{unavailableLines.map((line) => {
                  const item = menu.find((candidate) => candidate.id === line.itemId);
                  return <div key={line.itemId} className={styles.unavailableLine}><span>{item?.name || "Menu item no longer available"}</span><button type="button" className={styles.textButton} aria-label={`Remove ${item?.name || "unavailable menu item"}`} onClick={() => setDraft((current) => ({ ...current, lines: current.lines.filter((candidate) => candidate.itemId !== line.itemId) }))}>Remove</button></div>;
                })}</div>}
                {menuLoading ? <p className={styles.emptyMenu} role="status">Loading the RCoA menu…</p> : (
                  <div className={styles.menuList} data-rcoa-field="items" tabIndex={-1}>
                    <ErrorMessage field="items" errors={errors} />
                    {visibleMenu.map((item) => {
                      const line = draft.lines.find((candidate) => candidate.itemId === item.id);
                      const suggestion = rcoaSuggestedQuantity(item, draft.event.guestCount);
                      return (
                        <article key={item.canonicalId} className={styles.menuItem}>
                          <div className={styles.menuItemCopy}>
                            <p className={styles.eyebrow}>{item.category}</p><h3>{item.name}</h3>
                            {item.description && <p>{item.description}</p>}
                            {item.servingInfo && <small>{item.servingInfo}</small>}
                            {item.unitPrice > 0 ? <strong>{money.format(item.unitPrice)} <small>{item.priceType === "per_item" ? "per item / stated serving" : ""}</small></strong> : <strong>Price on request</strong>}
                          </div>
                          <div className={styles.menuItemActions}>
                            {item.optionGroups?.map((group) => {
                              if (!line) return null;
                              const value = line.choices[group.id];
                              const fieldKey = `choice:${item.id}:${group.id}`;
                              const fieldError = errors[fieldKey];
                              const multi = ["multi", "checkbox", "checkboxes"].includes(group.selectionType.toLowerCase());
                              if (multi) {
                                const chosen = Array.isArray(value) ? value : [];
                                return <fieldset className={styles.choiceGroup} key={group.id} data-rcoa-field={fieldKey} tabIndex={-1} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? fieldErrorId(fieldKey) : undefined}><legend>{group.label}{group.required ? " *" : ""}</legend>{group.options.map((option) => <label key={option.id}><input type="checkbox" checked={chosen.includes(option.label)} onChange={(event) => setChoice(item, group.id, event.target.checked ? [...chosen, option.label] : chosen.filter((itemValue) => itemValue !== option.label))} /><span>{option.label}</span></label>)}{fieldError && <span className={styles.fieldError} id={fieldErrorId(fieldKey)}>{fieldError}</span>}</fieldset>;
                              }
                              return <label className={styles.choiceSelect} key={group.id}>{group.label}{group.required ? " *" : ""}<select data-rcoa-field={fieldKey} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? fieldErrorId(fieldKey) : undefined} value={typeof value === "string" ? value : ""} onChange={(event) => setChoice(item, group.id, event.target.value)}><option value="">Choose…</option>{group.options.map((option) => <option key={option.id} value={option.label}>{option.label}</option>)}</select>{fieldError && <span className={styles.fieldError} id={fieldErrorId(fieldKey)}>{fieldError}</span>}</label>;
                            })}
                            {(() => {
                              const minimum = rcoaMinimumQuantity(item);
                              const minimumMessage = quantityMinimumMessage(line?.quantity || 0, minimum);
                              const showMinimum = Boolean(minimumMessage) && (quantityTouched.includes(item.id) || Boolean(errors[`quantity:${item.id}`]));
                              const errorId = fieldErrorId(`quantity:${item.id}`);
                              return (
                                <>
                                  <div className={styles.quantityRow}>
                                    <label>Quantity <input aria-label={`${item.name} quantity`} data-rcoa-field={`quantity:${item.id}`} aria-invalid={showMinimum || undefined} aria-describedby={showMinimum ? errorId : undefined} type="number" min={minimum} step="1" inputMode="numeric" value={line?.quantity || ""} onChange={(event) => setQuantity(item, quantityFromInput(event.target.value))} onBlur={() => touchQuantity(item.id)} onKeyDown={(event) => { if (event.key === "Enter") touchQuantity(item.id); }} /></label>
                                    <button type="button" aria-label={`Remove one ${item.name}`} onClick={() => setQuantity(item, stepQuantityDown(line?.quantity || 0, minimum, false))}>&minus;</button>
                                    <button type="button" aria-label={`Add one ${item.name}`} onClick={() => setQuantity(item, stepQuantityUp(line?.quantity || 0, minimum))}>+</button>
                                  </div>
                                  {showMinimum && <span className={styles.fieldError} id={errorId} role="alert">{minimumMessage}</span>}
                                </>
                              );
                            })()}
                            {suggestion && <button className={styles.suggestionButton} type="button" onClick={() => setQuantity(item, suggestion)}>{item.suggestionLabel || "Suggested quantity"}: {suggestion} {item.suggestionUnit || "units"}</button>}
                            {item.minimumQuantity && item.minimumQuantity > 1 && <small>Minimum order: {item.minimumQuantity}</small>}
                            {item.minimumGuests && item.minimumGuests > 1 && <small>Minimum guests: {item.minimumGuests}</small>}
                          </div>
                        </article>
                      );
                    })}
                    {!visibleMenu.length && <p className={styles.emptyMenu}>{menu.length ? "No menu items match this category or search." : "No menu items are available for this occasion."}</p>}
                  </div>
                )}
                <ErrorMessage field="items" errors={errors} />
              </section>
            )}

            {view === "dietaries" && (
              <section aria-labelledby="rcoa-dietary-title">
                <div className={styles.sectionHeading}><p className={styles.eyebrow}>Dietaries &amp; allergens</p><h2 id="rcoa-dietary-title">Help us look after everyone.</h2><p>Tell us what you know now. The team will confirm final requirements with you.</p></div>
                <label className={styles.switchRow}><input type="checkbox" checked={draft.dietaries.hasDietaries} onChange={(event) => updateDietary("hasDietaries", event.target.checked)} /><span>There are dietary requirements for this booking</span></label>
                <div className={styles.dietaryGrid}>{dietaryFields.map(([key, label]) => <label className={styles.field} key={key}><span>{label}</span><input type="number" min="0" step="1" data-rcoa-field={errors.dietaryCounts ? "dietaryCounts" : undefined} aria-invalid={Boolean(errors.dietaryCounts)} aria-describedby={errors.dietaryCounts ? fieldErrorId("dietaryCounts") : undefined} inputMode="numeric" value={dietaryText[key] ?? String(draft.dietaries[key])} onChange={(event) => { const text = integerFieldText(event.target.value); setDietaryText((current) => ({ ...current, [key]: text })); updateDietary(key, Number(text || 0)); }} onBlur={() => setDietaryText((current) => { const next = { ...current }; delete next[key]; return next; })} /></label>)}</div>
                {errors.dietaryCounts && <p className={styles.fieldError} id={fieldErrorId("dietaryCounts")} data-rcoa-field="dietaryCounts" tabIndex={-1}>{errors.dietaryCounts}</p>}
                <label className={`${styles.field} ${styles.fieldWide}`}><span>Allergy details</span><textarea rows={3} value={draft.dietaries.allergyDetails} onChange={(event) => updateDietary("allergyDetails", event.target.value)} placeholder="Include the guest, allergen and severity where known" /></label>
                <label className={`${styles.checkRow} ${styles.warningCheck}`}><input type="checkbox" data-rcoa-field="severeAllergyAcknowledged" aria-invalid={Boolean(errors.severeAllergyAcknowledged)} aria-describedby={errors.severeAllergyAcknowledged ? fieldErrorId("severeAllergyAcknowledged") : undefined} checked={draft.dietaries.severeAllergyAcknowledged} onChange={(event) => updateDietary("severeAllergyAcknowledged", event.target.checked)} /><span>I understand the hospitality team must be told about severe allergies and cross-contamination risks.</span></label>
                {errors.severeAllergyAcknowledged && <ErrorMessage field="severeAllergyAcknowledged" errors={errors} />}
                <label className={`${styles.field} ${styles.fieldWide}`}><span>Dietary notes</span><textarea rows={3} value={draft.dietaries.freeText} onChange={(event) => updateDietary("freeText", event.target.value)} /></label>
                <p className={styles.safetyNote}>Menu descriptions do not confirm allergen status. The hospitality team will review and confirm allergen requirements before service.</p>
              </section>
            )}

            {view === "review" && (
              <section aria-labelledby="rcoa-review-title">
                <div className={styles.sectionHeading}><p className={styles.eyebrow}>Review</p><h2 id="rcoa-review-title">One last look.</h2></div>
                {flow === "all-day" && (
                  <>
                    <div className={styles.reviewBlock}>
                      <h3>{allDay.eventName.trim() || "Your event"}</h3>
                      <p>{allDay.contact.name} · {allDay.contact.email} · {allDay.contact.companyName}{allDay.contact.invoiceReference ? ` · ${allDay.contact.invoiceReference}` : ""}</p>
                      <p>{allDay.eventDate || "Date not set"} · {allDaySummary.count} service{allDaySummary.count === 1 ? "" : "s"}</p>
                      <button type="button" className={styles.textButton} onClick={() => goToStep(1)}>Edit details</button>
                    </div>
                    {sortedAllDayServices(allDay).map((service) => {
                      const items = service.lines.flatMap((line) => { const item = menu.find((candidate) => candidate.id === line.itemId); return item && line.quantity > 0 ? [{ line, item }] : []; });
                      return (
                        <div className={styles.reviewBlock} key={service.id}>
                          <h3>{service.startTime || "Time not set"} — {rcoaEventTypes.find((type) => type.id === service.category)?.label || "Service"}</h3>
                          <p>{service.guestCount || 0} guests · {service.location || "Location not set"}</p>
                          {items.length ? items.map(({ line, item }) => <p key={item.id}>{line.quantity} × {item.name} · {money.format(item.unitPrice * line.quantity)}</p>) : <p>No menu items selected</p>}
                          {service.notes.trim() && <p>Note: {service.notes.trim()}</p>}
                        </div>
                      );
                    })}
                    <button type="button" className={styles.textButton} onClick={() => goToStep(2)}>Edit your day</button>
                    <div className={styles.reviewBlock}>
                      <h3>Dietaries &amp; allergens</h3>
                      <p>{dietaryFields.filter(([key]) => allDay.dietaries[key] > 0).map(([key, label]) => `${label}: ${allDay.dietaries[key]}`).join(" · ") || "No dietary counts recorded"}</p>
                      <p>{allDay.dietaries.allergyDetails || "No allergy details recorded"}</p>
                      <button type="button" className={styles.textButton} onClick={() => goToStep(3)}>Edit dietaries</button>
                    </div>
                  </>
                )}
                {flow === "standard" && (<>
                <div className={styles.reviewBlock}>
                  <h3>{currentEvent?.label || "Occasion"}</h3>
                  <p>{draft.contact.name} · {draft.contact.email} · {draft.contact.companyName}</p>
                  <p>{draft.event.eventDate || "Date not set"} · {draft.event.startTime || "Time not set"}{draft.event.endTime ? `–${draft.event.endTime}` : ""} · {draft.event.guestCount || 0} guests</p>
                  <p>{[draft.event.floorLevel, draft.event.roomOrArea, draft.event.deliveryPoint].filter(Boolean).join(" · ") || "Location not set"}</p>
                  <button type="button" className={styles.textButton} onClick={() => goToStep(1)}>Edit details</button>
                </div>
                <div className={styles.reviewBlock}>
                  <h3>Menu selection</h3>
                  {selected.length ? selected.map(({ line, item }) => <p key={item.id}>{line.quantity} × {item.name} · {money.format(item.unitPrice * line.quantity)}{item.optionGroups?.flatMap((group) => { const value = line.choices[group.id]; return Array.isArray(value) ? value : value ? [value] : []; }).length ? ` · ${item.optionGroups?.flatMap((group) => { const value = line.choices[group.id]; return Array.isArray(value) ? value : value ? [value] : []; }).join(", ")}` : ""}</p>) : <p>{currentEvent?.id === "bespoke" ? "Menu to be developed with the team." : "No menu items selected."}</p>}
                  <button type="button" className={styles.textButton} onClick={() => goToStep(3)}>Edit menu</button>
                </div>
                <div className={styles.reviewBlock}>
                  <h3>Dietaries &amp; allergens</h3>
                  <p>{dietaryFields.filter(([key]) => draft.dietaries[key] > 0).map(([key, label]) => `${label}: ${draft.dietaries[key]}`).join(" · ") || "No dietary counts recorded"}</p>
                  <p>{draft.dietaries.allergyDetails || "No allergy details recorded"}</p>
                  <button type="button" className={styles.textButton} onClick={() => goToStep(4)}>Edit dietaries</button>
                </div>
                </>)}
                <label className={`${styles.field} ${styles.fieldWide}`}><span>{flow === "all-day" ? "General notes for the event" : "Special instructions"}</span><textarea rows={3} value={draft.specialInstructions} onChange={(event) => setDraft((current) => ({ ...current, specialInstructions: event.target.value }))} placeholder="Access, setup, presentation or anything else the team should know" /></label>
                <div className={styles.acknowledgements}>
                  {(Object.entries(rcoaAcknowledgementLabels) as Array<[keyof RcoaBookingDraft["acknowledgements"], string]>).map(([key, label]) => {
                    const fieldKey = `acknowledgement:${key}`;
                    const fieldError = errors[fieldKey];
                    return <label className={styles.checkRow} key={key}><input type="checkbox" data-rcoa-field={fieldKey} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? fieldErrorId(fieldKey) : undefined} checked={draft.acknowledgements[key]} onChange={(event) => { const checked = event.target.checked; setDraft((current) => ({ ...current, acknowledgements: { ...current.acknowledgements, [key]: checked } })); if (checked) { setErrors((current) => { const next = { ...current }; delete next[fieldKey]; return next; }); if (Object.values({ ...draft.acknowledgements, [key]: true }).every(Boolean)) setMessage((current) => /acknowledgement/i.test(current) ? "" : current); } }} /><span>{label}</span>{fieldError && <span className={styles.fieldError} id={fieldErrorId(fieldKey)}>{fieldError}</span>}</label>;
                  })}
                </div>
                {!rcoaConfigured && <p className={styles.configurationNotice} role="status">Requests will be available after the RCoA governed OPLOC mapping is configured.</p>}
              </section>
            )}

            {editingServiceId ? (
              <footer className={styles.formActions}>
                <button type="button" className={styles.secondaryButton} onClick={() => closeItems(false)}>Back to your day</button>
                <button type="button" className={styles.primaryButton} onClick={() => closeItems(true)}>Save items</button>
              </footer>
            ) : (
            <footer className={styles.formActions}>
              <button type="button" className={styles.secondaryButton} disabled={step === 0 || sending} onClick={() => goToStep(step - 1)}>Back</button>
              {step < labels.length - 1
                ? <button key="continue" type="button" className={styles.primaryButton} onClick={() => goToStep(step + 1)}>Continue</button>
                : <button key="send" type="submit" onClick={() => { submitIntentRef.current = true; }} className={styles.primaryButton} disabled={sending || !bookingId || !rcoaConfigured} aria-busy={sending ? true : undefined}>{sending ? <><span className="fika-spinner" aria-hidden="true" />Sending request…</> : "Send booking request"}</button>}
            </footer>
            )}
          </form>

          <aside className={styles.summary} aria-label="Your request">
            <div className={styles.summaryHeading}><p className={styles.eyebrow}>Your request</p><span className={styles.savedStatus} role="status">{draftReady ? "Progress saved" : "Saving progress…"}</span></div>
            {flow === "all-day" ? (
              <>
                <div className={styles.summaryMeta}>{allDay.eventName.trim() || "All Day Hospitality"}{allDay.eventDate ? ` · ${allDay.eventDate}` : ""}</div>
                <div className={styles.summaryItems}>
                  {sortedAllDayServices(allDay).map((service) => <div className={styles.summaryItem} key={service.id}><span>{service.startTime || "Time not set"} · {rcoaEventTypes.find((type) => type.id === service.category)?.label || "Service"}{service.guestCount ? ` · ${service.guestCount} guests` : ""}</span><strong>{money.format(calculateRcoaTotal(service.lines, menu))}</strong></div>)}
                </div>
                <div className={styles.summaryTotal}><span>Estimated total (all services)</span><strong>{money.format(allDay.services.reduce((sum, service) => sum + calculateRcoaTotal(service.lines, menu), 0))}</strong></div>
              </>
            ) : (
              <>
            <div className={styles.summaryMeta}>{currentEvent?.label || "No occasion selected yet."}{draft.event.eventDate ? ` · ${draft.event.eventDate}` : ""}{draft.event.guestCount ? ` · ${draft.event.guestCount} guests` : ""}</div>
            <div className={styles.summaryItems}>
              {selected.map(({ line, item }) => <div className={styles.summaryItem} key={item.id}><span>{line.quantity} × {item.name}</span><strong>{money.format(item.unitPrice * line.quantity)}</strong></div>)}
              {!selected.length && <p>{draft.occasion === "bespoke" ? "Menu to be discussed with the team." : "Your menu choices will appear here."}</p>}
            </div>
            <div className={styles.summaryTotal}><span>Estimated total</span><strong>{money.format(total)}</strong></div>
              </>
            )}
            <p className={styles.finePrint}>Indicative prices exclude VAT and are subject to confirmation, labour and hire equipment where applicable.</p>
            {warnings.length > 0 && <div className={styles.summaryWarnings}><strong>Notice guidance</strong>{warnings.slice(0, 3).map((warning) => <span key={warning}>{warning}</span>)}</div>}
          </aside>
        </div>
      )}

      {resetOpen && <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setResetOpen(false); }}>
        <section ref={resetDialogRef} className={styles.resetModal} role="dialog" aria-modal="true" aria-labelledby="reset-title" aria-describedby="reset-copy">
          <button type="button" className={styles.modalClose} aria-label="Close" onClick={() => setResetOpen(false)}>×</button>
          <p className={styles.eyebrow}>Start again</p><h2 id="reset-title">Clear this booking?</h2>
          <p id="reset-copy">This clears the current booking request from this browser. Saved contact details are kept unless you choose to forget them.</p>
          <div className={styles.modalActions}><button ref={resetCancelRef} className={styles.secondaryButton} type="button" onClick={() => setResetOpen(false)}>Keep booking</button><button className={styles.dangerButton} type="button" onClick={reset}>Clear and start again</button></div>
        </section>
      </div>}
    </main>
  );
}
