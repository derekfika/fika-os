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
      .then((data) => setMenu(data.menu || []) as void)
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
  const next = () => {
    setError("");
    if (step === 0 && !occasion)
      return setError("Choose what you are arranging to continue.");
    if (step === 1 && !detailsValid())
      return setError(
        "Please add your contact, event date, service time and location.",
      );
    if (step === 2 && !selected.length && occasion !== "bespoke")
      return setError("Choose at least one menu item to continue.");
    if (step === 2) {
      const belowMinimum = selected.find(
        (value) => value.quantity < minimumQuantityFor(value.item, gallagher),
      );
      if (belowMinimum) {
        const minimum = minimumQuantityFor(belowMinimum.item, gallagher);
        return setError(
          `${belowMinimum.item.name} requires at least ${minimum} ${minimum === 1 ? "box/item" : "boxes"}.`,
        );
      }
    }
    if (step === 3 && !Object.values(acks).every(Boolean))
      return setError("Please confirm the three acknowledgements before reviewing your booking.");
    changeStep((value) => Math.min(4, value + 1));
  };
  const submit = async (event?: React.FormEvent) => {
    event?.preventDefault();
    const submitter = event ? (event.nativeEvent as SubmitEvent).submitter : null;
    if (step === 4 && !explicitSendRef.current && !submitter) return;
    explicitSendRef.current = false;
    if (sendingRef.current) return;
    const belowMinimum = selected.find(
      (value) => value.quantity < minimumQuantityFor(value.item, gallagher),
    );
    if (belowMinimum) {
      const minimum = minimumQuantityFor(belowMinimum.item, gallagher);
      changeStep(2);
      return setError(
        `${belowMinimum.item.name} requires at least ${minimum} ${minimum === 1 ? "box/item" : "boxes"}.`,
      );
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
      return setError("Dietary counts cannot exceed the number of guests.");
    if (dietaries.allergyDetails && !dietaries.severeAllergyAcknowledged)
      return setError("Please acknowledge the severe allergy notice.");
    if (gallagher && details.guestCount < GALLAGHER_MINIMUM_GUESTS) {
      changeStep(1);
      return setError(`Gallagher bookings require at least ${GALLAGHER_MINIMUM_GUESTS} guests.`);
    }
    if (gallagher && !contact.invoiceReference.trim()) {
      changeStep(1);
      return setError("Gallagher bookings require an Invoice / PO reference.");
    }
    if (!Object.values(acks).every(Boolean)) {
      changeStep(3);
      return setError("Please confirm the three acknowledgements before sending.");
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
      const issue = parsed.error.issues[0];
      const path = issue?.path.join(".") || "";
      const message = issue?.message || "";
      if (path.startsWith("acknowledgements") || message.toLowerCase().includes("expected true")) {
        changeStep(3);
        return setError("Please confirm each acknowledgement before sending.");
      }
      if (path === "eventDate") return setError("Please add a valid service date.");
      if (path === "startTime") return setError("Please add a valid service time.");
      if (path === "roomOrArea") return setError("Please add a floor, room or delivery point.");
      return setError(message === "Invalid input" ? `Please review ${path || "the booking details"} before sending.` : message || `Please review ${path || "the booking details"} before sending.`);
    }
    const payload = {
      bookingId: portalBookingId(site.key),
      submittedAt: new Date().toISOString(),
      site: site.label,
      siteId: oplocId || site.key,
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
          {error && <p className="error">{error}</p>}
          {step === 0 && (
            <Choose
              occasion={occasion}
              setOccasion={setOccasion}
              notice={notice}
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
}: {
  occasion: string;
  setOccasion: (id: string) => void;
  notice: number;
}) {
  return (
    <section>
      <p className="eyebrow">Your occasion</p>
      <h2>What are we arranging?</h2>
      <p className="intro">
        Choose an occasion and we’ll show the relevant menu and notice guidance.
      </p>
      <div className="occasion-grid">
        {occasions.map((item) => (
          <button
            type="button"
            key={item.id}
            className={occasion === item.id ? "selected" : ""}
            onClick={() => setOccasion(item.id)}
          >
            <b>{item.label}</b>
            <span>{item.copy}</span>
          </button>
        ))}
      </div>
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
}: {
  siteKey: PortalSiteKey;
  contact: Record<string, string>;
  setContact: (value: any) => void;
  details: Record<string, string | number>;
  setDetails: (value: any) => void;
  gallagher: boolean;
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
            value={contact.requesterName}
            onChange={(e) =>
              setContact({ ...contact, requesterName: e.target.value })
            }
          />
        </label>
        <label>
          Work email
          <input
            type="email"
            value={contact.requesterEmail}
            onChange={(e) =>
              setContact({ ...contact, requesterEmail: e.target.value })
            }
          />
        </label>
        <label>
          Contact number
          <input
            value={contact.requesterPhone}
            onChange={(e) =>
              setContact({ ...contact, requesterPhone: e.target.value })
            }
          />
        </label>
        <label>
          Your company
          <input
            value={contact.requesterCompany}
            onChange={(e) =>
              setContact({ ...contact, requesterCompany: e.target.value })
            }
          />
        </label>
        {siteKey === "angel-court" && <>
          <p className="field-group-label wide">Who is the booking for?</p>
          <label>
            Client name
            <input required value={contact.clientName} onChange={(e) => setContact({ ...contact, clientName: e.target.value })} />
          </label>
          <label>
            Client company
            <input required value={contact.clientCompany} onChange={(e) => setContact({ ...contact, clientCompany: e.target.value })} />
          </label>
        </>}
        <label className="wide">
          Invoice / PO reference <small>{gallagher ? "(required for Gallagher)" : "(optional)"}</small>
          <input
            required={gallagher}
            value={contact.invoiceReference || ""}
            onChange={(e) => setContact({ ...contact, invoiceReference: e.target.value })}
            placeholder="Add a client invoice or purchase order reference"
          />
        </label>
      </div>
      <h3 className="section-subheading">When and where?</h3>
      <div className="fields">
        <label>
          Date
          <input
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
            value={details.roomOrArea}
            onChange={(e) =>
              setDetails({ ...details, roomOrArea: e.target.value })
            }
          />
        </label>
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
      <div className="menu-grid">
        {visible.map((item: PortalMenuItem) => {
          const line = lines.find((value: Line) => value.itemId === item.id);
          return (
            <article key={item.canonicalId}>
              <span>{item.servingInfo}</span>
              <h3>{item.name}</h3>
              <p>{item.description}</p>
              <strong>£{item.unitPrice.toFixed(2)}</strong>
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
      <div className="dietary-grid">
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
              <b>£{(value.quantity * value.item.unitPrice).toFixed(2)}</b>
            </li>
          ))}
        </ul>
      ) : (
        <p>Add menu items and your live order will appear here.</p>
      )}
      <div className="summary-total">
        <span>Estimated total</span>
        <strong>£{total.toFixed(2)}</strong>
      </div>
      <small>
        Prices are subject to final confirmation. VAT, labour and hire may apply
        where relevant.
      </small>
    </aside>
  );
}
