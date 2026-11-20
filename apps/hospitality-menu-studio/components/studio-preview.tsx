import { useState } from "react";
import {
  londonDate,
  rotationWeek,
  type Dish,
  type Menu,
  type Publication,
  type Review,
} from "../lib/contract";
import {
  Breadcrumb,
  Button,
  Icon,
  PageHeading,
  Pill,
  formatDate,
  title,
} from "./studio-ui";
import styles from "./studio.module.css";

type Site = { id: string; name: string };
export type SitePreview = {
  catalogue?: { siteId: string; contentHash: string; scope: string };
  items: {
    id: string;
    name: string;
    dishes: { id: string; name: string; description: string }[];
  }[];
};

export function CustomerPreview({
  menu,
  dishes,
  date,
  setDate,
  initialSection,
  valid,
  saved,
  busy,
  sites,
  siteId,
  setSite,
  loadSites,
  checkSite,
  sitePreview,
  notice,
  back,
  openMapping,
}: {
  menu: Menu;
  dishes: Dish[];
  date: string;
  setDate: (date: string) => void;
  initialSection: string;
  valid: boolean;
  saved: boolean;
  busy: boolean;
  sites: Site[];
  siteId: string;
  setSite: (id: string) => void;
  loadSites: () => void;
  checkSite: () => void;
  sitePreview: SitePreview | null;
  notice: string;
  back: () => void;
  openMapping: (sectionId: string) => void;
}) {
  const [screen, setScreen] = useState<"web" | "mobile">("web");
  const [sectionId, setSectionId] = useState(initialSection);
  const [category, setCategory] = useState("all");
  const section =
    menu.sections.find((item) => item.id === sectionId) || menu.sections[0];
  const hasMappings = menu.sections.some((item) => item.catalogueItemId);
  const missingMapping =
    (section && !section.catalogueItemId ? section : undefined) ||
    menu.sections.find((item) => !item.catalogueItemId);
  const ids =
    valid && section
      ? section.mode === "rotation"
        ? section.weeks[rotationWeek(menu.anchorMonday, date) - 1] || []
        : section.staticDishIds
      : [];
  const selected = ids.map((id) => dishes.find((dish) => dish.id === id));
  const group = (dish: Dish) =>
    dish.category === "vegetarian" || dish.category === "vegan"
      ? "veg"
      : dish.category;
  const groups = [
    ...new Set(selected.flatMap((dish) => (dish ? [group(dish)] : []))),
  ];
  const groupName = (name: string) =>
    name === "veg" ? "Veggie / Vegan" : title(name);

  return (
    <>
      <PageHeading
        title="Customer preview"
        eyebrow={
          <Breadcrumb>
            <button onClick={back}>Menu overview</button>
            <span>/</span>
            <span>Preview</span>
          </Breadcrumb>
        }
        context={<p>This draft shows customer-facing menu content for an event date. It does not confirm customer availability or make the menu bookable.</p>}
      >
        <div
          className={styles.segmented}
          role="group"
          aria-label="Preview layout"
        >
          <button
            type="button"
            aria-pressed={screen === "web"}
            onClick={() => setScreen("web")}
          >
            Web
          </button>
          <button
            type="button"
            aria-pressed={screen === "mobile"}
            onClick={() => setScreen("mobile")}
          >
            Mobile
          </button>
        </div>
      </PageHeading>
      <div className={styles.filterBar}>
        <label className="fika-field">
          Event date
          <input
            type="date"
            className="fika-input"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <Button disabled={busy} onClick={loadSites}>
          Load sites
        </Button>
        {sites.length > 0 && (
          <label className="fika-field">
            Site
            <select
              className="fika-select"
              value={siteId}
              onChange={(event) => setSite(event.target.value)}
            >
              <option value="">Select a site</option>
              {sites.map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button
          disabled={busy || !siteId || !valid || !saved || !hasMappings}
          onClick={checkSite}
        >
          Check site offerings
        </Button>
      </div>
      <p className="fika-help">
        Site checks use linked Hub catalogue items for the selected site and event date. Save the draft before checking.
      </p>
      {!hasMappings && (
        <div className="fika-notice">
          <p>No sections are linked to Hub catalogue items, so there are no offerings to check.</p>
          {missingMapping ? (
            <Button onClick={() => openMapping(missingMapping.id)}>
              Set up mapping for {missingMapping.name || "Untitled section"}
            </Button>
          ) : (
            <Button onClick={back}>Go to menu overview</Button>
          )}
        </div>
      )}
      {busy && <p role="status">Loading catalogue information…</p>}
      {hasMappings && !busy && !sitePreview && !notice && (
        <p className="fika-help">Select a site to check its linked offerings.</p>
      )}
      {notice && (
        <p role="status" className="fika-notice">
          {notice}
        </p>
      )}
      <div className={styles.customerFrame} data-layout={screen}>
        <div className={styles.customerBanner}>
          <div>
            <h2>{menu.name || "Untitled menu"}</h2>
            <span>Hospitality menu</span>
          </div>
          <Pill tone="info">Draft preview</Pill>
        </div>
        {valid && section ? (
          <div className={styles.customerLayout}>
            <nav aria-label="Preview menu sections">
              {menu.sections.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={section.id === item.id}
                  onClick={() => {
                    setSectionId(item.id);
                    setCategory("all");
                  }}
                >
                  {item.name || "Untitled section"}
                </button>
              ))}
            </nav>
            <div className={styles.customerContent}>
              <div className={styles.sectionHeading}>
                <h3>{section.name || "Untitled section"}</h3>
                <div
                  className={styles.chips}
                  role="group"
                  aria-label="Preview dish category"
                >
                  <button
                    type="button"
                    aria-pressed={category === "all"}
                    onClick={() => setCategory("all")}
                  >
                    All
                  </button>
                  {groups.map((key) => (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={category === key}
                      onClick={() => setCategory(key)}
                    >
                      {groupName(key)}
                    </button>
                  ))}
                </div>
              </div>
              {groups
                .filter((key) => category === "all" || key === category)
                .map((key) => {
                  const matching = selected.filter(
                    (dish): dish is Dish =>
                      dish !== undefined && group(dish) === key,
                  );
                  return (
                    <section className={styles.previewGroup} key={key}>
                      <h4>
                        {groupName(key)} ({matching.length})
                      </h4>
                      {matching.map((dish) => (
                        <div className={styles.customerDish} key={dish.id}>
                          <strong>{dish.name}</strong>
                          <p>
                            {dish.customerDescription || "Description pending."}
                          </p>
                        </div>
                      ))}
                    </section>
                  );
                })}
              {!groups.length && (
                <p className={styles.empty}>
                  No dishes selected for this event date.
                </p>
              )}
              {selected.some((dish) => !dish) && (
                <p>Some dish content is unavailable in the loaded results.</p>
              )}
            </div>
          </div>
        ) : (
          <p className={styles.empty}>
            Select an event date within the menu dates. Rotating sections also
            need a Monday anchor.
          </p>
        )}
      </div>
      {sitePreview && (
        <section className={styles.panelBody}>
          <h2>Site offerings check</h2>
          {!sitePreview.items.length && (
            <p>No linked offerings are visible for this site and date. Try another site or date, or review the section mappings.</p>
          )}
          {sitePreview.items.map((item) => (
            <div key={item.id}>
              <h3>{item.name}</h3>
              {item.dishes.map((dish) => (
                <p key={dish.id}>
                  <strong>{dish.name}</strong> · {dish.description}
                </p>
              ))}
            </div>
          ))}
        </section>
      )}
    </>
  );
}

type ReviewProps = {
  menu: Menu;
  dishes: Dish[];
  date: string;
  setDate: (date: string) => void;
  scope: { sectionId: string; week: string; dishId: string };
  setSection: (section: string) => void;
  setWeek: (week: string) => void;
  setDish: (dish: string) => void;
  result: Review | null;
  busy: boolean;
  saved: boolean;
  canPublish: boolean;
  notice: string;
  back: () => void;
  check: () => void;
  publish: () => void;
  impact: () => void;
};

export function PublicationReview({
  menu,
  dishes,
  date,
  setDate,
  scope,
  setSection,
  setWeek,
  setDish,
  result,
  busy,
  saved,
  canPublish,
  notice,
  back,
  check,
  publish,
  impact,
}: ReviewProps) {
  const today = londonDate();
  const [schedule, setSchedule] = useState(!date || date !== today);
  const approved = Boolean(
    result?.canPublish &&
      result.safety.status === "verified" &&
      result.reviewToken &&
      canPublish &&
      saved,
  );
  return (
    <>
      <PageHeading
        title="Review changes"
        eyebrow={
          <Breadcrumb>
            <button onClick={back}>{menu.name || "Menu overview"}</button>
            <span>/</span>
            <span>Review &amp; publish</span>
          </Breadcrumb>
        }
        context={
          <p>Check the draft scope, food safety and publication details.</p>
        }
      />
      <div className={styles.panel}>
        <div className={styles.checkRow}>
          <Icon name="menus" />
          <strong>Changes to publish</strong>
          <span>
            {result
              ? result.changes.length + " items in scope"
              : "Review pending"}
          </span>
          <Pill tone="neutral">Comparison unavailable</Pill>
        </div>
        <div className={styles.checkRow}>
          <Icon
            name={result?.safety.status === "verified" ? "check" : "warning"}
          />
          <strong>Allergen verification</strong>
          <span>
            {result?.safety.status === "verified"
              ? "Verified by the existing safety process"
              : "Signed verification is unavailable"}
          </span>
          <Pill
            tone={result?.safety.status === "verified" ? "success" : "warning"}
          >
            {result?.safety.status === "verified" ? "Verified" : "Blocked"}
          </Pill>
        </div>
        <div className={styles.checkRow}>
          <Icon name={result && !result.issues.length ? "check" : "warning"} />
          <strong>Menu completeness</strong>
          <span>
            {result
              ? result.issues.length
                ? result.issues.length + " checks need attention"
                : "Required draft details present"
              : "Run checks for this draft"}
          </span>
          <Pill tone={result && !result.issues.length ? "success" : "neutral"}>
            {result && !result.issues.length ? "Complete" : "Pending"}
          </Pill>
        </div>
        <div className={styles.checkRow}>
          <Icon name="calendar" />
          <strong>Future booking impact</strong>
          <span>
            {result?.impact.status === "available"
              ? result.impact.bookings.length + " affected"
              : "Affected bookings unknown"}
          </span>
          <button className={styles.textAction} type="button" onClick={impact}>
            View impact <Icon name="forward" />
          </button>
        </div>
      </div>
      <div className={styles.editorColumns}>
        <section className={styles.formStack} aria-label="Publication">
          <h2>Publication</h2>
          <label className="fika-choice">
            <input
              type="radio"
              name="publication-timing"
              checked={!schedule}
              onChange={() => {
                setSchedule(false);
                setDate(today);
              }}
            />{" "}
            Publish now
          </label>
          <label className="fika-choice">
            <input
              type="radio"
              name="publication-timing"
              checked={schedule}
              onChange={() => {
                setSchedule(true);
                setDate(date === today ? "" : date);
              }}
            />{" "}
            Schedule publication
          </label>
          {schedule && (
            <label className="fika-field">
              Effective date
              <input
                type="date"
                className="fika-input"
                value={date}
                onChange={(event) => setDate(event.target.value)}
              />
            </label>
          )}
          <div className={styles.formGrid}>
            <label className="fika-field">
              Section scope
              <select
                className="fika-select"
                value={scope.sectionId}
                onChange={(event) => setSection(event.target.value)}
              >
                <option value="">Entire menu</option>
                {menu.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}
                  </option>
                ))}
              </select>
            </label>
            {menu.sections.find((section) => section.id === scope.sectionId)
              ?.mode === "rotation" && (
              <label className="fika-field">
                Week scope
                <select
                  className="fika-select"
                  value={scope.week}
                  onChange={(event) => setWeek(event.target.value)}
                >
                  <option value="">All weeks</option>
                  {[1, 2, 3, 4, 5, 6].map((week) => (
                    <option key={week} value={week}>
                      Week {week}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="fika-field">
              Dish scope
              <select
                className="fika-select"
                value={scope.dishId}
                onChange={(event) => setDish(event.target.value)}
              >
                <option value="">All dishes</option>
                {dishes.map((dish) => (
                  <option key={dish.id} value={dish.id}>
                    {dish.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
        <section className={styles.summary}>
          <h2>Review summary</h2>
          <p>
            <strong>{menu.name || "Untitled draft"}</strong> · Draft{" "}
            {menu.version}
          </p>
          <p>
            {date
              ? "Effective: " + formatDate(date)
              : "Choose an effective date."}
          </p>
          {result?.changes.length ? (
            <ul>
              {result.changes.map((change, index) => (
                <li key={index}>{change}</li>
              ))}
            </ul>
          ) : (
            <p>Run the checks to see the selected scope.</p>
          )}
          <p>Existing bookings keep their original specifications.</p>
        </section>
      </div>
      {result?.issues.length ? (
        <details className={styles.disclosure}>
          <summary>Review issues ({result.issues.length})</summary>
          <ul>
            {result.issues.map((issue, index) => (
              <li key={index}>{issue}</li>
            ))}
          </ul>
        </details>
      ) : null}
      {notice && <p role="status">{notice}</p>}
      <div className={styles.footerActions}>
        <Button onClick={back}>Back</Button>
        <Button onClick={check} disabled={busy || !saved || !date}>
          {busy ? "Checking…" : "Check changes and impact"}
        </Button>
        <Button primary onClick={publish} disabled={busy || !approved}>
          Confirm and publish <Icon name="forward" />
        </Button>
      </div>
    </>
  );
}

export function BookingImpact({
  menu,
  result,
  back,
}: {
  menu: Menu;
  result: Review | null;
  back: () => void;
}) {
  const available =
    result?.impact.status === "available" ? result.impact.bookings : null;
  return (
    <>
      <PageHeading
        title="Affected future bookings"
        eyebrow={
          <Breadcrumb>
            <span>{menu.name || "Draft"}</span>
            <span>/</span>
            <button onClick={back}>Publish</button>
          </Breadcrumb>
        }
      />
      <div
        className={
          "fika-notice " +
          (available?.length === 0 ? "" : "fika-notice--warning")
        }
        role="status"
      >
        <strong>
          {available
            ? available.length
              ? available.length + " affected future bookings"
              : "No affected bookings reported"
            : "Booking impact is unavailable"}
        </strong>
        <p>
          {available
            ? "The current impact check is advisory."
            : "The number of affected bookings is unknown. An authoritative impact check is required."}
        </p>
      </div>
      {available && available.length > 0 && (
        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th scope="col">Booking</th>
                <th scope="col">Event date</th>
                <th scope="col">Site</th>
                <th scope="col">Affected selection</th>
              </tr>
            </thead>
            <tbody>
              {available.map((row) => (
                <tr key={row.id}>
                  <th scope="row">{row.id}</th>
                  <td>{formatDate(row.eventDate)}</td>
                  <td>{row.site}</td>
                  <td>{row.selections.join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="fika-notice">
        Existing bookings retain their dishes and kitchen specifications.
        Publication does not amend, cancel or resend them to CPU.
      </p>
      <div className={styles.footerActions}>
        <Button onClick={back}>
          Back to review <Icon name="forward" />
        </Button>
      </div>
    </>
  );
}

export function CollectionActivation({
  menu,
  history,
  loadHistory,
  revision,
  setRevision,
  visibility,
  setVisibility,
  confirmed,
  setConfirmed,
  canPublish,
  busy,
  back,
  activate,
  kitchen,
  notice,
}: {
  menu: Menu;
  history: Publication[];
  loadHistory: () => void;
  revision: string;
  setRevision: (id: string) => void;
  visibility: "staff" | "customer";
  setVisibility: (value: "staff" | "customer") => void;
  confirmed: boolean;
  setConfirmed: (value: boolean) => void;
  canPublish: boolean;
  busy: boolean;
  back: () => void;
  activate: () => void;
  kitchen?: () => void;
  notice: string;
}) {
  return (
    <>
      <div
        className={styles.tabBar}
        role="group"
        aria-label="Operational preview"
      >
        <span aria-current="page">Special collection activation</span>
        {kitchen && (
          <button type="button" onClick={kitchen}>
            CPU kitchen spec preview
          </button>
        )}
      </div>
      <PageHeading
        title="Activate special collection"
        eyebrow={
          <Breadcrumb>
            <button onClick={back}>Collections</button>
            <span>/</span>
            <span>{menu.name || "Untitled collection"}</span>
          </Breadcrumb>
        }
      />
      <div className={styles.editorColumns}>
        <section className={styles.formStack}>
          <label className="fika-field">
            Collection name
            <input className="fika-input" value={menu.name} readOnly />
          </label>
          <label className="fika-field">
            Published revision
            <select
              className="fika-select"
              disabled={!history.length}
              value={revision}
              onChange={(event) => setRevision(event.target.value)}
            >
              <option value="">Select a revision</option>
              {history.map((item) => (
                <option key={item.id} value={item.id}>
                  Revision {item.revision} · {formatDate(item.effectiveDate)}
                </option>
              ))}
            </select>
          </label>
          <Button disabled={busy} onClick={loadHistory}>
            Load published history
          </Button>
          <fieldset className={styles.formStack}>
            <legend>Visibility</legend>
            <label className="fika-choice">
              <input
                type="radio"
                name="collection-visibility"
                checked={visibility === "staff"}
                onChange={() => setVisibility("staff")}
              />{" "}
              Staff only (planning and preparation)
            </label>
            <label className="fika-choice">
              <input
                type="radio"
                name="collection-visibility"
                checked={visibility === "customer"}
                onChange={() => setVisibility("customer")}
              />{" "}
              Customer-facing (subject to Hub rules)
            </label>
          </fieldset>
        </section>
        <section className={styles.summary}>
          <h2>Activation details</h2>
          <p>
            Activation requires a verified published revision. Customer
            availability is governed by Hub.
          </p>
          <p>
            Existing bookings retain their current menu and kitchen
            specifications.
          </p>
          {!canPublish && <Pill tone="warning">Activation unavailable</Pill>}
        </section>
      </div>
      {notice && <p role="status">{notice}</p>}
      <div className={styles.footerActions}>
        <Button onClick={back}>Back</Button>
        {canPublish && (
          <label className="fika-choice">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />{" "}
            Confirm this separate activation request
          </label>
        )}
        <Button
          onClick={activate}
          primary
          disabled={!canPublish || !revision || !confirmed || busy}
        >
          Activate collection
        </Button>
      </div>
    </>
  );
}
