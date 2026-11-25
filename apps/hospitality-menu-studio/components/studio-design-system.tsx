"use client";

import Image from "next/image";
import { cloneElement, forwardRef, isValidElement, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
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

type StudioButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "tertiary" | "danger";
  busy?: boolean;
  disabledReason?: ReactNode;
};

export const StudioButton = forwardRef<HTMLButtonElement, StudioButtonProps>(function StudioButton({
  children,
  variant = "secondary",
  disabled,
  busy = false,
  disabledReason,
  className,
  ...buttonProps
}, ref) {
  const explanationId = useId();
  return (
    <span className={styles.action}>
      <button
        {...buttonProps}
        ref={ref}
        className={[styles.button, styles[`button_${variant}`], className].filter(Boolean).join(" ")}
        disabled={disabled || busy}
        aria-busy={busy || undefined}
        aria-describedby={[buttonProps["aria-describedby"], disabled && disabledReason ? explanationId : undefined].filter(Boolean).join(" ") || undefined}
      >
        {children}
      </button>
      {disabled && disabledReason && <span id={explanationId} className={styles.disabledReason} role="status">{disabledReason}</span>}
    </span>
  );
});

export function StudioStatus({ children, tone = "neutral" }: { children: ReactNode; tone?: StudioStatusTone }) {
  return <span className={styles.status} data-tone={tone}>{children}</span>;
}

