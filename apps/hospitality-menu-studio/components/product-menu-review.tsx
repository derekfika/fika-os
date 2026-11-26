"use client";

import { useRef, useState, type ReactNode } from "react";
import type { ProductMenuConfiguration, ProductMenuDraft } from "../../shared/hospitality-menu-studio-product-content";
import type { StudioPublicationDescriptor } from "../../shared/hospitality-menu-studio-publication";
import type { Dish } from "../lib/contract";
import type { StudioPublicationPilot } from "../lib/hub-publication";
import { productMenuDishKey, type ProductMenuDishReference } from "../lib/product-menu-dishes";
import { menuChoiceReferences } from "./product-menu-editor-model";
import { StudioButton, StudioField, StudioIcon, StudioPageHeader, StudioPanel, StudioStatus } from "./studio-design-system";
import { useAssignedDishes } from "./use-assigned-dishes";
import { useProductMenuDishes } from "./use-product-menu-dishes";
import { useStudioRead, useStudioReads } from "./studio-reads";
import styles from "./product-menu-review.module.css";

function ProductMenuReviewLayout({
  productName,
  configuration,
  dishName,
  onBack,
  settings,
  checks,
  actions,
  published,
  activated,
  busy,
}: {
  productName: string;
  configuration: ProductMenuConfiguration;
  dishName: (reference: ProductMenuDishReference) => string;
  onBack: () => void;
  settings: ReactNode;
  checks: ReactNode;
  actions: ReactNode;
  published: boolean;
  activated: boolean;
  busy: boolean;
}) {
  const { schedule, presentation, groups } = configuration;
  const rotating = schedule.kind === "rotation";
  const slots = rotating ? schedule.weeks : [schedule.choices];
  const dishCounts = slots.map(slot => menuChoiceReferences(slot).length);
  const assignmentCount = dishCounts.reduce((total, count) => total + count, 0);
  const scheduleLabel = rotating ? `Rotating menu · ${slots.length} ${slots.length === 1 ? "week" : "weeks"}` : "Fixed menu";
  const choiceLabel = { dropdown: "Single choice", checkboxes: "Multiple choice", quantities: "Quantity selector" }[presentation];

  return <div className={styles.layout}>
    <div className={styles.summary}>
      <div className={styles.heading}>
        <StudioPageHeader
          breadcrumbs={[{ label: "Menu Builder" }, { label: productName }, { label: "Review & publish" }]}
          title="Review & publish"
          description="Check the menu, safety approvals and publication settings before making it available to customers."
        />
      </div>
      <div className={styles.product}>
        <span className={styles.productIcon}><StudioIcon name="dishes" /></span>
        <div><h2>{productName}</h2><p>{scheduleLabel}</p></div>
        <StudioStatus tone={published ? "success" : "info"}>{activated ? "Activated" : published ? "Published to Hub" : "Draft"}</StudioStatus>
      </div>
      <StudioPanel
        title="Menu summary"
        description={`${assignmentCount} dish ${assignmentCount === 1 ? "assignment" : "assignments"}${rotating ? " across the rotation" : ""}`}
        actions={<StudioButton onClick={onBack} disabled={busy}>Edit menu</StudioButton>}
        className={styles.summaryPanel}
      >
        <div className={rotating ? styles.weeks : styles.fixed}>
          {slots.map((slot, index) => <section key={index} className={styles.week}>
            <header>
              <h3>{rotating ? `Week ${index + 1}` : "Dishes"}</h3>
              <p>{dishCounts[index]} {dishCounts[index] === 1 ? "dish" : "dishes"}</p>
            </header>
            {slot.dishes.length > 0 && <ol>{slot.dishes.map(reference => <li key={reference.dishId}>{dishName(reference)}</li>)}</ol>}
            {groups.map(group => {
              const dishes = slot.groups.find(value => value.groupId === group.id)?.dishes;
              if (!dishes?.length) return null;
              return <div className={styles.group} key={group.id}>
                <h4>{group.name}</h4>
                <ol>{dishes.map(reference => <li key={reference.dishId}>{dishName(reference)}</li>)}</ol>
              </div>;
            })}
            {dishCounts[index] === 0 && <p className={styles.empty}>No dishes selected</p>}
          </section>)}
        </div>
      </StudioPanel>
      <dl className={styles.rules}>
        <div><dt>Customer selection</dt><dd>{choiceLabel}</dd></div>
        <div><dt>Ordering rules</dt><dd>Verified with Hub during readiness checks</dd></div>
        {rotating && <div><dt>Rotation</dt><dd>Repeats from Monday {schedule.anchorMonday}</dd></div>}
      </dl>
    </div>
    <aside className={styles.readiness} aria-label="Publication readiness">
      <StudioPanel title="Publication settings" className={styles.railPanel}>{settings}</StudioPanel>
      <StudioPanel title="Safety & approval checks" description="Check the saved menu and current CPU evidence before publishing." className={styles.railPanel}>
        {checks}
      </StudioPanel>
      <StudioPanel className={styles.railPanel}>{actions}</StudioPanel>
    </aside>
  </div>;
}

