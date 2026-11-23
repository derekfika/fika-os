import { useEffect, useRef, useState } from "react";
import type { Dish, Menu, Section } from "../lib/contract";
import {
  Breadcrumb,
  Button,
  dateRange,
  Icon,
  PageHeading,
  Pill,
  SaveNotice,
  Temperature,
  title,
  type DraftStatus,
} from "./studio-ui";
import styles from "./studio.module.css";
import { copyRotationChoices, rotationSource } from "./rotation-copy";
import { RotationWorkspace } from "./rotation-workspace";

const weeks = [1, 2, 3, 4, 5, 6];
const groups = [
  ["meat", "Meat"],
  ["fish", "Fish"],
  ["veg", "Veggie / Vegan"],
  ["salad", "Salads"],
  ["dessert", "Desserts"],
  ["other", "Other"],
] as const;
type DishGroup = (typeof groups)[number][0];

function groupFor(dish?: Dish): DishGroup {
  if (!dish) return "other";
  return dish.category === "vegetarian" || dish.category === "vegan"
    ? "veg"
    : dish.category;
}

const planningTargets: Record<string, string> = {
  "breakfast pots": "6 choices",
  "salad & protein": "3 proteins + 3 salads",
  "hot fork buffet":
    "5 meat, 5 fish, 5 veggie / vegan, 12 salads and 12 desserts",
  "bowl food": "5 meat, 5 fish and 5 veggie / vegan choices",
  "finger food": "5 meat, 5 fish and 5 veggie / vegan choices",
  canapes: "5 meat, 5 fish and 5 veggie / vegan choices",
};

export function MenuOverview({
  menu,
  save,
  canManage,
  back,
  preview,
  review,
  history,
  activation,
  openSection,
  addSection,
  update,
}: {
  menu: Menu;
  save: DraftStatus;
  canManage: boolean;
  back: () => void;
  preview: () => void;
  review: () => void;
  history: () => void;
  activation?: () => void;
  openSection: (id: string) => void;
  addSection: () => void;
  update: (
    values: Partial<
      Pick<Menu, "name" | "startDate" | "endDate" | "anchorMonday">
    >,
  ) => void;
}) {
  return (
    <>
      <PageHeading
        title={menu.name || "New menu"}
        eyebrow={
          <Breadcrumb>
            <button onClick={back}>
              {menu.kind === "seasonal" ? "Menus" : "Collections"}
            </button>
            <span>/</span>
            <span>{menu.name || "New draft"}</span>
          </Breadcrumb>
        }
        context={
          <div className={styles.metadata}>
            <Pill tone="info">Draft</Pill>
            <span>
              {menu.kind === "seasonal"
                ? "Seasonal menu"
                : "Special collection"}{" "}
              · {dateRange(menu.startDate, menu.endDate)}
            </span>
          </div>
        }
      >
        <Button onClick={preview}>
          <Icon name="eye" /> Customer preview
        </Button>
        <Button primary onClick={review}>
          Review &amp; publish
        </Button>
      </PageHeading>
      <div className={styles.sectionHeading}>
        <h2>Menu sections</h2>
        <Button onClick={addSection} disabled={!canManage}>
          <Icon name="plus" /> Add section
        </Button>
      </div>
      <div className={styles.panel}>
        {menu.sections.map((section) => {
          const rotating = section.mode === "rotation";
          const count = rotating
            ? section.weeks[0]?.length || 0
            : section.staticDishIds.length;
          return (
            <button
              type="button"
              className={styles.sectionRow}
              key={section.id}
              onClick={() => openSection(section.id)}
            >
              <strong>{section.name || "Untitled section"}</strong>
              <span>{rotating ? "Six-week rotation" : "All season"}</span>
              <span>
                {count} {count === 1 ? "choice" : "choices"}
                {rotating ? " (W1)" : ""}
              </span>
              <span className={styles.mapping}>
                {section.catalogueItemId
                  ? "Mapped to Hub"
                  : "Catalogue mapping needed"}
              </span>
              <Icon name="forward" />
            </button>
          );
        })}
        {!menu.sections.length && (
          <p className={styles.empty}>
            No sections yet. Add a section to start building the menu.
          </p>
        )}
      </div>
      <details className={styles.disclosure}>
        <summary>Menu details</summary>
        <div className={styles.formGrid}>
          <label className="fika-field">
            Name
            <input
              className="fika-input"
              value={menu.name}
              disabled={!canManage}
              onChange={(event) => update({ name: event.target.value })}
            />
          </label>
          <label className="fika-field">
            Start date
            <input
              type="date"
              className="fika-input"
              value={menu.startDate}
              disabled={!canManage}
              onChange={(event) => update({ startDate: event.target.value })}
            />
          </label>
          <label className="fika-field">
            End date
            <input
              type="date"
              className="fika-input"
              value={menu.endDate}
              disabled={!canManage}
              onChange={(event) => update({ endDate: event.target.value })}
            />
          </label>
          <label className="fika-field">
            Rotation anchor Monday
            <input
              type="date"
              className="fika-input"
              value={menu.anchorMonday}
              disabled={!canManage}
              onChange={(event) => update({ anchorMonday: event.target.value })}
            />
          </label>
        </div>
      </details>
      <div className={styles.footerActions}>
        <SaveNotice {...save} />
        <Button onClick={history}>Versions and history</Button>
        {activation && (
          <Button onClick={activation}>Collection activation</Button>
        )}
      </div>
    </>
  );
}

