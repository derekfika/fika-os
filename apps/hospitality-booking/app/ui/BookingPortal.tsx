"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookingInput,
  type PortalMenuItem,
  portalBookingId,
} from "@/lib/mnk-contract";
import { portalSite, type PortalSiteKey } from "@/lib/portal-sites";
import { capGallagherMinimum, GALLAGHER_MINIMUM_GUESTS, isGallagherBooking } from "@/lib/gallagher-rules";

type ChoiceValue = string | string[];
type Line = {
  itemId: string;
  quantity: number;
  choices: Record<string, ChoiceValue>;
};
const steps = ["Choose", "Details", "Plan", "Dietaries", "One last look"];
const occasions = [
  { id: "breakfast", label: "Breakfast", copy: "Start the day brilliantly." },
  { id: "lunch", label: "Lunch", copy: "A considered lunchtime spread." },
  {
    id: "meeting_hospitality",
    label: "Meeting hospitality",
    copy: "Everything your meeting needs.",
  },
  {
    id: "afternoon",
    label: "Afternoon",
    copy: "Something sweet, savoury or refreshing.",
  },
  {
    id: "event_catering",
    label: "Events",
    copy: "Food made for a bigger moment.",
  },
  {
    id: "bespoke",
    label: "Something bespoke",
    copy: "Tell us what you have in mind.",
  },
];
const allowed: Record<string, string[]> = {
  breakfast: ["Drinks", "Breakfast", "Sweet treats"],
  lunch: [
    "Lunch",
    "Lunch Boxes",
    "Salads & Sushi",
    "Grazing Boxes",
    "Sweet treats",
  ],
  afternoon: ["Afternoon", "Sweet treats", "Finger Food", "Drinks"],
  meeting_hospitality: [
    "Drinks",
    "Breakfast",
    "Lunch",
    "Lunch Boxes",
    "Salads & Sushi",
    "Sweet treats",
    "Afternoon",
  ],
  event_catering: [
    "Fork Buffet & Bowl Food",
    "Canapes",
    "Grazing Events",
    "Drinks",
  ],
  bespoke: ["Bespoke Events", "Grazing Events", "Dining"],
};
const dietaryNames: Record<string, string> = {
  vegetarian: "Vegetarian",
  vegan: "Vegan",
  glutenFree: "Gluten free",
  coeliac: "Coeliac",
  dairyFree: "Dairy free",
  halal: "Halal",
  otherCount: "Other",
};
const draftKey = (siteKey: PortalSiteKey) => `fika-hospitality-booking-draft:${siteKey}`;
export type BookingFieldError = { message: string; field: string; step: number };
export type BookingFieldErrors = Record<string, BookingFieldError>;

type BookingIssue = { path: PropertyKey[]; message: string };
const issueField = (path: PropertyKey[], siteKey: PortalSiteKey) => {
  const value = path.map(String).join(".");
  if (value === "clientName") return siteKey === "angel-court" ? "clientName" : "requesterName";
  if (value === "clientEmail" || value === "requesterEmail") return "requesterEmail";
  if (value === "clientPhone" || value === "requesterPhone") return "requesterPhone";
  if (value === "companyName" || value === "requesterCompany") return siteKey === "angel-court" ? "clientCompany" : "requesterCompany";
  if (value.startsWith("acknowledgements.")) return value;
  if (value === "floorLevel" || value === "roomOrArea" || value === "deliveryPoint") return "location";
  return value;
};
const friendlyIssueMessage = (field: string, message: string) => {
  if (message === "Invalid input") return `Please review this ${field === "eventDate" ? "date" : "field"}.`;
  if (field === "eventDate") return "Please add a valid service date.";
  if (field === "startTime") return "Please add a valid service time.";
  if (field === "roomOrArea" || field === "floorLevel" || field === "deliveryPoint") return "Please add a floor, room or delivery point.";
  if (field === "guestCount") return "Please enter a valid number of guests.";
  return message;
};

export function mapBookingIssues(issues: readonly BookingIssue[], siteKey: PortalSiteKey): BookingFieldErrors {
  const result: BookingFieldErrors = {};
  for (const issue of issues) {
    const field = issueField(issue.path, siteKey);
    if (!result[field]) result[field] = { field, message: friendlyIssueMessage(field, issue.message), step: field.startsWith("acknowledgements.") ? 3 : field === "eventType" || field.startsWith("order.") ? 2 : 1 };
  }
  return result;
}

function inlineErrorId(field: string) { return `booking-error-${field.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`; }
function fieldA11y(field: string, errors: BookingFieldErrors) {
  const error = errors[field];
  return error ? { "aria-invalid": true, "aria-describedby": inlineErrorId(field) } : { "aria-invalid": undefined, "aria-describedby": undefined };
}
function ValidationMessage({ field, errors }: { field: string; errors: BookingFieldErrors }) {
  const error = errors[field];
  return error ? <p className="inline-validation-error" id={inlineErrorId(field)}>{error.message}</p> : null;
}
function validationSummary(errors: BookingFieldErrors) {
  const count = Object.keys(errors).length;
  return count ? `Please review ${count === 1 ? "the highlighted field" : "the highlighted fields"} before continuing.` : "";
}
function minimumQuantityFor(item: PortalMenuItem, gallagher = false) {
  return capGallagherMinimum(Math.max(
    1,
    item.minimumQuantity || 1,
    Number(item.servingInfo?.match(/minimum\s+(\d+)/i)?.[1] || 1),
    /rice paper rolls?/i.test(item.name) ? 3 : 1,
  ), gallagher);
}

