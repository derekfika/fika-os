import type { ReactNode } from "react";
import type { Dish } from "../lib/contract";
import styles from "./studio.module.css";

export type Page =
  | "home"
  | "menus"
  | "dishes"
  | "collections"
  | "history"
  | "preview"
  | "review"
  | "impact"
  | "kitchen"
  | "activation";
export type SaveState = "saved" | "unsaved" | "saving" | "error" | "conflict";
export type DraftStatus = {
  state: SaveState;
  error: string;
  retry: () => void;
};
export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const paths = {
  layers: "m3 8 9-5 9 5-9 5-9-5Zm0 4 9 5 9-5M3 16l9 5 9-5",
  home: "m3 10 9-7 9 7v10h-6v-6H9v6H3V10Z",
  menus: "M5 3h14v18H5zM8 7h8m-8 4h8m-8 4h5",
  dishes: "M4 3v5a3 3 0 0 0 6 0V3M7 3v18m10 0v-8h3V3c-3 1-5 4-5 8v2h2",
  collection:
    "m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z",
  publish: "m3 11 18-7-7 17-3-7-8-3Zm8 3L21 4",
  history: "M3 7v5h5m-4-1a8 8 0 1 1 1 6m7-9v5l3 2",
  chef: "M7 15a4 4 0 1 1 .7-7.9 5 5 0 0 1 8.6 0A4 4 0 1 1 17 15v5H7v-5Zm0 2h10",
  calendar: "M5 5h14v15H5zM8 3v4m8-4v4M5 10h14",
  plus: "M12 5v14M5 12h14",
  eye: "M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  forward: "m9 5 7 7-7 7",
  check: "m5 12 4 4L19 6",
  warning: "M12 3 2 21h20L12 3Zm0 6v5m0 3h.01",
  search: "M15 15l5 5m-4-9a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
} as const;

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg
      className={styles.icon}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[name]} />
    </svg>
  );
}

const nav = [
  ["home", "Home", "home"],
  ["menus", "Menus", "menus"],
  ["dishes", "Dishes", "dishes"],
  ["collections", "Collections", "collection"],
  ["review", "Publish", "publish"],
  ["history", "History", "history"],
] as const;

export function StudioShell({
  actorName,
  page,
  menuKind,
  demo,
  navigate,
  children,
}: {
  actorName: string;
  page: Page;
  menuKind?: "seasonal" | "collection";
  demo: boolean;
  navigate: (page: Page) => void;
  children: ReactNode;
}) {
  const active =
    page === "impact"
      ? "review"
      : page === "kitchen"
        ? "dishes"
        : page === "activation" ||
            ((page === "menus" || page === "preview") &&
              menuKind === "collection")
          ? "collections"
          : page === "preview"
            ? "menus"
            : page;
  const initials = actorName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((name) => name[0])
    .join("");
  return (
    <div className={styles.app}>
      <a className={styles.skip} href="#studio-main">
        Skip to content
      </a>
      <header className={styles.header}>
        <div className={styles.brand}>
          <Icon name="layers" /> FIKA OS
        </div>
        <span className={styles.product}>Hospitality Menu Studio</span>
        <div className={styles.actor}>
          {demo && <Pill tone="info">Demo data</Pill>}
          <span className={styles.avatar} aria-hidden="true">
            {initials}
          </span>
          <span>{actorName}</span>
        </div>
      </header>
      <div className={styles.layout}>
        <nav className={styles.nav} aria-label="Studio navigation">
          {nav.map(([id, label, icon]) => (
            <button
              key={id}
              type="button"
              aria-current={active === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              <Icon name={icon} />
              {label}
            </button>
          ))}
        </nav>
        <main id="studio-main" className={styles.main} tabIndex={-1}>
          {children}
        </main>
      </div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  primary,
  disabled,
  label,
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  label?: string;
  type?: "button" | "submit";
}) {
  return (
    <button
      type={type}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={
        "fika-button " +
        (primary ? "fika-button--primary" : "fika-button--secondary")
      }
    >
      {children}
    </button>
  );
}

export function Pill({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span className={styles.pill} data-tone={tone}>
      {children}
    </span>
  );
}

export const title = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

export function Temperature({ value }: { value: Dish["temperature"] }) {
  return (
    <Pill
      tone={value === "hot" ? "danger" : value === "cold" ? "info" : "neutral"}
    >
      {value ? title(value) : "Unspecified"}
    </Pill>
  );
}

export function SaveNotice({ state, error, retry }: DraftStatus) {
  const wording = {
    saved: "Draft saved",
    saving: "Saving…",
    unsaved: "Unsaved changes",
    conflict: "Version conflict",
    error: "Save failed",
  };
  const tone =
    state === "saved"
      ? "success"
      : state === "conflict" || state === "error"
        ? "warning"
        : "neutral";
  return (
    <div className={styles.save} role="status">
      <Pill tone={tone}>
        {state === "saved" && <Icon name="check" />}
        {wording[state]}
      </Pill>
      {error && <p>{error}</p>}
      {state === "error" && <Button onClick={retry}>Retry save</Button>}
    </div>
  );
}

export function Breadcrumb({ children }: { children: ReactNode }) {
  return (
    <nav aria-label="Breadcrumb" className={styles.breadcrumb}>
      {children}
    </nav>
  );
}

export function PageHeading({
  title,
  eyebrow,
  context,
  children,
}: {
  title: string;
  eyebrow?: ReactNode;
  context?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className={styles.heading}>
      <div className={styles.headingTitle}>
        {eyebrow}
        <h1>{title}</h1>
        {context}
      </div>
      {children && <div className={styles.headingActions}>{children}</div>}
    </div>
  );
}

const dateFormat = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeZone: "Europe/London",
});

export function formatDate(value: string): string {
  return value ? dateFormat.format(new Date(value + "T00:00:00Z")) : "";
}

export function dateRange(start: string, end: string): string {
  if (start && end) return formatDate(start) + " – " + formatDate(end);
  return formatDate(start || end) || "Dates not set";
}