export function SectionEditor({
  menu,
  section,
  dishes,
  selected,
  week,
  setWeek,
  save,
  canManage,
  update,
  updateSelected,
  remove,
  back,
  preview,
  editDish,
  browseDishes,
  createDish,
  active,
  focusName,
  loadMore,
  catalogue,
  loadCatalogue,
  catalogueNotice,
  openSettings,
  busy,
}: {
  menu: Menu;
  section: Section;
  dishes: Dish[];
  selected: string[];
  week: number;
  setWeek: (week: number) => void;
  save: DraftStatus;
  canManage: boolean;
  update: (change: Partial<Section>) => void;
  updateSelected: (ids: string[]) => void;
  remove: () => void;
  back: () => void;
  preview: () => void;
  editDish: (dish: Dish) => void;
  browseDishes: () => void;
  createDish: () => void;
  active: boolean;
  focusName: boolean;
  loadMore?: () => void;
  catalogue: { id: string; name: string }[];
  loadCatalogue: () => void;
  catalogueNotice: string;
  openSettings?: boolean;
  busy: boolean;
}) {
  const [group, setGroup] = useState<DishGroup | "all">("all");
  const [temperature, setTemperature] = useState<Dish["temperature"] | "all">(
    "all",
  );
  const [search, setSearch] = useState("");
  const [copyWeek, setCopyWeek] = useState(1);
  const [copyConfirmation, setCopyConfirmation] = useState<{
    sectionId: string;
    week: number;
    choices: string;
  } | null>(null);
  const confirmCopy =
    copyConfirmation?.sectionId === section.id &&
    copyConfirmation.week === week &&
    copyConfirmation.choices === JSON.stringify(selected);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [view, setView] = useState<"overview" | "week">("overview");
  const [adding, setAdding] = useState(false);
  const [showName] = useState(focusName);
  const sectionName = useRef<HTMLInputElement>(null);
  const focusedName = useRef(false);
  const dishSearch = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (active && showName && sectionName.current && !focusedName.current) {
      sectionName.current.focus();
      sectionName.current.select();
      focusedName.current = true;
    }
  }, [active, showName]);
  useEffect(() => {
    if (active && adding) dishSearch.current?.focus();
  }, [active, adding]);

  const byId = new Map(dishes.map((dish) => [dish.id, dish]));
  const grouped = groups.map(([id, name]) => ({
    id,
    name,
    ids: selected.filter((dishId) => groupFor(byId.get(dishId)) === id),
  }));
  const matches = (id: string) => {
    const dish = byId.get(id);
    return (
      (group === "all" || groupFor(dish) === group) &&
      (temperature === "all" || dish?.temperature === temperature)
    );
  };
  const visibleGroups = [{ id: "ordered", name: "Dishes in order", ids: selected.filter(matches) }]
    .filter((entry) => entry.ids.length > 0);
  const eligible = dishes.filter(
    (dish) =>
      !selected.includes(dish.id) &&
      matches(dish.id) &&
      dish.name
        .toLocaleLowerCase("en-GB")
        .includes(search.trim().toLocaleLowerCase("en-GB")),
  );
  const target =
    planningTargets[
      section.name
        .trim()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .toLocaleLowerCase("en-GB")
    ];
  const isRotation = section.mode === "rotation";
  const sourceWeek = rotationSource(copyWeek, week);
  function chooseWeek(value: number) {
    setCopyConfirmation(null);
    setWeek(value);
    setView("week");
  }
  function copyFrom(source: number) {
    if (!canManage) return;
    const choices = copyRotationChoices(
      section.weeks,
      source,
      week,
      confirmCopy,
    );
    if (!choices) return;
    updateSelected(choices);
    setCopyConfirmation(null);
  }
  function shift(id: string, neighbour: string) {
    updateSelected(
      selected.map((item) =>
        item === id ? neighbour : item === neighbour ? id : item,
      ),
    );
  }

  return (
    <>
      <PageHeading
        title={section.name || "New section"}
        eyebrow={
          <Breadcrumb>
            <span>{menu.kind === "seasonal" ? "Menus" : "Collections"}</span>
            <span>/</span>
            <button onClick={back}>{menu.name || "Untitled draft"}</button>
            <span>/</span>
            <span>{section.name || "New section"}</span>
          </Breadcrumb>
        }
      >
        <SaveNotice {...save} />
        <Button onClick={preview}>
          <Icon name="eye" /> Customer preview
        </Button>
      </PageHeading>
      {showName && (
        <label className="fika-field">
          Section name
          <input
            ref={sectionName}
            className="fika-input"
            value={section.name}
            disabled={!canManage}
            onChange={(event) => update({ name: event.target.value })}
          />
        </label>
      )}
      <div className={styles.sectionControls}>
        {isRotation && (
          <div className={styles.fieldGroup}>
            <span id="rotation-week">Rotation week</span>
            <div
              className={styles.segmented}
              role="group"
              aria-labelledby="rotation-week"
            >
              {weeks.map((number) => (
                <button
                  type="button"
                  key={number}
                  aria-label={"Week " + number}
                  aria-pressed={week + 1 === number && view === "week"}
                  onClick={() => chooseWeek(number - 1)}
                >
                  W{number}
                </button>
              ))}
            </div>
          </div>
        )}
        <details className={styles.disclosure} open={openSettings || undefined}>
          <summary>Section settings</summary>
          <div className={styles.fieldGroup}>
            <span id="menu-availability">Menu availability</span>
            <div
              className={styles.segmented}
              aria-labelledby="menu-availability"
              role="group"
            >
              <button
                type="button"
                disabled={!canManage}
                aria-pressed={!isRotation}
                onClick={() => update({ mode: "static" })}
              >
                All season
              </button>
              <button
                type="button"
                disabled={!canManage}
                aria-pressed={isRotation}
                onClick={() => update({ mode: "rotation" })}
              >
                Six-week rotation
              </button>
            </div>
          </div>
          {!showName && (
            <label className="fika-field">
              Section name
              <input
                className="fika-input"
                value={section.name}
                disabled={!canManage}
                onChange={(event) => update({ name: event.target.value })}
              />
            </label>
          )}
          <label className="fika-field">
            Hub catalogue item
            <select
              className="fika-select"
              value={section.catalogueItemId}
              disabled={!canManage || !catalogue.length}
              onChange={(event) =>
                update({ catalogueItemId: event.target.value })
              }
            >
              <option value="">Not mapped</option>
              {section.catalogueItemId &&
                !catalogue.some(
                  (item) => item.id === section.catalogueItemId,
                ) && (
                  <option value={section.catalogueItemId}>
                    Existing mapping: {section.catalogueItemId}
                  </option>
                )}
              {catalogue.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>
          <div className={styles.actions}>
            <Button disabled={busy} onClick={loadCatalogue}>
              Load Hub catalogue
            </Button>
          </div>
          {catalogueNotice && <p role="status">{catalogueNotice}</p>}
          {canManage && (
            <div className={styles.actions}>
              <label className="fika-choice">
                <input
                  type="checkbox"
                  checked={confirmRemove}
                  onChange={(event) => setConfirmRemove(event.target.checked)}
                />{" "}
                Remove this section and its draft selections
              </label>
              <Button disabled={!confirmRemove} onClick={remove}>
                Remove section
              </Button>
            </div>
          )}
        </details>
      </div>
      {isRotation && (
        <div className={styles.tabBar} role="group" aria-label="Rotation view">
          <button
            type="button"
            aria-pressed={view === "overview"}
            onClick={() => setView("overview")}
          >
            Rotation overview
          </button>
          <button
            type="button"
            aria-pressed={view === "week"}
            onClick={() => setView("week")}
          >
            Edit week
          </button>
        </div>
      )}
      {isRotation && view === "overview" ? (
        <RotationWorkspace section={section} dishes={dishes} week={week} canManage={canManage} update={update} chooseWeek={chooseWeek} loadMore={loadMore} busy={busy} createDish={createDish} />
      ) : (
        <>
          <details className={styles.sectionTools}>
            <summary>
              Filter dishes
              {group !== "all" || temperature !== "all"
                ? " (filters active)"
                : ""}
            </summary>
            <div className={styles.filterBar}>
              <div
                className={styles.chips}
                role="group"
                aria-label="Filter by category"
              >
                <button
                  type="button"
                  aria-pressed={group === "all"}
                  onClick={() => setGroup("all")}
                >
                  All ({selected.length})
                </button>
                {grouped.map(({ id, name, ids }) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={group === id}
                    onClick={() => setGroup(id)}
                  >
                    {name} ({ids.length})
                  </button>
                ))}
              </div>
              <div
                className={styles.chips}
                role="group"
                aria-label="Filter by temperature"
              >
                {(["all", "hot", "cold"] as const).map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={temperature === value}
                    onClick={() => setTemperature(value)}
                  >
                    {value === "all" ? "Any temp." : title(value)}
                  </button>
                ))}
              </div>
            </div>
          </details>
          <div className={styles.sectionHeading}>
            <div>
              <h2>
                {isRotation ? "Week " + (week + 1) : "All season"} ·{" "}
                {selected.length} choices
              </h2>
              {target && (
                <p className="fika-help">
                  Planning target: {target}
                  {isRotation ? " per week" : ""}
                </p>
              )}
            </div>
            <Button disabled={!canManage} onClick={() => setAdding(!adding)}>
              <Icon name="plus" /> {adding ? "Close dish picker" : "Add dish"}
            </Button>
          </div>
          {isRotation && canManage && (
            <details className={styles.sectionTools}>
              <summary>Copy choices to week {week + 1}</summary>
              <div className={styles.copyControls}>
                <label className="fika-field">
                  Copy from week
                  <select
                    className="fika-select"
                    value={sourceWeek}
                    onChange={(event) => {
                      setCopyWeek(Number(event.target.value));
                      setCopyConfirmation(null);
                    }}
                  >
                    {weeks
                      .filter((number) => number - 1 !== week)
                      .map((number) => (
                        <option value={number - 1} key={number}>
                          Week {number}
                        </option>
                      ))}
                  </select>
                </label>
                <Button
                  disabled={selected.length > 0 && !confirmCopy}
                  onClick={() => copyFrom(sourceWeek)}
                >
                  Copy week {sourceWeek + 1} into week {week + 1}
                </Button>
                {week > 0 && (
                  <Button
                    disabled={selected.length > 0 && !confirmCopy}
                    onClick={() => copyFrom(week - 1)}
                  >
                    Copy previous: week {week} into week {week + 1}
                  </Button>
                )}
                {selected.length > 0 && (
                  <label className="fika-choice">
                    <input
                      type="checkbox"
                      checked={confirmCopy}
                      onChange={(event) =>
                        setCopyConfirmation(
                          event.target.checked
                            ? {
                                sectionId: section.id,
                                week,
                                choices: JSON.stringify(selected),
                              }
                            : null,
                        )
                      }
                    />{" "}
                    Replace week {week + 1} choices
                  </label>
                )}
              </div>
            </details>
          )}
          {visibleGroups.length > 0 && (
            <p
              id="section-table-scroll-help"
              className={styles.sectionScrollHelp}
            >
              Scroll sideways to see dish actions. You can also focus the table
              and use the arrow keys.
            </p>
          )}
          {visibleGroups.length > 0 && (
            <div
              className={styles.tableScroll}
              tabIndex={0}
              role="region"
              aria-label="Selected section dishes"
              aria-describedby="section-table-scroll-help"
            >
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th scope="col">Dish</th>
                    <th scope="col">Type</th>
                    <th scope="col">Hot / cold</th>
                    <th scope="col">Allergens</th>
                    <th scope="col">Actions</th>
                  </tr>
                </thead>
                {visibleGroups.map((entry) => (
                  <tbody key={entry.id}>
                    <tr>
                      <th
                        className={styles.groupHeading}
                        scope="rowgroup"
                        colSpan={5}
                      >
                        {entry.name} · {entry.ids.length}{" "}
                        {entry.ids.length === 1 ? "choice" : "choices"}
                      </th>
                    </tr>
                    {entry.ids.map((id) => {
                      const item = byId.get(id);
                      const name = item?.name || "Dish unavailable";
                      return (
                        <tr key={id}>
                          <th scope="row">
                            {item ? (
                              <button
                                type="button"
                                className={styles.textAction}
                                onClick={() => editDish(item)}
                              >
                                {name}
                              </button>
                            ) : (
                              name
                            )}
                          </th>
                          <td>{item ? title(item.category) : "Unavailable"}</td>
                          <td>
                            <Temperature value={item?.temperature || null} />
                          </td>
                          <td>
                            <Pill>Unavailable</Pill>
                          </td>
                          <td>
                            <div className={styles.tableActions}>
                              <Button
                                disabled={!canManage || selected.indexOf(id) === 0}
                                label={"Move " + name + " up"}
                                onClick={() => shift(id, selected[selected.indexOf(id) - 1]!)}
                              >
                                ↑
                              </Button>
                              <Button
                                disabled={
                                  !canManage || selected.indexOf(id) === selected.length - 1
                                }
                                label={"Move " + name + " down"}
                                onClick={() => shift(id, selected[selected.indexOf(id) + 1]!)}
                              >
                                ↓
                              </Button>
                              <Button
                                disabled={!canManage}
                                label={"Remove " + name + " from section"}
                                onClick={() =>
                                  updateSelected(
                                    selected.filter((value) => value !== id),
                                  )
                                }
                              >
                                Remove
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                ))}
              </table>
            </div>
          )}
          {!selected.some(matches) && (
            <p className={styles.empty}>
              {selected.length
                ? "No selected dishes match these filters."
                : "No dishes in this section yet."}
            </p>
          )}
          {adding && (
            <section className={styles.panel} aria-label="Add dishes">
              <div className={styles.panelBody}>
                <label className="fika-field">
                  Find a dish
                  <input
                    className="fika-input"
                    type="search"
                    ref={dishSearch}
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                {eligible.map((item) => (
                  <div className={styles.row} key={item.id}>
                    <span>
                      {item.name} <small>{title(item.category)}</small>
                    </span>
                    <Button
                      label={"Add " + item.name + " to section"}
                      onClick={() => updateSelected([...selected, item.id])}
                    >
                      Add dish
                    </Button>
                  </div>
                ))}
                {!eligible.length && (
                  <div>
                    <p role="status">
                      No available dishes match these filters.
                    </p>
                    <div className={styles.actions}>
                      {(search || group !== "all" || temperature !== "all") && (
                        <Button
                          onClick={() => {
                            setSearch("");
                            setGroup("all");
                            setTemperature("all");
                            dishSearch.current?.focus();
                          }}
                        >
                          Clear search and filters
                        </Button>
                      )}
                      <Button onClick={browseDishes}>
                        Browse dish collection
                      </Button>
                      <Button onClick={createDish} disabled={!canManage}>
                        Create dish
                      </Button>
                    </div>
                  </div>
                )}
                {loadMore && (
                  <Button disabled={busy} onClick={loadMore}>
                    Load more dishes
                  </Button>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </>
  );
}
