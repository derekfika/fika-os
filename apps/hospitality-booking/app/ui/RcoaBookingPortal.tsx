"use client";

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { portalBookingId, type PortalMenuItem } from "@/lib/mnk-contract";
import { hospitalitySiteThemeStyle, portalSite } from "@/lib/portal-sites";
import {
  calculateRcoaTotal,
  createEmptyRcoaDraft,
  filterRcoaMenu,
  rcoaAcknowledgementLabels,
  rcoaAllowedCategories,
  rcoaEventTypes,
  rcoaMinimumQuantity,
  rcoaNoticeWarnings,
  retainRcoaLinesForOccasion,
  rcoaSuggestedQuantity,
  validateRcoaStep,
  type RcoaBookingDraft,
  type RcoaChoiceValue,
  type RcoaLine,
} from "@/lib/rcoa-portal";
import { buildRcoaClientRequest } from "@/lib/rcoa-booking-request-client";
import styles from "./RcoaBookingPortal.module.css";

const stepLabels = ["Occasion", "Contact", "Event", "Menu", "Dietaries", "Review"];
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

export default function RcoaBookingPortal({ oplocId }: { oplocId?: string }) {
  const site = portalSite("rcoa");
  const theme = hospitalitySiteThemeStyle(site) as CSSProperties;
  const [draft, setDraft] = useState<RcoaBookingDraft>(createEmptyRcoaDraft);
  const [step, setStep] = useState(0);
  const [menu, setMenu] = useState<PortalMenuItem[]>([]);
  const [menuLoading, setMenuLoading] = useState(true);
  const [menuError, setMenuError] = useState("");
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
      const restored = hasConfirmedRequest ? undefined : safeDraft(JSON.parse(window.localStorage.getItem(draftKey) || "null"));
      if (restored) {
        setDraft(restored);
        setStep(Math.max(0, Math.min(stepLabels.length - 1, Number((restored as RcoaBookingDraft & { step?: number }).step) || 0)));
        setRestoredDraft(true);
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
      window.localStorage.setItem(draftKey, JSON.stringify({ ...draft, step }));
    } catch {
      // A full or unavailable browser store must not block a booking request.
    }
  }, [draftReady, draft, step, reference]);

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
    fetch("/api/reference-data?site=rcoa", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error?.message || "The RCoA menu could not be loaded.");
        return body;
      })
      .then((body) => {
        if (!active) return;
        setMenu((Array.isArray(body.menu) ? body.menu : []).filter((item: PortalMenuItem) => Number.isFinite(item.unitPrice)));
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
  const visibleMenu = useMemo(() => filterRcoaMenu(menu, draft.occasion, category, search), [menu, draft.occasion, category, search]);
  const unavailableLines = draft.lines.filter((line) => {
    const item = menu.find((candidate) => candidate.id === line.itemId);
    return !item || (Boolean(draft.occasion) && !allowedCategories.some((category) => category === item.category));
  });
  const total = calculateRcoaTotal(draft.lines, menu);
  const selected = draft.lines.flatMap((line) => {
    const item = menu.find((candidate) => candidate.id === line.itemId);
    return item && line.quantity > 0 ? [{ line, item }] : [];
  });
  const warnings = rcoaNoticeWarnings(draft, menu);
  const currentEvent = rcoaEventTypes.find((event) => event.id === draft.occasion);
  const rcoaConfigured = Boolean(oplocId);

  const updateContact = (key: keyof RcoaBookingDraft["contact"], value: string) => setDraft((current) => ({ ...current, contact: { ...current.contact, [key]: value } }));
  const updateEvent = (key: keyof RcoaBookingDraft["event"], value: string | number) => setDraft((current) => ({ ...current, event: { ...current.event, [key]: value } }));
  const updateDietary = (key: keyof RcoaBookingDraft["dietaries"], value: string | number | boolean) => setDraft((current) => ({ ...current, dietaries: { ...current.dietaries, [key]: value, ...(key !== "hasDietaries" ? { hasDietaries: true } : {}) } }));

  const setQuantity = (item: PortalMenuItem, requested: number) => {
    setDraft((current) => {
      const quantity = requested > 0 ? Math.max(rcoaMinimumQuantity(item), Math.floor(requested)) : 0;
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
    const retainedLines = retainRcoaLinesForOccasion(draft.lines, occasion, menu);
    const removedCount = draft.lines.length - retainedLines.length;
    setDraft((current) => ({ ...current, occasion, lines: retainRcoaLinesForOccasion(current.lines, occasion, menu) }));
    setErrors({});
    setMessage(removedCount ? `${removedCount} menu selection${removedCount === 1 ? " was" : "s were"} removed because ${removedCount === 1 ? "it is" : "they are"} not available for this occasion.` : "");
  };

  const goToStep = (nextStep: number) => {
    const validation = validateRcoaStep(step, draft, menu);
    if (nextStep > step && Object.keys(validation).length) {
      setErrors(validation);
      setMessage("Please review the highlighted information before continuing.");
      const firstField = Object.keys(validation)[0];
      const guestMinimumError = Object.entries(validation).find(([key]) => key.startsWith("guests:"));
      if (step === 3 && guestMinimumError) {
        setErrors({ guestCount: guestMinimumError[1] });
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sendingRef.current) return;
    const validation = validateRcoaStep(5, draft, menu);
    if (Object.keys(validation).length) {
      setErrors(validation);
      setMessage("Please confirm each acknowledgement before sending your request.");
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
    setDraft({ ...createEmptyRcoaDraft(), contact: rememberContact ? draft.contact : createEmptyRcoaDraft().contact });
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
        <button ref={resetTriggerRef} className={styles.resetButton} type="button" aria-label="Start again" onClick={() => setResetOpen(true)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 12a9 9 0 1 1-2.64-6.36" /><path d="M21 3v6h-6" /></svg>
        </button>
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

      {restoredDraft && <p className={styles.restoredNotice} role="status">Your unfinished booking has been restored.</p>}
      {reference ? (
        <section className={styles.confirmation} aria-labelledby="rcoa-confirm-title">
          <p className={styles.eyebrow}>Request received</p>
          <h2 id="rcoa-confirm-title">Thank you. We will take it from here.</h2>
          <p>Your reference is <strong>{reference}</strong>.</p>
          <p>The hospitality team will review availability, labour, equipment and VAT before confirming your booking.</p>
          <button className={styles.primaryButton} type="button" onClick={reset}>Make another booking</button>
        </section>
      ) : (
        <div className={styles.appShell}>
          <nav className={styles.stepper} aria-label="Booking progress">
            {stepLabels.map((label, index) => (
              <button key={label} type="button" className={index === step ? styles.stepActive : index < step ? styles.stepComplete : styles.step} disabled={index > step} aria-current={index === step ? "step" : undefined} onClick={() => goToStep(index)}>
                <span>0{index + 1}</span>{label}
              </button>
            ))}
          </nav>

          <form className={styles.formPanel} onSubmit={submit}>
            {message && <p className={styles.formMessage} role="alert" aria-live="polite">{message}</p>}
            {menuError && <p className={styles.formMessage} role="alert">{menuError}</p>}

            {step === 0 && (
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
                </div>
                <ErrorMessage field="occasion" errors={errors} />
                {draft.occasion && <div className={styles.guidance} role="status"><strong>Notice guidance</strong><span>{currentEvent?.noticeType === "large" ? "Please allow at least seven working days for larger events." : "Please allow at least 72 hours for standard requests."} Availability will be confirmed by the hospitality team.</span></div>}
              </section>
            )}

            {step === 1 && (
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

            {step === 2 && (
              <section aria-labelledby="rcoa-event-title">
                <div className={styles.sectionHeading}><p className={styles.eyebrow}>Event details</p><h2 id="rcoa-event-title">When and where?</h2></div>
                <div className={styles.fieldGrid}>
                  <label className={styles.field}><span>Event date *</span><input {...fieldProps("eventDate", errors)} data-rcoa-field="eventDate" type="date" value={draft.event.eventDate} onChange={(event) => updateEvent("eventDate", event.target.value)} /><ErrorMessage field="eventDate" errors={errors} /></label>
                  <label className={styles.field}><span>Number of guests *</span><input {...fieldProps("guestCount", errors)} data-rcoa-field="guestCount" type="number" min="1" step="1" value={draft.event.guestCount || ""} onChange={(event) => updateEvent("guestCount", Number(event.target.value || 0))} /><ErrorMessage field="guestCount" errors={errors} /></label>
                  <label className={styles.field}><span>Start / service time *</span><input {...fieldProps("startTime", errors)} data-rcoa-field="startTime" type="time" value={draft.event.startTime} onChange={(event) => updateEvent("startTime", event.target.value)} /><ErrorMessage field="startTime" errors={errors} /></label>
                  <label className={styles.field}><span>End time</span><input {...fieldProps("endTime", errors)} data-rcoa-field="endTime" type="time" value={draft.event.endTime} onChange={(event) => updateEvent("endTime", event.target.value)} /><ErrorMessage field="endTime" errors={errors} /></label>
                  <label className={styles.field}><span>Floor level</span><input value={draft.event.floorLevel} onChange={(event) => updateEvent("floorLevel", event.target.value)} placeholder="e.g. 7" /></label>
                  <label className={styles.field}><span>Room or area</span><input value={draft.event.roomOrArea} onChange={(event) => updateEvent("roomOrArea", event.target.value)} placeholder="e.g. Boardroom" /></label>
                  <label className={`${styles.field} ${styles.fieldWide}`}><span>Delivery point, if different</span><input value={draft.event.deliveryPoint} onChange={(event) => updateEvent("deliveryPoint", event.target.value)} /></label>
                  <label className={styles.field}><span>Onsite contact name</span><input value={draft.event.onsiteContactName} onChange={(event) => updateEvent("onsiteContactName", event.target.value)} /></label>
                  <label className={styles.field}><span>Onsite contact phone</span><input type="tel" value={draft.event.onsiteContactPhone} onChange={(event) => updateEvent("onsiteContactPhone", event.target.value)} /></label>
                </div>
                {errors.location && <p className={styles.fieldError} data-rcoa-field="location" tabIndex={-1}>{errors.location}</p>}
                {warnings.length > 0 && <div className={styles.warningList} role="status"><strong>Please note</strong>{warnings.map((warning) => <span key={warning}>{warning}</span>)}</div>}
              </section>
            )}

            {step === 3 && (
              <section aria-labelledby="rcoa-menu-title">
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
                            <div className={styles.quantityRow}>
                              <label>Quantity <input aria-label={`${item.name} quantity`} data-rcoa-field={`quantity:${item.id}`} aria-invalid={Boolean(errors[`quantity:${item.id}`])} aria-describedby={errors[`quantity:${item.id}`] ? fieldErrorId(`quantity:${item.id}`) : undefined} type="number" min={rcoaMinimumQuantity(item)} step="1" value={line?.quantity || ""} onChange={(event) => setQuantity(item, Number(event.target.value || 0))} /></label>
                              <button type="button" aria-label={`Remove one ${item.name}`} onClick={() => setQuantity(item, (line?.quantity || 0) - 1)}>−</button>
                              <button type="button" aria-label={`Add one ${item.name}`} onClick={() => setQuantity(item, (line?.quantity || 0) + 1)}>+</button>
                            </div>
                            {suggestion && <button className={styles.suggestionButton} type="button" onClick={() => setQuantity(item, suggestion)}>{item.suggestionLabel || "Suggested quantity"}: {suggestion} {item.suggestionUnit || "units"}</button>}
                            {item.minimumQuantity && item.minimumQuantity > 1 && <small>Minimum order: {item.minimumQuantity}</small>}
                            {item.minimumGuests && item.minimumGuests > 1 && <small>Minimum guests: {item.minimumGuests}</small>}
                            {errors[`quantity:${item.id}`] && <span className={styles.fieldError} id={fieldErrorId(`quantity:${item.id}`)}>{errors[`quantity:${item.id}`]}</span>}
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

            {step === 4 && (
              <section aria-labelledby="rcoa-dietary-title">
                <div className={styles.sectionHeading}><p className={styles.eyebrow}>Dietaries &amp; allergens</p><h2 id="rcoa-dietary-title">Help us look after everyone.</h2><p>Tell us what you know now. The team will confirm final requirements with you.</p></div>
                <label className={styles.switchRow}><input type="checkbox" checked={draft.dietaries.hasDietaries} onChange={(event) => updateDietary("hasDietaries", event.target.checked)} /><span>There are dietary requirements for this booking</span></label>
                <div className={styles.dietaryGrid}>{dietaryFields.map(([key, label]) => <label className={styles.field} key={key}><span>{label}</span><input type="number" min="0" step="1" data-rcoa-field={errors.dietaryCounts ? "dietaryCounts" : undefined} aria-invalid={Boolean(errors.dietaryCounts)} aria-describedby={errors.dietaryCounts ? fieldErrorId("dietaryCounts") : undefined} value={draft.dietaries[key]} onChange={(event) => updateDietary(key, Number(event.target.value || 0))} /></label>)}</div>
                {errors.dietaryCounts && <p className={styles.fieldError} id={fieldErrorId("dietaryCounts")} data-rcoa-field="dietaryCounts" tabIndex={-1}>{errors.dietaryCounts}</p>}
                <label className={`${styles.field} ${styles.fieldWide}`}><span>Allergy details</span><textarea rows={3} value={draft.dietaries.allergyDetails} onChange={(event) => updateDietary("allergyDetails", event.target.value)} placeholder="Include the guest, allergen and severity where known" /></label>
                <label className={`${styles.checkRow} ${styles.warningCheck}`}><input type="checkbox" data-rcoa-field="severeAllergyAcknowledged" aria-invalid={Boolean(errors.severeAllergyAcknowledged)} aria-describedby={errors.severeAllergyAcknowledged ? fieldErrorId("severeAllergyAcknowledged") : undefined} checked={draft.dietaries.severeAllergyAcknowledged} onChange={(event) => updateDietary("severeAllergyAcknowledged", event.target.checked)} /><span>I understand the hospitality team must be told about severe allergies and cross-contamination risks.</span></label>
                {errors.severeAllergyAcknowledged && <ErrorMessage field="severeAllergyAcknowledged" errors={errors} />}
                <label className={`${styles.field} ${styles.fieldWide}`}><span>Dietary notes</span><textarea rows={3} value={draft.dietaries.freeText} onChange={(event) => updateDietary("freeText", event.target.value)} /></label>
                <p className={styles.safetyNote}>Menu descriptions do not confirm allergen status. The hospitality team will review and confirm allergen requirements before service.</p>
              </section>
            )}

            {step === 5 && (
              <section aria-labelledby="rcoa-review-title">
                <div className={styles.sectionHeading}><p className={styles.eyebrow}>Review</p><h2 id="rcoa-review-title">One last look.</h2></div>
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
                <label className={`${styles.field} ${styles.fieldWide}`}><span>Special instructions</span><textarea rows={3} value={draft.specialInstructions} onChange={(event) => setDraft((current) => ({ ...current, specialInstructions: event.target.value }))} placeholder="Access, setup, presentation or anything else the team should know" /></label>
                <div className={styles.acknowledgements}>
                  {(Object.entries(rcoaAcknowledgementLabels) as Array<[keyof RcoaBookingDraft["acknowledgements"], string]>).map(([key, label]) => {
                    const fieldKey = `acknowledgement:${key}`;
                    const fieldError = errors[fieldKey];
                    return <label className={styles.checkRow} key={key}><input type="checkbox" data-rcoa-field={fieldKey} aria-invalid={Boolean(fieldError)} aria-describedby={fieldError ? fieldErrorId(fieldKey) : undefined} checked={draft.acknowledgements[key]} onChange={(event) => setDraft((current) => ({ ...current, acknowledgements: { ...current.acknowledgements, [key]: event.target.checked } }))} /><span>{label}</span>{fieldError && <span className={styles.fieldError} id={fieldErrorId(fieldKey)}>{fieldError}</span>}</label>;
                  })}
                </div>
                {!rcoaConfigured && <p className={styles.configurationNotice} role="status">Requests will be available after the RCoA governed OPLOC mapping is configured.</p>}
              </section>
            )}

            <footer className={styles.formActions}>
              <button type="button" className={styles.secondaryButton} disabled={step === 0 || sending} onClick={() => goToStep(step - 1)}>Back</button>
              {step < stepLabels.length - 1
                ? <button type="button" className={styles.primaryButton} onClick={() => goToStep(step + 1)}>Continue</button>
                : <button type="submit" className={styles.primaryButton} disabled={sending || !bookingId || !rcoaConfigured}>{sending ? "Sending request…" : "Send booking request"}</button>}
            </footer>
          </form>

          <aside className={styles.summary} aria-label="Your request">
            <div className={styles.summaryHeading}><p className={styles.eyebrow}>Your request</p><span className={styles.savedStatus} role="status">{draftReady ? "Progress saved" : "Saving progress…"}</span></div>
            <div className={styles.summaryMeta}>{currentEvent?.label || "No occasion selected yet."}{draft.event.eventDate ? ` · ${draft.event.eventDate}` : ""}{draft.event.guestCount ? ` · ${draft.event.guestCount} guests` : ""}</div>
            <div className={styles.summaryItems}>
              {selected.map(({ line, item }) => <div className={styles.summaryItem} key={item.id}><span>{line.quantity} × {item.name}</span><strong>{money.format(item.unitPrice * line.quantity)}</strong></div>)}
              {!selected.length && <p>{draft.occasion === "bespoke" ? "Menu to be discussed with the team." : "Your menu choices will appear here."}</p>}
            </div>
            <div className={styles.summaryTotal}><span>Estimated total</span><strong>{money.format(total)}</strong></div>
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
