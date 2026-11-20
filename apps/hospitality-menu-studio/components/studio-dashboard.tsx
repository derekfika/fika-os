import { useEffect, useRef, useState } from "react";
import type { Dish, Menu } from "../lib/contract";
import { Button, dateRange, Icon, PageHeading, Pill } from "./studio-ui";
import styles from "./studio.module.css";

export type NewMenuDetails = Pick<
  Menu,
  "kind" | "name" | "startDate" | "endDate" | "anchorMonday"
> & { baseId: string };

export function MenuDashboard({
  actorName,
  menus,
  dishes,
  canManage,
  create,
  openMenu,
  openList,
  openDishes,
  openCollections,
}: {
  actorName: string;
  menus: Menu[];
  dishes: Dish[];
  canManage: boolean;
  create: () => void;
  openMenu: (menu: Menu) => void;
  openList: () => void;
  openDishes: () => void;
  openCollections: () => void;
}) {
  const draft = menus
    .filter((menu) => menu.kind === "seasonal")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const latest = [...menus, ...dishes]
    .filter((item) => item.updatedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return (
    <>
      <div className={styles.dashboardHeading}>
        <span className={styles.heroIcon}>
          <Icon name="chef" />
        </span>
        <PageHeading
          title={"Welcome, " + actorName.split(" ")[0]}
          context={<p>Your Hospitality menus</p>}
        >
          <Button primary disabled={!canManage} onClick={create}>
            <Icon name="plus" /> New menu
          </Button>
        </PageHeading>
      </div>
      <div className={styles.dashboardGrid}>
        <section className={styles.dashboardCard}>
          <div className={styles.cardLabel}>
            <span>Current seasonal menu</span>
            <Pill>Unavailable</Pill>
          </div>
          <h2>Published menu</h2>
          <p>Current publication details are unavailable.</p>
          <Button onClick={openList}>
            View seasonal drafts <Icon name="forward" />
          </Button>
        </section>
        <section className={styles.dashboardCard}>
          <div className={styles.cardLabel}>
            <span>Seasonal draft</span>
            {draft && <Pill tone="info">Draft</Pill>}
          </div>
          <h2>{draft?.name || "No draft yet"}</h2>
          <p>
            {draft
              ? dateRange(draft.startDate, draft.endDate)
              : "Create a seasonal menu to get started."}
          </p>
          <Button
            disabled={!draft && !canManage}
            onClick={() => (draft ? openMenu(draft) : create())}
          >
            {draft ? "Continue editing" : "Create seasonal menu"}{" "}
            <Icon name="forward" />
          </Button>
        </section>
      </div>
      <div className={styles.quickLinks}>
        <button type="button" onClick={openDishes}>
          <Icon name="dishes" />
          <span>
            <strong>Dish collection</strong>
            <small>{dishes.length} loaded</small>
          </span>
        </button>
        <button type="button" onClick={openCollections}>
          <Icon name="collection" />
          <span>
            <strong>Special collections</strong>
            <small>
              {menus.filter((menu) => menu.kind === "collection").length} loaded
            </small>
          </span>
        </button>
        <div>
          <Icon name="history" />
          <span>
            <strong>Recent draft activity</strong>
            <small title={latest?.name}>
              {latest?.name || "No saved drafts yet"}
            </small>
          </span>
        </div>
      </div>
    </>
  );
}

const steps = ["Type", "Details", "Confirm"] as const;

export function MenuWizard({
  initialKind,
  menus,
  close,
  create,
}: {
  initialKind: Menu["kind"];
  menus: Menu[];
  close: () => void;
  create: (fields: NewMenuDetails) => void;
}) {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, [step]);
  const [details, setDetails] = useState<NewMenuDetails>({
    kind: initialKind,
    name: "",
    startDate: "",
    endDate: "",
    anchorMonday: "",
    baseId: "",
  });
  function set<K extends keyof NewMenuDetails>(
    key: K,
    value: NewMenuDetails[K],
  ) {
    setDetails((previous) => ({ ...previous, [key]: value }));
  }
  const draftName =
    details.kind === "seasonal" ? "Seasonal menu" : "Special collection";
  return (
    <section className={styles.wizard} aria-labelledby="new-menu-title">
      <h1 tabIndex={-1} ref={heading} id="new-menu-title">
        Create a new menu
      </h1>
      <ol className={styles.steps} aria-label="Creation progress">
        {steps.map((label, index) => (
          <li key={label} aria-current={index === step ? "step" : undefined}>
            <span>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (step < 2) setStep(step + 1);
          else create(details);
        }}
      >
        {step === 0 && (
          <fieldset className={styles.wizardChoices}>
            <legend>What would you like to create?</legend>
            <label data-active={details.kind === "seasonal"}>
              <Icon name="calendar" />
              <span>
                <strong>Seasonal menu</strong>
                <small>
                  A company-wide menu for a season, with optional six-week
                  rotations.
                </small>
              </span>
              <input
                type="radio"
                name="menu-kind"
                checked={details.kind === "seasonal"}
                onChange={() => set("kind", "seasonal")}
              />
            </label>
            <label data-active={details.kind === "collection"}>
              <Icon name="collection" />
              <span>
                <strong>Special collection</strong>
                <small>A focused menu for an event or occasion.</small>
              </span>
              <input
                type="radio"
                name="menu-kind"
                checked={details.kind === "collection"}
                onChange={() => set("kind", "collection")}
              />
            </label>
          </fieldset>
        )}
        {step === 1 && (
          <div className={styles.wizardFields}>
            <label className="fika-field">
              Name
              <input
                className="fika-input"
                value={details.name}
                maxLength={200}
                onChange={(event) => set("name", event.target.value)}
              />
            </label>
            <label className="fika-field">
              Copy an existing menu (optional)
              <select
                className="fika-select"
                value={details.baseId}
                onChange={(event) => {
                  const baseId = event.target.value;
                  const anchorMonday =
                    menus.find((menu) => menu.id === baseId)?.anchorMonday ||
                    "";
                  setDetails((previous) => ({
                    ...previous,
                    baseId,
                    anchorMonday,
                  }));
                }}
              >
                <option value="">Start empty</option>
                {menus.map((menu) => (
                  <option key={menu.id} value={menu.id}>
                    {menu.name || "Untitled draft"}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.formGrid}>
              <label className="fika-field">
                Start date
                <input
                  type="date"
                  className="fika-input"
                  value={details.startDate}
                  onChange={(event) => set("startDate", event.target.value)}
                />
              </label>
              <label className="fika-field">
                End date
                <input
                  type="date"
                  className="fika-input"
                  value={details.endDate}
                  onChange={(event) => set("endDate", event.target.value)}
                />
              </label>
              <label className="fika-field">
                Rotation anchor Monday
                <input
                  type="date"
                  className="fika-input"
                  value={details.anchorMonday}
                  onChange={(event) => set("anchorMonday", event.target.value)}
                />
              </label>
            </div>
          </div>
        )}
        {step === 2 && (
          <section className={styles.summary}>
            <Pill tone="info">{draftName}</Pill>
            <h2>{details.name.trim() || "Untitled draft"}</h2>
            <p>{dateRange(details.startDate, details.endDate)}</p>
            {details.baseId && (
              <p>
                Copying sections from{" "}
                {menus.find((menu) => menu.id === details.baseId)?.name ||
                  "the selected menu"}
                .
              </p>
            )}
          </section>
        )}
        <div className={styles.footerActions}>
          <Button onClick={close}>Cancel</Button>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          <Button type="submit" primary>
            {step < 2 ? "Continue" : "Create draft"} <Icon name="forward" />
          </Button>
        </div>
      </form>
    </section>
  );
}