type Readiness = { issues: string[]; reviewToken: string | null };

export function ProductMenuReview({
  draft, productName, dishes, canPublish, pilot, onBack, submit, onPublished,
}: {
  draft: ProductMenuDraft;
  productName: string;
  dishes: Dish[];
  canPublish: boolean;
  pilot?: StudioPublicationPilot;
  onBack: () => void;
  submit: <T>(body: unknown) => Promise<T>;
  onPublished: () => void;
}) {
  const reads = useStudioReads();
  const catalogue = useStudioRead(reads.catalogue);
  const [effectiveDate, setEffectiveDate] = useState(pilot?.firstDate || "");
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [publicationId, setPublicationId] = useState("");
  const [activationReason, setActivationReason] = useState("");
  const [activationAttempt, setActivationAttempt] = useState<{ commandId: string; expectedGeneration: number } | null>(null);
  const [activated, setActivated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const { configuration } = draft;
  const slots = configuration.schedule.kind === "fixed" ? [configuration.schedule.choices] : configuration.schedule.weeks;
  const references = slots.flatMap(menuChoiceReferences);
  const emptySlots = slots.filter(slot => !menuChoiceReferences(slot).length).length;
  const current = useAssignedDishes(references.map(reference => reference.dishId), dishes);
  const currentById = new Map([...dishes, ...current.items].map(dish => [dish.id, dish]));
  const saved = useProductMenuDishes(references, dishes);
  const missing = new Set(references.filter(reference => !saved.byRevision.has(productMenuDishKey(reference))).map(productMenuDishKey));
  const changed = new Set(references.filter(reference => (currentById.get(reference.dishId)?.version ?? 0) > reference.revision).map(productMenuDishKey));
  const checkingDishes = saved.loading || current.loading;
  const invalidDishes = Boolean(saved.error || current.error || current.missing.length || missing.size || changed.size);
  const authorized = Boolean(pilot?.publish && canPublish);
  const validDate = Boolean(pilot && effectiveDate && effectiveDate >= pilot.firstDate && effectiveDate <= pilot.lastDate);
  const localReady = authorized && validDate && !checkingDishes && !invalidDishes && !emptySlots;
  const canSubmit = Boolean(localReady && readiness?.reviewToken && !readiness.issues.length && !publicationId);
  const siteName = pilot && catalogue.value?.sites.find(site => site.id === pilot.oplocId)?.name;

  function dishName(reference: ProductMenuDishReference) {
    const dish = saved.byRevision.get(productMenuDishKey(reference));
    return dish ? dish.name || "Unnamed dish" : saved.loading ? "Loading dish…" : "Dish revision unavailable";
  }

  async function handleRequest(task: () => Promise<void>, fallback: string) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : fallback);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function checkReadiness() {
    if (!localReady || publicationId || inFlight.current) return;
    setReadiness(null);
    await handleRequest(async () => {
      setReadiness(await submit<Readiness>({ action: "review", itemId: draft.itemId, version: draft.version, effectiveDate }));
    }, "CPU and Hub readiness checks could not be completed.");
  }

  async function publish() {
    if (!canSubmit || !readiness?.reviewToken) return;
    await handleRequest(async () => {
      const { publication } = await submit<{ publication: StudioPublicationDescriptor }>({
        action: "publish", itemId: draft.itemId, version: draft.version, effectiveDate, reviewToken: readiness.reviewToken, confirmed: true,
      });
      setPublicationId(publication.id);
      if (publication.sourceDraftVersion === draft.version) onPublished();
    }, "Hub did not confirm publication.");
  }

  async function activate() {
    if (!authorized || !pilot?.activateProduct || !publicationId || activated || inFlight.current || activationReason.trim().length < 3) return;
    const attempt = activationAttempt || { commandId: crypto.randomUUID(), expectedGeneration: pilot.generation };
    setActivationAttempt(attempt);
    await handleRequest(async () => {
      await submit({ action: "activate", itemId: draft.itemId, publicationId, ...attempt, reason: activationReason });
      setActivated(true);
    }, "Hub did not confirm activation. Retry the same request.");
  }

  const configHint = emptySlots
    ? `${emptySlots} ${configuration.schedule.kind === "fixed" ? "menu still needs dishes." : emptySlots === 1 ? "week still needs dishes." : "weeks still need dishes."}`
    : `${slots.length} ${configuration.schedule.kind === "fixed" ? "fixed menu" : slots.length === 1 ? "week" : "weeks"} · ${references.length} dish assignments`;
  const evidenceHint = checkingDishes ? "Loading assigned dish revisions."
    : changed.size ? `${changed.size} selected dish revisions have changed. Return to the editor to update them.`
    : invalidDishes ? "Some saved dish revisions could not be verified."
    : readiness?.reviewToken && !readiness.issues.length ? "The current CPU and Hub checks passed."
    : readiness ? "Resolve the issues from the latest review." : "Current approvals are verified by an authorised readiness check.";

  return <ProductMenuReviewLayout
    productName={productName} configuration={configuration} dishName={dishName} onBack={onBack}
    published={Boolean(publicationId)} activated={activated} busy={busy}
    settings={<>
      <StudioField label="Effective from">
        <input className={styles.date} type="date" min={pilot?.firstDate} max={pilot?.lastDate} value={effectiveDate}
          disabled={!authorized || busy || Boolean(publicationId)} onChange={event => { setEffectiveDate(event.target.value); setReadiness(null); }} />
      </StudioField>
      <dl className={styles.siteScope}><dt>Eligible site scope</dt><dd>{authorized ? siteName || "Authorised pilot site" : "No verified publication site for this account"}</dd></dl>
    </>}
    checks={<>
      <ul className={styles.checks}>
        <li className={styles.check}><div><strong>Menu configuration</strong><p>{configHint}</p></div>
          <StudioStatus tone={emptySlots ? "warning" : "success"}>{emptySlots ? "Action needed" : "Complete"}</StudioStatus></li>
        <li className={styles.check}><div><strong>Commercial rules</strong><p>Hub verifies product eligibility and the applicable terms.</p></div>
          <StudioStatus tone={readiness?.reviewToken && !readiness.issues.length ? "success" : "neutral"}>
            {readiness?.reviewToken && !readiness.issues.length ? "Verified" : "Check required"}
          </StudioStatus></li>
        <li className={styles.check}><div><strong>Allergen approvals</strong><p>{evidenceHint}</p></div>
          <StudioStatus tone={invalidDishes || readiness?.issues.length ? "warning" : readiness?.reviewToken ? "success" : "neutral"}>
            {checkingDishes ? "Checking" : invalidDishes || readiness?.issues.length ? "Action needed" : readiness?.reviewToken ? "Verified" : "Check required"}
          </StudioStatus></li>
      </ul>
      {Boolean(readiness?.issues.length) && <ul className={styles.issueList}>{readiness!.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
      {(current.error || saved.error) && <StudioButton onClick={() => { if (current.error) current.retry(); if (saved.error) saved.retry(); }}>Retry dish details</StudioButton>}
      {authorized && !publicationId && <StudioButton onClick={() => void checkReadiness()} disabled={!localReady} busy={busy}>Check readiness</StudioButton>}
      <p className={styles.notes}>Booking impact is unavailable for this publication scope. Existing bookings retain their accepted records.</p>
    </>}
    actions={<div className={styles.publicationActions}>
      {!publicationId && <StudioButton variant="primary" className={styles.publish} onClick={() => void publish()} busy={busy}
        disabled={!canSubmit} disabledReason={authorized ? "Publication requires a passing readiness check." : "Publication authority is unavailable for this account and scope."}>Publish menu</StudioButton>}
      {publicationId && <p role="status">Hub confirmed publication. Customer availability requires separate activation.</p>}
      {publicationId && pilot?.activateProduct && authorized && <>
        <StudioField label="Activation reason"><input value={activationReason} maxLength={500} disabled={Boolean(activationAttempt) || activated}
          onChange={event => setActivationReason(event.target.value)} /></StudioField>
        <StudioButton variant="primary" onClick={() => void activate()} busy={busy} disabled={activated || activationReason.trim().length < 3}>
          {activated ? "Activated for customers" : activationAttempt ? "Retry activation" : "Activate for customers"}
        </StudioButton>
      </>}
      {error && <p role="alert">{error}</p>}
    </div>}
  />;
}
