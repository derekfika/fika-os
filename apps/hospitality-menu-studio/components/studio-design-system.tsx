"use client";

import { useState, type ReactNode } from "react";
import styles from "./studio-design-system.module.css";

export type StudioDestination = "builder" | "library" | "catalogue";
export type StudioStatusTone = "neutral" | "info" | "success" | "warning" | "danger";

const iconPaths = {
  menu: "M3 6h18M3 12h18M3 18h18",
  dishes: "M4 3v5a3 3 0 0 0 6 0V3M7 3v18m10 0v-8h3V3c-3 1-5 4-5 8v2h2",
  catalogue: "M4 4h16v16H4zM8 8h8m-8 4h8m-8 4h5",
  search: "M15 15l5 5m-4-9a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  close: "m6 6 12 12M18 6 6 18",
  next: "m9 5 7 7-7 7",
  add: "M12 5v14M5 12h14",
  check: "m5 12 4 4L19 6",
  warning: "M12 3 2 21h20L12 3Zm0 6v5m0 3h.01",
  preview: "M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6Zm13 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
} as const;

export function StudioIcon({ name }: { name: keyof typeof iconPaths }) {
  return (
    <svg aria-hidden="true" className={styles.icon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={iconPaths[name]} />
    </svg>
  );
}

export function StudioButton({
  children,
  variant = "secondary",
  type = "button",
  disabled,
  onClick,
  className,
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "tertiary" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <button
      className={[styles.button, styles[`button_${variant}`], className].filter(Boolean).join(" ")}
      type={type}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function StudioStatus({ children, tone = "neutral" }: { children: ReactNode; tone?: StudioStatusTone }) {
  return <span className={styles.status} data-tone={tone}>{children}</span>;
}

export function StudioPanel({
  title,
  description,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={[styles.panel, className].filter(Boolean).join(" ")}>
      {(title || description || actions) && (
        <header className={styles.panelHeader}>
          <div>
            <h2>{title}</h2>
            {description && <p>{description}</p>}
          </div>
          {actions && <div className={styles.panelActions}>{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function StudioField({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: ReactNode;
  htmlFor?: string;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && !error && <span className={styles.fieldHint}>{hint}</span>}
      {error && <span className={styles.fieldError}>{error}</span>}
    </div>
  );
}

export function StudioSegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div className={styles.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={option.value} type="button" aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function StudioEditorLayout({ editor, preview }: { editor: ReactNode; preview: ReactNode }) {
  return <div className={styles.editorLayout}><section className={styles.editor}>{editor}</section><aside className={styles.preview}>{preview}</aside></div>;
}

export function StudioShell({
  actorName,
  active,
  onNavigate,
  productLinks = [],
  activeProductId,
  onSelectProduct,
  saveState,
  headerActions,
  children,
}: {
  actorName: string;
  active: StudioDestination;
  onNavigate: (destination: StudioDestination) => void;
  productLinks?: Array<{ id: string; name: string; status?: string; summary?: string }>;
  activeProductId?: string;
  onSelectProduct?: (id: string) => void;
  saveState?: ReactNode;
  headerActions?: ReactNode;
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const navigation: Array<{ id: StudioDestination; label: string; icon: keyof typeof iconPaths }> = [
    { id: "builder", label: "Menu Builder", icon: "menu" },
    { id: "library", label: "Dish Library", icon: "dishes" },
    { id: "catalogue", label: "Catalogue", icon: "catalogue" },
  ];
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#studio-main">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.brand}><span className={styles.brandName}>Fika</span><span className={styles.brandOs}>OS</span></div>
        <span className={styles.divider} aria-hidden="true" />
        <span className={styles.product}>Menu Studio</span>
        <div className={styles.headerStatus}>{saveState}</div>
        {headerActions && <div className={styles.headerActions}>{headerActions}</div>}
        <span className={styles.actor}>{actorName}</span>
        <button className={styles.mobileToggle} type="button" aria-expanded={mobileNavOpen}
          aria-controls="studio-navigation" onClick={() => setMobileNavOpen((open) => !open)}>
          {mobileNavOpen ? <StudioIcon name="close" /> : <StudioIcon name="menu" />}
          <span className={styles.visuallyHidden}>{mobileNavOpen ? "Close navigation" : "Open navigation"}</span>
        </button>
      </header>
      <div className={styles.body}>
        <nav id="studio-navigation" className={`${styles.navigation} ${mobileNavOpen ? styles.navigationOpen : ""}`} aria-label="Studio navigation">
          <div className={styles.navigationPrimary}>
            {navigation.map((item) => (
              <button type="button" key={item.id} aria-current={active === item.id ? "page" : undefined}
                onClick={() => { onNavigate(item.id); setMobileNavOpen(false); }}>
                <StudioIcon name={item.icon} /><span>{item.label}</span>
              </button>
            ))}
          </div>
          {active === "builder" && (
            <div className={styles.productRail}>
              <h2>Hospitality menus</h2>
              {productLinks.length ? productLinks.map((product) => (
                <button type="button" key={product.id} aria-current={activeProductId === product.id ? "page" : undefined}
                  onClick={() => { onSelectProduct?.(product.id); setMobileNavOpen(false); }}>
                  <span className={styles.productLinkName}>{product.name}</span>
                  {product.summary && <span className={styles.productLinkSummary}>{product.summary}</span>}
                </button>
              )) : <p>No menus configured yet.</p>}
            </div>
          )}
        </nav>
        <main id="studio-main" className={styles.main} tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
