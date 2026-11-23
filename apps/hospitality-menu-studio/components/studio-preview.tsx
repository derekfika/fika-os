import { useRef, useState } from "react";
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
  SaveNotice,
  formatDate,
  title,
  type DraftStatus,
} from "./studio-ui";
import styles from "./studio.module.css";
import { sectionDishIds } from "./studio-dish-collection-model";
import { useAssignedDishes } from "./use-assigned-dishes";
import {
  presentReviewIssues,
  type PublicationReceipt,
  type ReviewIssueTarget,
} from "./studio-review-model";

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
  review,
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
  review: () => void;
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
  const assigned = useAssignedDishes(ids, dishes);
  const byId = new Map([...assigned.items, ...dishes].map((dish) => [dish.id, dish]));
  const selected = ids.map((id) => byId.get(id));
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
            <button onClick={back}>{menu.name || "Menu editor"}</button>
            <span>/</span>
            <span>Preview</span>
          </Breadcrumb>
        }
        context={<p>Customer-facing draft content for the selected date. Check site availability separately.</p>}
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
        <Button primary onClick={review}>Review &amp; publish</Button>
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
              {!ids.length && (
                <p className={styles.empty}>
                  No dishes selected for this event date.
                </p>
              )}
              {assigned.loading && <p role="status">Loading assigned dishes…</p>}
              {assigned.error && (
                <div className="fika-notice fika-notice--warning">
                  <p role="status">Some assigned dishes could not be loaded for this preview.</p>
                  <Button onClick={assigned.retry}>Retry loading dishes</Button>
                </div>
              )}
              {assigned.missing.length > 0 && (
                <p role="status">Some assigned dishes are unavailable. The preview shows the dishes that could be found.</p>
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
  publication: PublicationReceipt | null;
  busy: boolean;
  save: DraftStatus;
  canPublish: boolean;
  publicationBlockedReason: string;
  notice: string;
  back: () => void;
  check: () => void;
  publish: () => void;
  impact: () => void;
  reviewDishes: () => void;
  viewHistory: () => void;
  editIssue: (target: ReviewIssueTarget) => void;
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
  publication,
  busy,
  save,
  canPublish,
  publicationBlockedReason,
  notice,
  back,
  check,
  publish,
  impact,
  reviewDishes,
  viewHistory,
  editIssue,
}: ReviewProps) {
  const today = londonDate();
  const issueDetails = useRef<HTMLDetailsElement>(null);
  const presented = result ? presentReviewIssues(result, menu, dishes) : null;
  const hasReviewDetails = Boolean(
    presented && (presented.editable.length || presented.other.length || presented.authoritiesUnavailable),
  );
  const [schedule, setSchedule] = useState(!date || date !== today);
  const saved = save.state === "saved";
  const scopeSection = menu.sections.find((section) => section.id === scope.sectionId);
  const scopeIds = new Set(scopeSection
    ? scope.week && scopeSection.mode === "rotation"
      ? scopeSection.weeks[Number(scope.week) - 1] ?? []
      : sectionDishIds(scopeSection)
    : menu.sections.flatMap(sectionDishIds));
  const scopedDishes = dishes.filter((dish) => scopeIds.has(dish.id));
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
      >
        <SaveNotice {...save} />
      </PageHeading>
      {publication && (
        <div className="fika-notice" role="status">
          <Pill tone="success">Published</Pill>
          <p>Revision {publication.revision} · Effective {formatDate(publication.effectiveDate)}</p>
          <p>Customer booking activation status is available from the Hospitality catalogue owner.</p>
          <Button onClick={viewHistory}>View published history</Button>
        </div>
      )}
      <div className={styles.panel}>
        <div className={styles.checkRow}>
          <Icon name="menus" />
          <strong>Changes to publish</strong>
          <span>
            {result
              ? result.changes.length + " items in scope"
              : "Review pending"}
          </span>
        </div>
        <div className={styles.checkRow}>
          <Icon
            name={result?.safety.status === "verified" ? "check" : "warning"}
          />
          <strong>Allergen verification</strong>
          <span>
            {!result
              ? "Run checks for this draft"
              : result.safety.status === "verified"
                ? "Signed evidence verified for the reviewed dish revisions"
                : result.safety.status === "unverified"
                  ? "Signed verification has not been confirmed"
                  : "Signed verification is unavailable"}
          </span>
          <Pill
            tone={result?.safety.status === "verified" ? "success" : "warning"}
          >
            {!result
              ? "Pending"
              : result.safety.status === "verified"
                ? "Verified"
                : "Blocked"}
          </Pill>
          {result?.safety.status === "unverified" && (
            <button type="button" className={styles.textAction} onClick={reviewDishes}>
              Open dishes for review <Icon name="forward" />
            </button>
          )}
        </div>
        <div className={styles.checkRow}>
          <Icon name={result && !presented?.editable.length ? "check" : "warning"} />
          <strong>Draft details</strong>
          <span>
            {!presented
              ? "Run checks for this draft"
              : presented.editable.length
                ? presented.editable.length + " items need attention"
                : "No draft detail issues reported"}
          </span>
          {hasReviewDetails ? (
            <button
              type="button"
              className={styles.textAction}
              onClick={() => {
                if (issueDetails.current) {
                  issueDetails.current.open = true;
                  issueDetails.current.querySelector("summary")?.focus();
                }
              }}
            >
              View details <Icon name="forward" />
            </button>
          ) : (
            <Pill tone={result ? "success" : "neutral"}>
              {result ? "Checked" : "Pending"}
            </Pill>
          )}
        </div>
        <div className={styles.checkRow}>
          <Icon name="calendar" />
          <strong>Future booking impact</strong>
          <span>
            {result?.impact.status === "available" && result.impact.coverage === "complete"
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
                {scopedDishes.map((dish) => (
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
      {presented && hasReviewDetails ? (
        <details className={styles.disclosure} ref={issueDetails}>
          <summary>Review details</summary>
          {presented.editable.length > 0 && (
            <>
              <h2>Draft details to check</h2>
              <ul>
                {presented.editable.map((issue, index) => (
                  <li key={index}>
                    {issue.text}{" "}
                    {issue.target && (
                      <button
                        type="button"
                        className={styles.textAction}
                        onClick={() => editIssue(issue.target!)}
                      >
                        {issue.target.kind === "dish"
                          ? "Edit dish"
                          : issue.target.kind === "section"
                            ? issue.target.mapping ? "Open catalogue mapping" : "Edit section"
                            : "Open menu"}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {presented.other.length > 0 && (
            <>
              <h2>Other checks</h2>
              <ul>
                {presented.other.map((issue, index) => (
                  <li key={index}>{issue}</li>
                ))}
              </ul>
            </>
          )}
          {presented.authoritiesUnavailable && (
            <>
              <h2>Checks not available yet</h2>
              <p>
                Food-safety sign-off, customer availability and the booking
                impact check are not available here yet. Your menu is still a
                draft. Continue editing and return to these checks when they
                become available.
              </p>
            </>
          )}
        </details>
      ) : null}
      {notice && <p role="status">{notice}</p>}
      {publicationBlockedReason && (
        <p className="fika-notice fika-notice--warning">{publicationBlockedReason}</p>
      )}
      {!approved && !publication && (
        <p className="fika-help">
          {!saved
            ? "Save the draft before running publication checks."
            : !date
              ? "Choose an effective date to run publication checks."
              : result
                ? "Resolve the issues in Review details, then run the checks again."
                : "Run the checks to see whether this draft can be published."}
        </p>
      )}
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
  const impact = result?.impact.status === "available" ? result.impact : null;
  const available = impact?.bookings ?? [];
  const complete = impact?.coverage === "complete";
  const parentMatches = impact?.reasons?.includes("DISH_SELECTION_EVIDENCE_UNAVAILABLE");
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
          (complete && available.length === 0 ? "" : "fika-notice--warning")
        }
        role="status"
      >
        <strong>
          {complete
            ? available.length
              ? available.length + " affected future bookings"
              : "No affected bookings reported"
            : impact
              ? "Booking impact is only partially checked"
              : "Booking impact is unavailable"}
        </strong>
        <p>
          {complete
            ? "The current impact check is advisory."
            : impact
              ? parentMatches
                ? "The total number of affected bookings is unknown. The table shows possible matches for the parent menu item."
                : "The total number of affected bookings is unknown. The table shows the matches the check could confirm."
              : "The number of affected bookings is unknown. The booking check is not available yet. Continue editing your draft and return to this check when it becomes available."}
        </p>
      </div>
      {available.length > 0 && (
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

export function CollectionAvailability({
  menu,
  history,
  historyLoaded,
  loadHistory,
  busy,
  back,
  kitchen,
  notice,
}: {
  menu: Menu;
  history: Publication[];
  historyLoaded: boolean;
  loadHistory: () => void;
  busy: boolean;
  back: () => void;
  kitchen?: () => void;
  notice: string;
}) {
  return (
    <>
      <PageHeading
        title="Collection availability"
        eyebrow={
          <Breadcrumb>
            <button onClick={back}>{menu.name || "Untitled collection"}</button>
            <span>/</span>
            <span>Availability</span>
          </Breadcrumb>
        }
      >
        {kitchen && <Button onClick={kitchen}>Kitchen preview</Button>}
      </PageHeading>
      <div className="fika-notice fika-notice--warning">
        <h2>Customer booking activation is unavailable in Studio</h2>
        <p>Contact the Hospitality catalogue owner to confirm whether a published collection is open for bookings.</p>
      </div>
      <div className={styles.sectionHeading}>
        <h2>Published revisions</h2>
        <Button disabled={busy} onClick={loadHistory}>
          {busy ? "Checking…" : historyLoaded ? "Refresh history" : "Load published history"}
        </Button>
      </div>
      <div className={styles.panel}>
        {history.map((item) => (
          <div className={styles.row} key={item.id}>
            <strong>Revision {item.revision}</strong>
            <span>Effective {formatDate(item.effectiveDate)}</span>
            <Pill tone="success">Published</Pill>
          </div>
        ))}
        {historyLoaded && !history.length && <p className={styles.empty}>There are no published revisions in Studio for this collection.</p>}
      </div>
      {notice && <p role="status">{notice}</p>}
      <div className={styles.footerActions}><Button onClick={back}>Back to collection</Button></div>
    </>
  );
}
