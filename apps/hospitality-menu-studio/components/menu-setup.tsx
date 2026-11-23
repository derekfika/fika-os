import { useEffect, useRef, useState } from "react";
import type { Menu } from "../lib/contract";
import { menuSetupIssue, openingWeekMonday } from "./menu-setup-model";
import { Button, Icon } from "./studio-ui";
import styles from "./studio.module.css";
import setup from "./menu-setup.module.css";

export type NewMenuDetails = Pick<
  Menu,
  "kind" | "name" | "startDate" | "endDate" | "anchorMonday"
> & { baseId: string };

export function MenuSetup({
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
  const heading = useRef<HTMLHeadingElement>(null);
  const [submitted, setSubmitted] = useState(false);
  const [details, setDetails] = useState<Omit<NewMenuDetails, "anchorMonday">>({
    kind: initialKind,
    name: "",
    startDate: "",
    endDate: "",
    baseId: "",
  });
  const [manualAnchor, setManualAnchor] = useState<string | null>(null);
  const base = menus.find((menu) => menu.id === details.baseId);
  const suggestedAnchor =
    base?.anchorMonday || openingWeekMonday(details.startDate);
  const anchorMonday = manualAnchor ?? suggestedAnchor;
  const issue = menuSetupIssue({ ...details, anchorMonday });

  useEffect(() => {
    heading.current?.focus();
  }, []);

  function set<K extends keyof typeof details>(
    key: K,
    value: (typeof details)[K],
  ) {
    setDetails((previous) => ({ ...previous, [key]: value }));
  }

  return (
    <section className={styles.wizard} aria-labelledby="new-menu-title">
      <h1 tabIndex={-1} ref={heading} id="new-menu-title">
        {details.kind === "seasonal"
          ? "New seasonal menu"
          : "New special collection"}
      </h1>
      <form
        className={setup.form}
        onSubmit={(event) => {
          event.preventDefault();
          setSubmitted(true);
          if (!issue && details.name.trim())
            create({ ...details, anchorMonday });
        }}
      >
        <div className={styles.formGrid}>
          <label className="fika-field">
            Menu type
            <select
              className="fika-select"
              value={details.kind}
              onChange={(event) =>
                set(
                  "kind",
                  event.target.value === "collection"
                    ? "collection"
                    : "seasonal",
                )
              }
            >
              <option value="seasonal">Seasonal menu</option>
              <option value="collection">Special collection</option>
            </select>
          </label>
          <label className="fika-field">
            Menu name
            <input
              className="fika-input"
              required
              maxLength={200}
              value={details.name}
              onChange={(event) => set("name", event.target.value)}
            />
          </label>
        </div>
        {menus.length > 0 && (
          <label className="fika-field">
            Copy sections from a menu (optional)
            <select
              className="fika-select"
              value={details.baseId}
              onChange={(event) => set("baseId", event.target.value)}
            >
              <option value="">Start with an empty menu</option>
              {menus.map((menu) => (
                <option key={menu.id} value={menu.id}>
                  {menu.name || "Untitled draft"}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={styles.formGrid} aria-describedby="menu-date-help">
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
        </div>
        <p id="menu-date-help" className="fika-help">
          You can set the dates later if the season is undecided.
        </p>
        <label className="fika-field">
          Monday of Week 1
          <input
            type="date"
            className="fika-input"
            value={anchorMonday}
            aria-describedby="rotation-start-help"
            onChange={(event) => setManualAnchor(event.target.value)}
          />
        </label>
        <p id="rotation-start-help" className="fika-help">
          Rotating sections follow the same six-week cycle from this Monday.{" "}
          {base?.anchorMonday
            ? "Keeping the copied menu’s Monday preserves its cycle."
            : "The Monday of the opening week is suggested once you enter a start date."}
        </p>
        {manualAnchor !== null &&
          suggestedAnchor &&
          manualAnchor !== suggestedAnchor && (
            <div>
              <Button onClick={() => setManualAnchor(null)}>
                Use suggested Monday
              </Button>
            </div>
          )}
        {submitted && (issue || !details.name.trim()) && (
          <p className="fika-notice fika-notice--warning" role="alert">
            {issue || "Enter a menu name."}
          </p>
        )}
        <div className={styles.footerActions}>
          <Button onClick={close}>Cancel</Button>
          <Button type="submit" primary>
            Create draft <Icon name="forward" />
          </Button>
        </div>
      </form>
    </section>
  );
}