export function StudioPanel({
  title,
  headingLevel = 2,
  description,
  actions,
  children,
  className,
}: {
  title?: ReactNode;
  headingLevel?: 2 | 3 | 4;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <section className={[styles.panel, className].filter(Boolean).join(" ")}>
      {(title || description || actions) && (
        <header className={styles.panelHeader}>
          <div>
            {title && <Heading>{title}</Heading>}
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
  children: ReactElement<{ id?: string; "aria-describedby"?: string; "aria-invalid"?: boolean; required?: boolean }>;
}) {
  const generatedId = useId();
  const controlId = htmlFor || generatedId;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const existingDescribedBy = children.props["aria-describedby"];
  const describedBy = [existingDescribedBy, hintId, errorId].filter(Boolean).join(" ") || undefined;
  const control = isValidElement(children) ? cloneElement(children, {
    id: controlId,
    "aria-describedby": describedBy,
    "aria-invalid": Boolean(error) || undefined,
  }) : children;
  return (
    <div className={styles.field}>
      <label htmlFor={controlId}>{label}</label>
      {control}
      {hint && <span id={hintId} className={styles.fieldHint}>{hint}</span>}
      {error && <span id={errorId} className={styles.fieldError}>{error}</span>}
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

export function StudioEditorLayout({ editor, preview, secondaryLabel = "Customer preview", secondaryKind = "preview" }: {
  editor: ReactNode;
  preview: ReactNode;
  secondaryLabel?: string;
  secondaryKind?: "preview" | "review-settings";
}) {
  const [shown, setShown] = useState<"editor" | "secondary">("editor");
  const secondaryId = useId();
  return (
    <div className={styles.editorLayout}>
      <div className={styles.mobilePaneChoice} role="group" aria-label="Menu workspace panels">
        <button type="button" aria-pressed={shown === "editor"} onClick={() => setShown("editor")}>Editor</button>
        <button type="button" aria-pressed={shown === "secondary"} onClick={() => setShown("secondary")}>{secondaryLabel}</button>
      </div>
      <section className={`${styles.editor} ${shown === "editor" ? styles.mobileShown : ""}`} aria-label="Menu editor">{editor}</section>
      <aside id={secondaryId} className={`${styles.preview} ${styles[`secondary_${secondaryKind}`]} ${shown === "secondary" ? styles.mobileShown : ""}`} aria-label={secondaryLabel}>{preview}</aside>
    </div>
  );
}

export function StudioPageHeader({ breadcrumbs = [], title, description, context, actions }: {
  breadcrumbs?: Array<{ label: string; href?: string }>;
  title: string;
  description?: ReactNode;
  context?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className={styles.pageHeader}>
      {breadcrumbs.length > 0 && <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
        {breadcrumbs.map((crumb, index) => <span key={`${crumb.label}-${index}`}>
          {index > 0 && <StudioIcon name="next" />}
          {crumb.href ? <a href={crumb.href}>{crumb.label}</a> : <span aria-current="page">{crumb.label}</span>}
        </span>)}
      </nav>}
      <div className={styles.pageHeading}>
        <div><h1>{title}</h1>{context && <div className={styles.pageContext}>{context}</div>}{description && <p>{description}</p>}</div>
        {actions && <div className={styles.pageActions}>{actions}</div>}
      </div>
    </header>
  );
}

export function StudioShell({
  actorName,
  active,
  onNavigate,
  navigationHrefs,
  productLinks = [],
  activeProductId,
  onSelectProduct,
  saveState,
  headerActions,
  contentWidth = "wide",
  children,
}: {
  actorName: string;
  active: StudioDestination;
  onNavigate: (destination: StudioDestination) => boolean | void;
  navigationHrefs: Record<StudioDestination, string>;
  productLinks?: Array<{ id: string; name: string; status?: string; summary?: string }>;
  activeProductId?: string;
  onSelectProduct?: (id: string) => boolean | void;
  saveState?: ReactNode;
  headerActions?: ReactNode;
  contentWidth?: "standard" | "wide";
  children: ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileToggleRef = useRef<HTMLButtonElement>(null);
  const closeNavigation = () => {
    setMobileNavOpen(false);
    if (window.matchMedia("(max-width: 1050px)").matches) requestAnimationFrame(() => mobileToggleRef.current?.focus());
  };
  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeNavigation();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileNavOpen]);
  const navigation: Array<{ id: StudioDestination; label: string; icon: keyof typeof iconPaths }> = [
    { id: "builder", label: "Menu Builder", icon: "menu" },
    { id: "library", label: "Dish Library", icon: "dishes" },
    { id: "catalogue", label: "Catalogue", icon: "catalogue" },
  ];
  return (
    <div className={styles.shell}>
      <a className={styles.skip} href="#studio-main">Skip to content</a>
      <header className={styles.header}>
        <div className={styles.brand}><Image src="/fika-logo.png" alt="FIKA OS" width={84} height={50} priority /></div>
        <span className={styles.divider} aria-hidden="true" />
        <span className={styles.product}>Menu Studio</span>
        <div className={styles.headerStatus}>{saveState}</div>
        {headerActions && <div className={styles.headerActions}>{headerActions}</div>}
        <span className={styles.actor}>{actorName}</span>
        <button ref={mobileToggleRef} className={styles.mobileToggle} type="button" aria-expanded={mobileNavOpen}
          aria-controls="studio-navigation" onClick={() => setMobileNavOpen((open) => !open)}>
          {mobileNavOpen ? <StudioIcon name="close" /> : <StudioIcon name="menu" />}
          <span className={styles.visuallyHidden}>{mobileNavOpen ? "Close navigation" : "Open navigation"}</span>
        </button>
      </header>
      <div className={styles.body}>
        <nav id="studio-navigation" className={`${styles.navigation} ${mobileNavOpen ? styles.navigationOpen : ""}`} aria-label="Studio navigation">
          <div className={styles.navigationPrimary}>
            {navigation.map((item) => (
              <a href={navigationHrefs[item.id]} key={item.id} aria-current={active === item.id ? "page" : undefined}
                onClick={(event) => { if (onNavigate(item.id) === false) event.preventDefault(); else closeNavigation(); }}>
                <StudioIcon name={item.icon} /><span>{item.label}</span>
              </a>
            ))}
          </div>
          {active === "builder" && (
            <details className={styles.productRail} open>
              <summary>Hospitality menus</summary>
              <div className={styles.productRailItems}>
              {productLinks.length ? productLinks.map((product) => (
                <a href={`/?product=${encodeURIComponent(product.id)}`} key={product.id} aria-current={activeProductId === product.id ? "page" : undefined}
                  onClick={(event) => { if (onSelectProduct?.(product.id) === false) event.preventDefault(); else closeNavigation(); }}>
                  <span className={styles.productLinkName}>{product.name}</span>
                  {product.status && <span className={styles.productLinkStatus}>{product.status}</span>}
                  {product.summary && <span className={styles.productLinkSummary}>{product.summary}</span>}
                </a>
              )) : <p>No menus configured yet.</p>}
              </div>
            </details>
          )}
        </nav>
        <main id="studio-main" className={`${styles.main} ${styles[`main_${contentWidth}`]}`} tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