export default function BookingPortal({
  siteKey = "mnk",
  oplocId,
  siteLabel,
  availableSites,
  onSiteChange,
  dashboardMode,
}: {
  siteKey?: PortalSiteKey;
  oplocId?: string;
  siteLabel?: string;
  availableSites?: Array<{ id: string; label: string }>;
  onSiteChange?: (oplocId: string) => void;
  dashboardMode?: boolean;
}) {
  const site = portalSite(siteKey);
  const [menu, setMenu] = useState<PortalMenuItem[]>([]);
  const [occasion, setOccasion] = useState("");
  const [step, setStep] = useState(0);
  const [category, setCategory] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [details, setDetails] = useState({
    eventDate: "",
    startTime: "",
    endTime: "",
    guestCount: 0,
    floorLevel: "",
    roomOrArea: "",
    deliveryPoint: "",
  });
  const [contact, setContact] = useState({
    requesterName: "",
    requesterEmail: "",
    requesterPhone: "",
    requesterCompany: "",
    clientName: "",
    clientCompany: "",
    invoiceReference: "",
    specialInstructions: "",
  });
  const [dietaries, setDietaries] = useState({
    vegetarian: 0,
    vegan: 0,
    glutenFree: 0,
    coeliac: 0,
    dairyFree: 0,
    halal: 0,
    otherCount: 0,
    allergyDetails: "",
    freeText: "",
    severeAllergyAcknowledged: false,
  });
  const [acks, setAcks] = useState({
    quoteSubjectToConfirmation: false,
    noticePolicyAccepted: false,
    dietaryResponsibilityAccepted: false,
  });
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<BookingFieldErrors>({});
  const [confirmation, setConfirmation] = useState("");
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const explicitSendRef = useRef(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [restoredDraft, setRestoredDraft] = useState(false);
  const stepHistoryKey = "fikaMnkBookingStep";
  const changeStep = (next: number | ((current: number) => number)) => {
    setStep((current) => {
      const resolved = Math.min(4, Math.max(0, typeof next === "function" ? next(current) : next));
      if (resolved !== current) {
        window.history.pushState({ ...window.history.state, [stepHistoryKey]: resolved }, "", window.location.href);
      }
      return resolved;
    });
  };
  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey(site.key));
      if (saved) {
        const draft = JSON.parse(saved) as Partial<{
          occasion: string;
          step: number;
          category: string;
          lines: Line[];
          details: typeof details;
          contact: typeof contact;
          dietaries: typeof dietaries;
          acks: typeof acks;
        }>;
        const hasDraft = Boolean(
          draft.occasion ||
          draft.category ||
          (draft.lines && draft.lines.length) ||
          draft.details?.eventDate ||
          draft.contact?.requesterEmail ||
          draft.contact?.requesterName ||
          draft.step,
        );
        if (!hasDraft) {
          window.localStorage.removeItem(draftKey(site.key));
          return;
        }
        if (draft.occasion) setOccasion(draft.occasion);
        if (typeof draft.step === "number") setStep(Math.min(4, Math.max(0, draft.step)));
        if (draft.category) setCategory(draft.category);
        if (Array.isArray(draft.lines)) setLines(draft.lines);
        if (draft.details) setDetails((current) => ({ ...current, ...draft.details }));
        if (draft.contact) setContact((current) => ({ ...current, ...draft.contact }));
        if (draft.dietaries) setDietaries((current) => ({ ...current, ...draft.dietaries }));
        if (draft.acks) setAcks((current) => ({ ...current, ...draft.acks }));
        setRestoredDraft(true);
      }
    } catch {
      window.localStorage.removeItem(draftKey(site.key));
    } finally {
      setDraftReady(true);
    }
  }, [site.key]);

  useEffect(() => {
    if (!draftReady) return;
    const draft = { occasion, step, category, lines, details, contact, dietaries, acks };
    try {
      window.localStorage.setItem(draftKey(site.key), JSON.stringify(draft));
    } catch {
      // Private browsing or a full storage quota should not block booking.
    }
  }, [draftReady, site.key, occasion, step, category, lines, details, contact, dietaries, acks]);

  useEffect(() => {
    const savedStep = window.history.state?.[stepHistoryKey];
    if (typeof savedStep !== "number") {
      window.history.replaceState({ ...window.history.state, [stepHistoryKey]: step }, "", window.location.href);
    }
    const onPopState = (event: PopStateEvent) => {
      const previousStep = event.state?.[stepHistoryKey];
      setStep(typeof previousStep === "number" ? Math.min(4, Math.max(0, previousStep)) : 0);
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (draftReady) {
      window.history.replaceState({ ...window.history.state, [stepHistoryKey]: step }, "", window.location.href);
    }
  }, [draftReady]);

  useEffect(() => {
    fetch(`/api/reference-data?site=${encodeURIComponent(site.key)}${oplocId ? `&oplocId=${encodeURIComponent(oplocId)}` : ""}`)
      .then((response) => response.json())
      .then((data) => {
        const validMenu = (Array.isArray(data.menu) ? data.menu : []).filter(
          (item: PortalMenuItem) => typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice),
        );
        setMenu(validMenu);
      })
      .catch(() =>
        setError(`The ${site.label} catalogue could not be loaded.`),
      );
  }, [site.key, site.label]);
  const categories = useMemo(
    () =>
      (allowed[occasion] || []).filter((category) =>
        menu.some((item) => item.category === category),
      ),
    [menu, occasion],
  );
  useEffect(() => {
    if (!categories.includes(category)) setCategory(categories[0] || "");
  }, [categories, category]);
  const visible = menu.filter((item) => item.category === category);
  const gallagher = isGallagherBooking({
    companyName: site.key === "angel-court" ? contact.clientCompany : contact.requesterCompany,
    email: contact.requesterEmail,
  });
  const selected = lines
    .map((line) => ({
      ...line,
      item: menu.find((item) => item.id === line.itemId)!,
    }))
    .filter((value) => value.item && value.quantity > 0);
  const total = selected.reduce(
    (sum, value) => sum + value.item.unitPrice * value.quantity,
    0,
  );
  const notice = Math.max(
    0,
    ...selected.map((value) => value.item.noticeRequiredDays || 0),
    occasion === "event_catering" || occasion === "bespoke" ? 7 : 3,
  );
  const setQuantity = (item: PortalMenuItem, quantity: number) =>
    setLines((current) => {
      const minimum = minimumQuantityFor(item, gallagher);
      const requested = Number.isFinite(quantity) ? Math.floor(quantity) : 0;
      const nextQuantity = requested > 0 ? Math.max(minimum, requested) : 0;
      return nextQuantity > 0
        ? [
            ...current.filter((line) => line.itemId !== item.id),
            {
              itemId: item.id,
              quantity: nextQuantity,
              choices:
                current.find((line) => line.itemId === item.id)?.choices || {},
            },
          ]
        : current.filter((line) => line.itemId !== item.id)
    });
  const setChoice = (itemId: string, choiceId: string, value: ChoiceValue) =>
    setLines((current) => {
      const existing = current.find((line) => line.itemId === itemId);
      if (!existing)
        return [
          ...current,
          { itemId, quantity: 0, choices: { [choiceId]: value } },
        ];
      return current.map((line) =>
        line.itemId === itemId
          ? { ...line, choices: { ...line.choices, [choiceId]: value } }
          : line,
      );
    });
  const detailsValid = () =>
    contact.requesterName &&
    contact.requesterCompany &&
    contact.requesterEmail &&
    contact.requesterPhone &&
    (site.key === "angel-court" ? contact.clientName && contact.clientCompany : true) &&
    details.eventDate &&
    details.startTime &&
    details.guestCount >= (gallagher ? GALLAGHER_MINIMUM_GUESTS : 1) &&
    (!gallagher || contact.invoiceReference.trim()) &&
    (details.floorLevel || details.roomOrArea || details.deliveryPoint);
  const showValidation = (errors: BookingFieldErrors, message = validationSummary(errors), targetStep?: number) => {
    setFieldErrors(errors);
    setError(message);
    const first = Object.values(errors).sort((a, b) => a.step - b.step)[0];
    if (targetStep !== undefined) changeStep(targetStep);
    else if (first && first.step !== step) changeStep(first.step);
    if (first) window.setTimeout(() => {
      const container = document.querySelector<HTMLElement>(`[data-booking-field="${CSS.escape(first.field)}"]`);
      const control = container?.matches("button,input,select,textarea") ? container : container?.querySelector<HTMLElement>("button,input,select,textarea");
      (container || control)?.scrollIntoView({ behavior: "smooth", block: "center" });
      if (typeof control?.focus === "function") control.focus({ preventScroll: true });
    }, 0);
  };
  const clearValidation = (field: string) => setFieldErrors((current) => {
    if (!current[field]) return current;
    const next = { ...current };
    delete next[field];
    return next;
  });
  const next = () => {
    setError("");
    setFieldErrors({});
    if (step === 0 && !occasion) return showValidation({ occasion: { field: "occasion", message: "Choose an occasion.", step: 0 } }, "Please choose an occasion before continuing.", 0);
    if (step === 1) {
      const errors: BookingFieldErrors = {};
      if (!contact.requesterName) errors.requesterName = { field: "requesterName", message: "Enter your name.", step: 1 };
      if (!contact.requesterEmail) errors.requesterEmail = { field: "requesterEmail", message: "Enter your work email.", step: 1 };
      if (!contact.requesterPhone) errors.requesterPhone = { field: "requesterPhone", message: "Enter a contact number.", step: 1 };
      if (!contact.requesterCompany) errors.requesterCompany = { field: "requesterCompany", message: "Enter your company.", step: 1 };
      if (site.key === "angel-court" && !contact.clientName) errors.clientName = { field: "clientName", message: "Enter the client name.", step: 1 };
      if (site.key === "angel-court" && !contact.clientCompany) errors.clientCompany = { field: "clientCompany", message: "Enter the client company.", step: 1 };
      if (!details.eventDate) errors.eventDate = { field: "eventDate", message: "Choose a service date.", step: 1 };
      if (!details.startTime) errors.startTime = { field: "startTime", message: "Choose a service time.", step: 1 };
      if (details.guestCount < (gallagher ? GALLAGHER_MINIMUM_GUESTS : 1)) errors.guestCount = { field: "guestCount", message: `Enter at least ${gallagher ? GALLAGHER_MINIMUM_GUESTS : 1} guest${gallagher ? "s" : ""}.`, step: 1 };
      if (gallagher && !contact.invoiceReference.trim()) errors.invoiceReference = { field: "invoiceReference", message: "Add an Invoice / PO reference for Gallagher bookings.", step: 1 };
      if (!details.floorLevel && !details.roomOrArea && !details.deliveryPoint) errors.location = { field: "location", message: "Add a floor, room or delivery point.", step: 1 };
      if (Object.keys(errors).length) return showValidation(errors, "Please review the highlighted fields before continuing.", 1);
    }
    if (step === 2 && !selected.length && occasion !== "bespoke") return showValidation({ menu: { field: "menu", message: "Choose at least one menu item.", step: 2 } }, "Please choose at least one menu item before continuing.", 2);
    if (step === 2) {
      const belowMinimum = selected.find(
        (value) => value.quantity < minimumQuantityFor(value.item, gallagher),
      );
      if (belowMinimum) {
        const minimum = minimumQuantityFor(belowMinimum.item, gallagher);
        return showValidation({ [`quantity:${belowMinimum.item.id}`]: { field: `quantity:${belowMinimum.item.id}`, message: `${belowMinimum.item.name} requires at least ${minimum} ${minimum === 1 ? "box/item" : "boxes"}.`, step: 2 } }, `${belowMinimum.item.name} needs a larger quantity.`, 2);
      }
    }
    if (step === 3 && !Object.values(acks).every(Boolean)) {
      const errors = Object.entries(acks).reduce<BookingFieldErrors>((result, [key, value]) => { if (!value) result[`acknowledgements.${key}`] = { field: `acknowledgements.${key}`, message: "Please confirm this acknowledgement.", step: 3 }; return result; }, {});
      return showValidation(errors, "Please confirm the highlighted acknowledgements before reviewing your booking.", 3);
    }
    changeStep((value) => Math.min(4, value + 1));
  };
  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const submitter = event ? (event.nativeEvent as SubmitEvent).submitter : null;
    if (step === 4 && !explicitSendRef.current && !submitter) return;
    explicitSendRef.current = false;
    if (sendingRef.current) return;
    setFieldErrors({});
    const belowMinimum = selected.find(
      (value) => value.quantity < minimumQuantityFor(value.item, gallagher),
    );
    if (belowMinimum) {
      const minimum = minimumQuantityFor(belowMinimum.item, gallagher);
      changeStep(2);
      return showValidation({ [`quantity:${belowMinimum.item.id}`]: { field: `quantity:${belowMinimum.item.id}`, message: `${belowMinimum.item.name} requires at least ${minimum} ${minimum === 1 ? "box/item" : "boxes"}.`, step: 2 } }, `${belowMinimum.item.name} needs a larger quantity.`, 2);
    }
    const dietaryTotal = [
      dietaries.vegetarian,
      dietaries.vegan,
      dietaries.glutenFree,
      dietaries.coeliac,
      dietaries.dairyFree,
      dietaries.halal,
      dietaries.otherCount,
    ].reduce((sum, value) => sum + value, 0);
    if (dietaryTotal > details.guestCount)
      return showValidation({ dietaryTotal: { field: "dietaryTotal", message: "Dietary counts cannot exceed the number of guests.", step: 3 } }, "Please review the highlighted dietary information.", 3);
    if (dietaries.allergyDetails && !dietaries.severeAllergyAcknowledged)
      return showValidation({ severeAllergyAcknowledged: { field: "severeAllergyAcknowledged", message: "Please acknowledge the severe allergy notice.", step: 3 } }, "Please review the highlighted dietary information.", 3);
    if (gallagher && details.guestCount < GALLAGHER_MINIMUM_GUESTS) {
      changeStep(1);
      return showValidation({ guestCount: { field: "guestCount", message: `Gallagher bookings require at least ${GALLAGHER_MINIMUM_GUESTS} guests.`, step: 1 } }, "Please review the highlighted booking detail.", 1);
    }
    if (gallagher && !contact.invoiceReference.trim()) {
      changeStep(1);
      return showValidation({ invoiceReference: { field: "invoiceReference", message: "Gallagher bookings require an Invoice / PO reference.", step: 1 } }, "Please review the highlighted booking detail.", 1);
    }
    if (!Object.values(acks).every(Boolean)) {
      changeStep(3);
      const errors = Object.entries(acks).reduce<BookingFieldErrors>((result, [key, value]) => { if (!value) result[`acknowledgements.${key}`] = { field: `acknowledgements.${key}`, message: "Please confirm this acknowledgement.", step: 3 }; return result; }, {});
      return showValidation(errors, "Please confirm the highlighted acknowledgements before sending.", 3);
    }
    const clientName = String(site.key === "angel-court" ? contact.clientName : contact.requesterName || contact.clientName || "").trim();
    const clientCompany = String(site.key === "angel-court" ? contact.clientCompany : contact.requesterCompany || contact.clientCompany || "").trim();
    const eventType = occasions.some((item) => item.id === occasion) ? occasion : "bespoke";
    const parsed = BookingInput.safeParse({
      clientName,
      clientEmail: String(contact.requesterEmail || "").trim(),
      clientPhone: String(contact.requesterPhone || "").trim(),
      companyName: clientCompany,
      requesterName: String(contact.requesterName || "").trim() || undefined,
      requesterEmail: String(contact.requesterEmail || "").trim() || undefined,
      requesterPhone: String(contact.requesterPhone || "").trim() || undefined,
      requesterCompany: String(contact.requesterCompany || "").trim() || undefined,
      clientCompany,
      invoiceReference: String(contact.invoiceReference || "").trim() || undefined,
      eventDate: String(details.eventDate || "").trim(),
      startTime: String(details.startTime || "").trim(),
      endTime: String(details.endTime || "").trim() || undefined,
      guestCount: Number(details.guestCount),
      floorLevel: String(details.floorLevel || "").trim() || undefined,
      roomOrArea: String(details.roomOrArea || "").trim() || undefined,
      deliveryPoint: String(details.deliveryPoint || "").trim() || undefined,
      eventType,
      acknowledgements: {
        quoteSubjectToConfirmation: true,
        noticePolicyAccepted: true,
        dietaryResponsibilityAccepted: true,
      },
    });
    if (!parsed.success) {
      const mapped = mapBookingIssues(parsed.error.issues, site.key);
      return showValidation(mapped, validationSummary(mapped));
    }
    const payload = {
      bookingId: portalBookingId(site.key),
      submittedAt: new Date().toISOString(),
      site: site.label,
      // portalSiteId is the stable portal key. The Hub, not the browser,
      // resolves the governed canonical OPLOC for the booking.
      siteId: site.key,
      client: {
        name: contact.requesterName,
        email: contact.requesterEmail,
        phone: contact.requesterPhone,
        companyName: contact.requesterCompany,
        requester: {
          name: contact.requesterName,
          email: contact.requesterEmail,
          phone: contact.requesterPhone,
          companyName: contact.requesterCompany,
        },
      clientName,
      clientCompany,
        ...(contact.invoiceReference.trim()
          ? { invoiceReference: contact.invoiceReference.trim() }
          : {}),
      },
      event: { ...details, endTime: details.endTime || undefined },
      order: {
        eventType: occasion,
        items: selected.map((value) => ({
          itemId: value.item.id,
          itemName: value.item.name,
          category: value.item.category,
          description: value.item.description,
          servingInfo: value.item.servingInfo,
          unitPrice: value.item.unitPrice,
          quantity: value.quantity,
          lineTotal: Number(
            (value.item.unitPrice * value.quantity).toFixed(2),
          ),
          choices: Object.entries(value.choices).map(([id, value]) => ({
            id,
            value,
          })),
        })),
        netTotal: total,
        vatNote:
          "Prices are subject to confirmation; VAT, labour and hire may apply where relevant.",
      },
      dietaries: {
        ...dietaries,
        hasDietaries:
          dietaryTotal > 0 ||
          Boolean(dietaries.allergyDetails || dietaries.freeText),
      },
      acknowledgements: acks,
      specialInstructions: contact.specialInstructions,
    };
    sendingRef.current = true;
    setSending(true);
    try {
      const response = await fetch("/api/bookings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) {
        setFieldErrors({});
        setError(json.error?.message || "We could not send your request.");
        return;
      }
      window.localStorage.removeItem(draftKey(site.key));
      setRestoredDraft(false);
      setConfirmation(
        "Thank you. Your request is safely with FIKA. We will review it before confirming anything.",
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };
  const resetBooking = () => {
    setOccasion("");
    changeStep(0);
    setCategory("");
    setLines([]);
    setDetails({
      eventDate: "",
      startTime: "",
      endTime: "",
      guestCount: 0,
      floorLevel: "",
      roomOrArea: "",
      deliveryPoint: "",
    });
    setContact({
      requesterName: "",
      requesterEmail: "",
      requesterPhone: "",
      requesterCompany: "",
      clientName: "",
      clientCompany: "",
      invoiceReference: "",
      specialInstructions: "",
    });
    setDietaries({
      vegetarian: 0,
      vegan: 0,
      glutenFree: 0,
      coeliac: 0,
      dairyFree: 0,
      halal: 0,
      otherCount: 0,
      allergyDetails: "",
      freeText: "",
      severeAllergyAcknowledged: false,
    });
    setAcks({
      quoteSubjectToConfirmation: false,
      noticePolicyAccepted: false,
      dietaryResponsibilityAccepted: false,
    });
    setError("");
    setFieldErrors({});
    setConfirmation("");
    setRestoredDraft(false);
    setResetOpen(false);
    window.localStorage.removeItem(draftKey(site.key));
  };
  useEffect(() => {
    if (!resetOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setResetOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [resetOpen]);
  if (confirmation)
    return (
      <main className={`mnk ${site.cssClass}`}>
        <Top site={site} siteLabel={siteLabel} availableSites={availableSites} activeOplocId={oplocId} onSiteChange={onSiteChange} dashboardMode={dashboardMode} onStartAgain={() => setResetOpen(true)} />
        <section className="success-screen">
          <p className="eyebrow">Request received</p>
          <h1>We’re on it.</h1>
          <p>{confirmation}</p>
          <button className="primary" onClick={resetBooking}>
            Make another request
          </button>
        </section>
        {resetOpen && <ResetModal onCancel={() => setResetOpen(false)} onConfirm={resetBooking} />}
      </main>
    );
  return (
    <main className={`mnk ${site.cssClass}`}>
      <Top site={site} siteLabel={siteLabel} availableSites={availableSites} activeOplocId={oplocId} onSiteChange={onSiteChange} dashboardMode={dashboardMode} onStartAgain={() => setResetOpen(true)} />
      {restoredDraft && <p className="draft-restored" role="status">Your unfinished booking has been restored.</p>}
      {resetOpen && <ResetModal onCancel={() => setResetOpen(false)} onConfirm={resetBooking} />}
      <section className="mnk-hero">
        <p className="eyebrow">{site.label} hospitality</p>
        <h1>
          Hospitality,
          <br />
          elevated.
        </h1>
        <p>
          Good food, beautifully arranged. Tell us what you need and we’ll take
          it from there.
        </p>
        <div className="journey">
          {steps.slice(0, 3).map((label, index) => (
            <span
              className={
                step === index ? "current" : step > index ? "done" : ""
              }
              key={label}
            >
              <b>0{index + 1}</b>
              {label}
            </span>
          ))}
        </div>
      </section>
      <div className="booking-layout">
        <aside className="progress-rail">
          {steps.map((label, index) => (
            <button
              key={label}
              disabled={index > step}
              className={step === index ? "active" : ""}
              onClick={() => changeStep(index)}
            >
              <b>0{index + 1}</b>
              {label}
            </button>
          ))}
        </aside>
        <form className="workspace" onSubmit={submit} onKeyDown={(event) => {
          if (step === 4 && event.key === "Enter" && (event.target as HTMLElement).tagName !== "BUTTON") {
            event.preventDefault();
          }
        }}>
          {error && <p className="error" role="alert" aria-live="polite">{error}</p>}
          {step === 0 && (
            <Choose
              occasion={occasion}
              setOccasion={setOccasion}
              notice={notice}
              errors={fieldErrors}
              clearError={clearValidation}
            />
          )}
          {step === 1 && (
            <Details
              siteKey={site.key}
              contact={contact}
              setContact={setContact}
              details={details}
              setDetails={setDetails}
              gallagher={gallagher}
              errors={fieldErrors}
            />
          )}
          {step === 2 && (
            <Plan
              categories={categories}
              category={category}
              setCategory={setCategory}
              visible={visible}
              lines={lines}
              setQuantity={setQuantity}
              setChoice={setChoice}
              details={details}
              gallagher={gallagher}
              errors={fieldErrors}
            />
          )}
          {step === 3 && (
            <Submit
              contact={contact}
              setContact={setContact}
              dietaries={dietaries}
              setDietaries={setDietaries}
              acks={acks}
              setAcks={setAcks}
              errors={fieldErrors}
              clearError={clearValidation}
            />
          )}
          {step === 4 && <FinalReview site={site} contact={contact} details={details} selected={selected} total={total} dietaries={dietaries} acks={acks} />}
          <footer>
            <button
              type="button"
              className="back"
              disabled={step === 0}
              onClick={() => changeStep((value) => value - 1)}
            >
              Back
            </button>
            {step < 4 ? (
              <button type="button" className="primary" onClick={next}>
                Continue
              </button>
            ) : (
              <button type="button" className="primary" onClick={() => { explicitSendRef.current = true; void submit(); }} disabled={sending || !Object.values(acks).every(Boolean)}>{sending ? "Sending…" : Object.values(acks).every(Boolean) ? "Send request" : "Complete acknowledgements"}</button>
            )}
          </footer>
        </form>
        <Summary occasion={occasion} selected={selected} total={total} details={details} />
      </div>
    </main>
  );
}
function Top({
  site,
  siteLabel,
  availableSites,
  activeOplocId,
  onSiteChange,
  dashboardMode,
  onStartAgain,
}: {
  site: ReturnType<typeof portalSite>;
  siteLabel?: string;
  availableSites?: Array<{ id: string; label: string }>;
  activeOplocId?: string;
  onSiteChange?: (oplocId: string) => void;
  dashboardMode?: boolean;
  onStartAgain: () => void;
}) {
  return (
    <header className="mnk-top">
      <div className="mnk-brand-lockup">
        <img src={site.logoPath} alt={site.displayName} />
        <span>{dashboardMode ? "Hospitality Dashboard" : "Hospitality"}</span>
      </div>
      <div className="mnk-top-actions">
        {availableSites && activeOplocId && onSiteChange ? <>{availableSites.length > 1 ? <label>Site: <select aria-label="Hospitality site" value={activeOplocId} onChange={(event) => onSiteChange(event.target.value)}>{availableSites.map(option => <option value={option.id} key={option.id}>{option.label}</option>)}</select></label> : <small>Site: {siteLabel || site.label}</small>}{dashboardMode && <a className="start-again" href={site.portalPath} target="_blank" rel="noopener noreferrer">View Portal</a>}</> : <small>{site.label} booking</small>}
        {dashboardMode && (!availableSites || !activeOplocId || !onSiteChange) && <a className="start-again" href={site.portalPath} target="_blank" rel="noopener noreferrer">View Portal</a>}
        <button className="start-again" type="button" onClick={onStartAgain}>
          Start again
        </button>
      </div>
    </header>
  );
}
function ResetModal({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div className="reset-modal-backdrop" onMouseDown={onCancel}>
      <section
        className="reset-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-modal-title"
        aria-describedby="reset-modal-copy"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="reset-modal-close" type="button" aria-label="Close" onClick={onCancel}>
          ×
        </button>
        <p className="eyebrow">New request</p>
        <h2 id="reset-modal-title">Start again?</h2>
        <p id="reset-modal-copy">
          This clears the current request from this browser. It does not change anything already submitted.
        </p>
        <div className="reset-modal-actions">
          <button className="back" type="button" onClick={onCancel}>
            Keep booking
          </button>
          <button className="danger-button" type="button" onClick={onConfirm}>
            Clear and start again
          </button>
        </div>
      </section>
    </div>
  );
}
function Choose({
  occasion,
  setOccasion,
  notice,
  errors,
  clearError,
}: {
  occasion: string;
  setOccasion: (id: string) => void;
  notice: number;
  errors: BookingFieldErrors;
  clearError: (field: string) => void;
}) {
  return (
    <section>
      <p className="eyebrow">Your occasion</p>
      <h2>What are we arranging?</h2>
      <p className="intro">
        Choose an occasion and we’ll show the relevant menu and notice guidance.
      </p>
      <div className="occasion-grid" data-booking-field="occasion" aria-describedby={errors.occasion ? inlineErrorId("occasion") : undefined} aria-invalid={errors.occasion ? true : undefined}>
        {occasions.map((item) => (
          <button
            type="button"
            key={item.id}
            className={occasion === item.id ? "selected" : ""}
            onClick={() => { setOccasion(item.id); clearError("occasion"); }}
          >
            <b>{item.label}</b>
            <span>{item.copy}</span>
          </button>
        ))}
      </div>
      <ValidationMessage field="occasion" errors={errors} />
      {occasion && (
        <p className="guidance">
          Please allow at least {notice} working days for this type of order.
          We’ll confirm availability with you.
        </p>
      )}
    </section>
  );
}
function Details({
  siteKey,
  contact,
  setContact,
  details,
  setDetails,
  gallagher,
  errors,
}: {
  siteKey: PortalSiteKey;
  contact: Record<string, string>;
  setContact: (value: any) => void;
  details: Record<string, string | number>;
  setDetails: (value: any) => void;
  gallagher: boolean;
  errors: BookingFieldErrors;
}) {
  return (
    <section>
      <p className="eyebrow">Your details</p>
      <h2>Who should we speak to?</h2>
      <div className="fields">
        <p className="field-group-label wide">Your contact details</p>
          <label>
            Your name
            <input
              {...fieldA11y("requesterName", errors)}
              data-booking-field="requesterName"
              value={contact.requesterName}
            onChange={(e) =>
              setContact({ ...contact, requesterName: e.target.value })
            }
          />
        </label>
        <ValidationMessage field="requesterName" errors={errors} />
          <label>
            Work email
            <input
              {...fieldA11y("requesterEmail", errors)}
              data-booking-field="requesterEmail"
              type="email"
            value={contact.requesterEmail}
            onChange={(e) =>
              setContact({ ...contact, requesterEmail: e.target.value })
            }
          />
        </label>
        <ValidationMessage field="requesterEmail" errors={errors} />
          <label>
            Contact number
            <input
              {...fieldA11y("requesterPhone", errors)}
              data-booking-field="requesterPhone"
              value={contact.requesterPhone}
            onChange={(e) =>
              setContact({ ...contact, requesterPhone: e.target.value })
            }
          />
        </label>
        <ValidationMessage field="requesterPhone" errors={errors} />
          <label>
            Your company
            <input
              {...fieldA11y("requesterCompany", errors)}
              data-booking-field="requesterCompany"
              value={contact.requesterCompany}
            onChange={(e) =>
              setContact({ ...contact, requesterCompany: e.target.value })
            }
          />
        </label>
        <ValidationMessage field="requesterCompany" errors={errors} />
        {siteKey === "angel-court" && <>
          <p className="field-group-label wide">Who is the booking for?</p>
          <label>
            Client name
            <input required {...fieldA11y("clientName", errors)} data-booking-field="clientName" value={contact.clientName} onChange={(e) => setContact({ ...contact, clientName: e.target.value })} />
          </label>
          <ValidationMessage field="clientName" errors={errors} />
          <label>
            Client company
            <input required {...fieldA11y("clientCompany", errors)} data-booking-field="clientCompany" value={contact.clientCompany} onChange={(e) => setContact({ ...contact, clientCompany: e.target.value })} />
          </label>
          <ValidationMessage field="clientCompany" errors={errors} />
        </>}
        <label className="wide" data-booking-field="invoiceReference">
          Invoice / PO reference <small>{gallagher ? "(required for Gallagher)" : "(optional)"}</small>
          <input
            {...fieldA11y("invoiceReference", errors)}
            required={gallagher}
            value={contact.invoiceReference || ""}
            onChange={(e) => setContact({ ...contact, invoiceReference: e.target.value })}
            placeholder="Add a client invoice or purchase order reference"
          />
        </label>
        <ValidationMessage field="invoiceReference" errors={errors} />
      </div>
      <h3 className="section-subheading">When and where?</h3>
      <div className="fields">
        <label>
          Date
          <input
            {...fieldA11y("eventDate", errors)}
            data-booking-field="eventDate"
            type="date"
            value={details.eventDate}
            onChange={(e) =>
              setDetails({ ...details, eventDate: e.target.value })
            }
          />
        </label>
        <label>
          Guests
          <input
            {...fieldA11y("guestCount", errors)}
            data-booking-field="guestCount"
            min="1"
            type="number"
            value={details.guestCount || ""}
            onChange={(e) =>
              setDetails({ ...details, guestCount: Number(e.target.value) })
            }
          />
        </label>
        <label>
          Service time
          <input
            {...fieldA11y("startTime", errors)}
            data-booking-field="startTime"
            type="time"
            value={details.startTime}
            onChange={(e) =>
              setDetails({ ...details, startTime: e.target.value })
            }
          />
        </label>
        <label>
          End time <small>(optional)</small>
          <input
            {...fieldA11y("endTime", errors)}
            data-booking-field="endTime"
            type="time"
            value={details.endTime}
            onChange={(e) =>
              setDetails({ ...details, endTime: e.target.value })
            }
          />
        </label>
        <label className="wide">
          Floor, room or delivery point
          <input
            {...fieldA11y("location", errors)}
            data-booking-field="location"
            value={details.roomOrArea}
            onChange={(e) =>
              setDetails({ ...details, roomOrArea: e.target.value })
            }
          />
        </label>
        <ValidationMessage field="eventDate" errors={errors} />
        <ValidationMessage field="guestCount" errors={errors} />
        <ValidationMessage field="startTime" errors={errors} />
        <ValidationMessage field="endTime" errors={errors} />
        <ValidationMessage field="location" errors={errors} />
      </div>
    </section>
  );
}
function Plan({
  categories,
  category,
  setCategory,
  visible,
  lines,
  setQuantity,
  setChoice,
  gallagher,
  errors,
}: any) {
  return (
    <section>
      <p className="eyebrow">Build your menu</p>
      <h2>Choose what feels right.</h2>
      <div className="category-tabs">
        {categories.map((value: string) => (
          <button
            type="button"
            className={value === category ? "active" : ""}
            onClick={() => setCategory(value)}
            key={value}
          >
            {value}
          </button>
        ))}
      </div>
      <div className="menu-grid" data-booking-field="menu" aria-describedby={errors.menu ? inlineErrorId("menu") : undefined} aria-invalid={errors.menu ? true : undefined}>
        {visible.map((item: PortalMenuItem) => {
          const line = lines.find((value: Line) => value.itemId === item.id);
          return (
            <article key={item.canonicalId}>
              <span>{item.servingInfo}</span>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              {typeof item.unitPrice === "number" && Number.isFinite(item.unitPrice) ? <strong>£{item.unitPrice.toFixed(2)}</strong> : <strong>Price unavailable</strong>}
              {item.optionGroups?.map((group) => {
                const isMulti = ["multi", "checkbox", "checkboxes"].includes(
                  (group.selectionType || "select").toLowerCase(),
                );
                const saved = line?.choices[group.id];
                if (isMulti) {
                  const selectedOptions = Array.isArray(saved) ? saved : [];
                  return (
                    <fieldset className="choice-field" key={group.id}>
                      <legend>
                        {group.label}
                        {group.required ? " *" : ""}
                      </legend>
                      <div className="choice-checks">
                        {group.options.map((option) => (
                          <label className="choice-check" key={option.id}>
                            <input
                              type="checkbox"
                              checked={selectedOptions.includes(option.label)}
                              onChange={(event) =>
                                setChoice(
                                  item.id,
                                  group.id,
                                  event.target.checked
                                    ? [...selectedOptions, option.label]
                                    : selectedOptions.filter(
                                        (value) => value !== option.label,
                                      ),
                                )
                              }
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  );
                }
                return (
                  <label key={group.id}>
                    {group.label}
                    {group.required ? " *" : ""}
                    <select
                      value={typeof saved === "string" ? saved : ""}
                      onChange={(event) =>
                        setChoice(item.id, group.id, event.target.value)
                      }
                    >
                      <option value="">Choose…</option>
                      {group.options.map((option) => (
                        <option key={option.id} value={option.label}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
              <div className="stepper">
                <button
                  type="button"
                  aria-label={`Remove one ${item.name}`}
                  onClick={() => {
                    const minimum = minimumQuantityFor(item, gallagher);
                    const current = line?.quantity || 0;
                    setQuantity(item, current > minimum ? current - 1 : 0);
                  }}
                >
                  −
                </button>
                <input
                  {...fieldA11y(`quantity:${item.id}`, errors)}
                  data-booking-field={`quantity:${item.id}`}
                  aria-label={`${item.name} quantity`}
                    min={minimumQuantityFor(item, gallagher)}
                  type="number"
                  value={line?.quantity || ""}
                  onChange={(event) =>
                    setQuantity(item, Number(event.target.value || 0))
                  }
                />
                <button
                  type="button"
                  aria-label={`Add one ${item.name}`}
                  onClick={() => setQuantity(item, (line?.quantity || 0) + 1)}
                >
                  +
                </button>
              </div>
              {minimumQuantityFor(item, gallagher) > 1 && (
                <p className="minimum-quantity-note">
                  Minimum {minimumQuantityFor(item, gallagher)} boxes
                </p>
              )}
            </article>
          );
        })}
      </div>
      <ValidationMessage field="menu" errors={errors} />
      {Object.keys(errors).filter((field) => field.startsWith("quantity:")).map((field) => <ValidationMessage key={field} field={field} errors={errors} />)}
    </section>
  );
}
function Submit({
  contact,
  setContact,
  dietaries,
  setDietaries,
  acks,
  setAcks,
  errors,
}: any) {
  return (
    <section className="submit">
      <p className="eyebrow">Review and send</p>
      <h2>Anything else we should know?</h2>
      <h3 className="section-subheading">Dietary requirements</h3>
      <p className="intro">
        Tell us how many guests have each requirement, plus any serious
        allergies.
      </p>
      <div className="dietary-grid" data-booking-field="dietaryTotal" aria-describedby={errors.dietaryTotal ? inlineErrorId("dietaryTotal") : undefined} aria-invalid={errors.dietaryTotal ? true : undefined}>
        {Object.entries(dietaryNames).map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              min="0"
              type="number"
              value={dietaries[key] || ""}
              onChange={(e) =>
                setDietaries({ ...dietaries, [key]: Number(e.target.value) })
              }
            />
          </label>
        ))}
      </div>
      <ValidationMessage field="dietaryTotal" errors={errors} />
      <label>
        Allergy details
        <textarea
          value={dietaries.allergyDetails}
          onChange={(e) =>
            setDietaries({ ...dietaries, allergyDetails: e.target.value })
          }
        />
      </label>
      <label>
        Other dietary notes
        <textarea
          value={dietaries.freeText}
          onChange={(e) =>
            setDietaries({ ...dietaries, freeText: e.target.value })
          }
        />
      </label>
      {dietaries.allergyDetails && (
        <label className="check">
          <input
            {...fieldA11y("severeAllergyAcknowledged", errors)}
            data-booking-field="severeAllergyAcknowledged"
            type="checkbox"
            checked={dietaries.severeAllergyAcknowledged}
            onChange={(e) =>
              setDietaries({
                ...dietaries,
                severeAllergyAcknowledged: e.target.checked,
              })
            }
          />
          I have provided all serious allergy details and understand FIKA will
          review them before confirmation.
        </label>
      )}
      <ValidationMessage field="severeAllergyAcknowledged" errors={errors} />
      <label>
        Anything else?
        <textarea
          value={contact.specialInstructions}
          onChange={(e) =>
            setContact({ ...contact, specialInstructions: e.target.value })
          }
        />
      </label>
      {Object.keys(acks).map((key) => (
        <label className="check" key={key}>
          <input
            {...fieldA11y(`acknowledgements.${key}`, errors)}
            data-booking-field={`acknowledgements.${key}`}
            required
            type="checkbox"
            checked={acks[key]}
            onChange={(e) => setAcks({ ...acks, [key]: e.target.checked })}
          />
          I understand that{" "}
          {key === "quoteSubjectToConfirmation"
            ? "this request is subject to confirmation"
            : key === "noticePolicyAccepted"
              ? "notice rules apply"
              : "dietary requirements must be complete"}
          .
          <ValidationMessage field={`acknowledgements.${key}`} errors={errors} />
        </label>
      ))}
    </section>
  );
}

function FinalReview({ site, contact, details, selected, total, dietaries, acks }: any) {
  const client = site.key === "angel-court" ? `${contact.clientName} · ${contact.clientCompany}` : `${contact.requesterName} · ${contact.requesterCompany}`;
  return <section className="submit final-review">
    <p className="eyebrow">One last look</p>
    <h2>Check your booking before sending</h2>
    <p className="intro">Please check the key details below. You can go back to make changes.</p>
    <div className="final-review__facts">
      {[['Booking for', client], ['When', `${humanDate(details.eventDate)} · ${humanTime(details.startTime)}`], ['Guests', `${details.guestCount} pax`], ['Where', details.roomOrArea || details.floorLevel || details.deliveryPoint]].map(([label, value]) => <div key={label as string}><small>{label}</small><strong>{value}</strong></div>)}
    </div>
    <div className="final-review__order"><div className="final-review__order-head"><span>Order summary</span><span>Net estimate</span></div>{selected.map((value: any) => <div className="final-review__line" key={value.item.id}><span><strong>{value.quantity} × {value.item.name}</strong>{value.item.servingInfo && <small>{value.item.servingInfo}</small>}</span><b>£{(value.quantity * value.item.unitPrice).toFixed(2)}</b></div>)}<div className="final-review__total"><span>Menu total</span><strong>£{total.toFixed(2)}</strong></div></div>
    <div className={`final-review__notice ${Object.values(acks).every(Boolean) ? "" : "final-review__notice--attention"}`}><strong>{Object.values(acks).every(Boolean) ? "Ready to send" : "One more step"}</strong><span>{Object.values(acks).every(Boolean) ? (Object.entries(dietaries).filter(([, value]) => value && value !== false).length ? "Dietary information is included with this request." : "No dietary requirements recorded.") + " Your request will be reviewed before anything is confirmed." : "Please go back to Dietaries and confirm each acknowledgement before sending."}</span></div>
  </section>;
}
function humanDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}
function humanTime(value: string) {
  const match = /^([0-9]{2}):([0-9]{2})$/.exec(value);
  return match ? `${match[1]}:${match[2]}` : value;
}
function Summary({ occasion, selected, total, details }: any) {
  return (
    <aside className="summary">
      <p className="eyebrow">Your request</p>
      <h3>
        {occasion
          ? occasions.find((item) => item.id === occasion)?.label
          : "Choose an occasion"}
      </h3>
      {(details.guestCount > 0 || details.eventDate) && <p>{details.guestCount > 0 && <b>{details.guestCount} pax</b>}{details.guestCount > 0 && details.eventDate ? " · " : ""}{details.eventDate ? humanDate(details.eventDate) : ""}</p>}
      {selected.length ? (
        <ul>
          {selected.map((value: any) => (
            <li key={value.item.id}>
              <span>
                {value.quantity} × {value.item.name}
              </span>
              {typeof value.item.unitPrice === "number" && Number.isFinite(value.item.unitPrice) ? <b>£{(value.quantity * value.item.unitPrice).toFixed(2)}</b> : <b>Price unavailable</b>}
            </li>
          ))}
        </ul>
      ) : (
        <p>Add menu items and your live order will appear here.</p>
      )}
      <div className="summary-total">
        <span>Estimated total</span>
        <strong>£{Number.isFinite(total) ? total.toFixed(2) : "Price unavailable"}</strong>
      </div>
      <small>
        Prices are subject to final confirmation. VAT, labour and hire may apply
        where relevant.
      </small>
    </aside>
  );
}
