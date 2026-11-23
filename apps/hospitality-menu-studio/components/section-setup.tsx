import { useEffect, useId, useRef, useState } from "react";
import type { Menu, Section } from "../lib/contract";
import {
  catalogueOptionLabel,
  catalogueSuggestion,
  sectionTemplates,
  type CatalogueChoices,
  type NewSectionDetails,
} from "./menu-setup-model";
import { Button, Icon, Pill } from "./studio-ui";
import styles from "./studio.module.css";
import setup from "./menu-setup.module.css";

function SectionMode({
  mode,
  disabled,
  onChange,
}: {
  mode: Section["mode"];
  disabled?: boolean;
  onChange: (mode: Section["mode"]) => void;
}) {
  const id = useId();
  return (
    <div className={styles.fieldGroup}>
      <span id={id}>Dish schedule</span>
      <div className={styles.segmented} role="group" aria-labelledby={id}>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={mode === "static"}
          onClick={() => onChange("static")}
        >
          All season
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={mode === "rotation"}
          onClick={() => onChange("rotation")}
        >
          Six-week rotation
        </button>
      </div>
    </div>
  );
}

export function NewSectionForm({
  close,
  create,
}: {
  close: () => void;
  create: (details: NewSectionDetails) => void;
}) {
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [mode, setMode] = useState<Section["mode"]>("static");
  useEffect(() => {
    nameInput.current?.focus();
  }, []);

  return (
    <form
      className={setup.sectionForm}
      aria-label="New section"
      onSubmit={(event) => {
        event.preventDefault();
        if (name.trim()) create({ name: name.trim(), mode });
      }}
    >
      <div className={styles.formGrid}>
        <label className="fika-field">
          Section name
          <input
            ref={nameInput}
            required
            maxLength={200}
            className="fika-input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <label className="fika-field">
          Use a common section name
          <select
            className="fika-select"
            value={sectionTemplates.find((item) => item === name) ?? ""}
            onChange={(event) => {
              if (event.target.value) setName(event.target.value);
            }}
          >
            <option value="">Choose a name (optional)</option>
            {sectionTemplates.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
      </div>
      <SectionMode mode={mode} onChange={setMode} />
      <div className={styles.footerActions}>
        <Button onClick={close}>Cancel</Button>
        <Button type="submit" primary disabled={!name.trim()}>
          <Icon name="plus" /> Create section
        </Button>
      </div>
    </form>
  );
}

export function SectionSetup({
  menu,
  section,
  canManage,
  update,
  openSection,
  catalogue,
  loadCatalogue,
  openMapping,
  active,
  focusName,
  inspectItem,
}: {
  menu: Menu;
  section: Section;
  canManage: boolean;
  update: (change: Partial<Section>) => void;
  openSection: (id: string) => void;
  catalogue: CatalogueChoices;
  loadCatalogue: () => void;
  openMapping?: boolean;
  active: boolean;
  focusName: boolean;
  inspectItem: (id: string) => void;
}) {
  const nameInput = useRef<HTMLInputElement>(null);
  const focusedName = useRef(false);
  const mapping = useRef<HTMLDetailsElement>(null);
  const items = catalogue.state === "loaded" ? catalogue.items : [];
  const mappedItem = items.find((item) => item.id === section.catalogueItemId);
  const usedIds = new Set(
    menu.sections
      .filter((item) => item.id !== section.id)
      .map((item) => item.catalogueItemId),
  );
  const suggestion = catalogueSuggestion(section, catalogue, usedIds);
  const mappedLabel =
    mappedItem?.name ||
    (section.catalogueItemId ? "Saved mapping" : "No mapping");
  const options = items.filter(
    (item) => item.id === section.catalogueItemId || !usedIds.has(item.id),
  );
  const labelCounts = new Map<string, number>();
  for (const item of items) {
    const label = catalogueOptionLabel(item);
    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1);
  }
  const indistinguishable = (label: string) =>
    (labelCounts.get(label) ?? 0) > 1;

  useEffect(() => {
    if (active && focusName && !focusedName.current && nameInput.current) {
      nameInput.current.focus();
      focusedName.current = true;
    }
  }, [active, focusName]);

  useEffect(() => {
    if (active && openMapping && mapping.current) {
      mapping.current.open = true;
      mapping.current.querySelector("summary")?.focus();
    }
  }, [active, openMapping]);

  return (
    <section aria-label="Section details" className={setup.sectionSetup}>
      <div className={styles.formGrid}>
        <label className="fika-field">
          Section name
          <input
            ref={nameInput}
            className="fika-input"
            value={section.name}
            disabled={!canManage}
            maxLength={200}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
        {menu.sections.length > 1 && (
          <label className="fika-field">
            Switch section
            <select
              className="fika-select"
              value={section.id}
              onChange={(event) => openSection(event.target.value)}
            >
              {menu.sections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name || "Untitled section"}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      <SectionMode
        mode={section.mode}
        disabled={!canManage}
        onChange={(mode) => {
          if (mode !== section.mode) update({ mode });
        }}
      />
      <details ref={mapping} className={styles.disclosure}>
        <summary>
          Catalogue mapping <Pill>{mappedLabel}</Pill>
        </summary>
        <p className="fika-help">
          Link the section to an existing Hospitality item. Check a site and
          event date in Customer preview to see availability.
        </p>
        {catalogue.state === "unavailable" && (
          <p role="status" className="fika-notice fika-notice--warning">
            The catalogue is unavailable. Item names and booking availability
            are unknown. Any saved mapping is retained.
          </p>
        )}
        {catalogue.state === "loaded" && (
          <>
            {section.catalogueItemId && !mappedItem && (
              <p role="status">
                The saved item is missing from the current catalogue.
              </p>
            )}
            {suggestion.status === "suggested" && (
              <div className={styles.actions}>
                <p>Suggested item {suggestion.item.name}</p>
                <Button
                  onClick={() =>
                    update({ catalogueItemId: suggestion.item.id })
                  }
                  disabled={!canManage}
                >
                  Use {suggestion.item.name}
                </Button>
              </div>
            )}
            {suggestion.status === "ambiguous" && (
              <p>
                Several items match this section name. Choose the correct item
                below.
              </p>
            )}
            {suggestion.status === "already-used" && (
              <p>
                The matching item is mapped to another section in this menu.
              </p>
            )}
            {options.some((item) =>
              indistinguishable(catalogueOptionLabel(item)),
            ) && (
              <p>
                Some items have identical labels. Ask the Hospitality catalogue
                owner to distinguish them before mapping.
              </p>
            )}
            {options.length > 0 || section.catalogueItemId ? (
              <label className="fika-field">
                Hospitality catalogue item
                <select
                  className="fika-select"
                  value={section.catalogueItemId}
                  disabled={!canManage}
                  onChange={(event) =>
                    update({ catalogueItemId: event.target.value })
                  }
                >
                  <option value="">No mapping</option>
                  {section.catalogueItemId && !mappedItem && (
                    <option value={section.catalogueItemId}>
                      Saved mapping (name unavailable)
                    </option>
                  )}
                  {options.map((item) => {
                    const label = catalogueOptionLabel(item);
                    return (
                      <option
                        key={item.id}
                        value={item.id}
                        disabled={
                          item.id !== section.catalogueItemId &&
                          indistinguishable(label)
                        }
                      >
                        {label}
                      </option>
                    );
                  })}
                </select>
              </label>
            ) : (
              <p>No catalogue items are available to map.</p>
            )}
          </>
        )}
        <div className={styles.actions}>
          {section.catalogueItemId && <Button onClick={() => inspectItem(section.catalogueItemId)}>View mapped product</Button>}
          <Button
            onClick={loadCatalogue}
            disabled={catalogue.state === "loading"}
          >
            {catalogue.state === "loading"
              ? "Checking catalogue…"
              : catalogue.state === "loaded"
                ? "Refresh catalogue"
                : "Check catalogue"}
          </Button>
        </div>
      </details>
    </section>
  );
}
