import { useId, useMemo, useRef, useState, type Ref } from "react";
import { categories, type Dish, type Menu } from "../lib/contract";
import { assortmentIsComplete, type kitchenQuantities } from "../lib/review";
import { assortmentTotal } from "./studio-model";
import { assortmentProgress } from "./studio-review-model";
import {
  Breadcrumb,
  Button,
  Icon,
  PageHeading,
  SaveNotice,
  Temperature,
  title,
  type DraftStatus,
} from "./studio-ui";
import styles from "./studio.module.css";
import { DishSafety } from "./studio-dish-safety";
import {
  dishUsage,
  emptyDishFilters,
  filterDishes,
  sectionDishIds,
  type DishFilters,
} from "./studio-dish-collection-model";
import dishStyles from "./studio-dishes.module.css";

export function DishCollection({
  dishes,
  menus,
  canManage,
  create,
  edit,
  backToSection,
  loadMore,
  busy,
  error,
}: {
  dishes: Dish[];
  menus: Menu[];
  canManage: boolean;
  create: () => void;
  edit: (dish: Dish) => void;
  backToSection?: () => void;
  loadMore?: () => void;
  busy: boolean;
  error: string;
}) {
  const [filters, setFilters] = useState(emptyDishFilters);
  const [menuId, setMenuId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const resultId = useId();
  const search = useRef<HTMLInputElement>(null);
  const { byMenu, menuCounts } = useMemo(() => dishUsage(menus), [menus]);
  const menu = menus.find((item) => item.id === menuId);
  const section = menu?.sections.find((item) => item.id === sectionId);
  const filtered = useMemo(() => {
    const assignmentIds = sectionId
      ? new Set(section ? sectionDishIds(section) : [])
      : menuId ? (byMenu.get(menuId) ?? new Set<string>()) : undefined;
    return filterDishes(dishes, filters, assignmentIds);
  }, [dishes, filters, section, sectionId, menuId, byMenu]);
  const filtering = Boolean(
    filters.search.trim() || filters.category !== "all" ||
    filters.temperature !== "all" || menuId,
  );

  function clearFilters() {
    setFilters(emptyDishFilters);
    setMenuId("");
    setSectionId("");
    search.current?.focus();
  }
  return (
    <>
      <PageHeading
        title="Dish collection"
        eyebrow={
          backToSection && (
            <Breadcrumb>
              <button type="button" onClick={backToSection}>
                Section editor
              </button>
              <span>/</span>
              <span>Dish collection</span>
            </Breadcrumb>
          )
        }
      >
        <Button primary onClick={create} disabled={!canManage}>
          <Icon name="plus" /> Create dish
        </Button>
      </PageHeading>
      <div className={dishStyles.libraryFilters}>
        <label className={"fika-field " + styles.searchField}>
          Search dishes
          <span>
            <Icon name="search" />
            <input
              type="search"
              className="fika-input"
              ref={search}
              value={filters.search}
              onChange={(event) => setFilters({ ...filters, search: event.target.value })}
            />
          </span>
        </label>
        <label className="fika-field">
          Category
          <select
            className="fika-select"
            value={filters.category}
            onChange={(event) => setFilters({
              ...filters, category: event.target.value as DishFilters["category"],
            })}
          >
            <option value="all">All categories</option>
            <option value="veg">Veggie / Vegan</option>
            {categories.map((value) => (
              <option key={value} value={value}>
                {title(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="fika-field">
          Hot / cold
          <select
            className="fika-select"
            value={filters.temperature ?? ""}
            onChange={(event) => setFilters({
              ...filters, temperature: (event.target.value || null) as DishFilters["temperature"],
            })}
          >
            <option value="all">All temperatures</option>
            <option value="hot">Hot</option>
            <option value="cold">Cold</option>
            <option value="">Not set</option>
          </select>
        </label>
        {menus.length > 0 && (
          <label className="fika-field">
            Menu assignment
            <select
              className="fika-select"
              value={menuId}
              onChange={(event) => {
                setMenuId(event.target.value);
                setSectionId("");
              }}
            >
              <option value="">Any menu or unassigned</option>
              {menus.map((item) => (
                <option key={item.id} value={item.id}>{item.name || "Untitled menu"}</option>
              ))}
            </select>
          </label>
        )}
        {menu && menu.sections.length > 0 && (
          <label className="fika-field">
            Section assignment
            <select
              className="fika-select"
              value={sectionId}
              onChange={(event) => setSectionId(event.target.value)}
            >
              <option value="">All sections</option>
              {menu.sections.map((item) => (
                <option key={item.id} value={item.id}>{item.name || "Untitled section"}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      <div className={dishStyles.resultBar}>
        <p role="status">
          {filtering
            ? `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}${loadMore ? ` in ${dishes.length} loaded dishes` : ""}`
            : `${dishes.length} ${dishes.length === 1 ? "dish" : "dishes"}${loadMore ? " loaded" : ""}`}
        </p>
        {filtering && <Button onClick={clearFilters}>Clear filters</Button>}
      </div>
      {filtered.length > 0 ? (
        <ul className={dishStyles.dishList} aria-label="Dish results">
          {filtered.map((dish) => {
            const count = menuCounts.get(dish.id) ?? 0;
            const itemId = `${resultId}-${dish.id}`;
            return (
              <li key={dish.id}>
                <button
                  className={dishStyles.dishRow}
                  type="button"
                  aria-labelledby={`${itemId}-name`}
                  aria-describedby={`${itemId}-classification ${itemId}-usage`}
                  onClick={() => edit(dish)}
                >
                  <strong id={`${itemId}-name`}>{dish.name || "Untitled dish"}</strong>
                  <span className={dishStyles.classification} id={`${itemId}-classification`}>
                    {title(dish.category)} <Temperature value={dish.temperature} />
                  </span>
                  <span className={dishStyles.usage} id={`${itemId}-usage`}>
                    Version {dish.version} · {count} loaded {count === 1 ? "menu" : "menus"}
                  </span>
                  <Icon name="forward" />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className={styles.empty}>
          {filtering ? "No dishes match these filters." : "No dishes yet."}
          {loadMore ? " Load more dishes to continue looking." : ""}
        </p>
      )}
      {loadMore && (
        <div className={styles.actions}>
          <Button disabled={busy} onClick={loadMore}>
            {busy ? "Loading dishes…" : "Load more dishes"}
          </Button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

type DishForm = {
  dish: Dish;
  save: DraftStatus;
  canManage: boolean;
  update: (change: (dish: Dish) => Dish) => void;
};

export function DishEditor({
  dish,
  save,
  canManage,
  update,
  back,
  backLabel,
  menuContext,
  kitchen,
  safetyAvailable,
  checkerOrigin,
}: DishForm & {
  back: () => void;
  backLabel: string;
  menuContext?: { name: string; sectionName: string };
  assortment?: () => void;
  kitchen: () => void;
  safetyAvailable: boolean;
  checkerOrigin?: string;
}) {
  const formId = useId();
  const assortmentSummary = useRef<HTMLElement>(null);
  const expectedTotal = useRef<HTMLInputElement>(null);
  const assortment = dish.assortment;
  return (
    <>
      <PageHeading
        title={dish.name || (dish.version ? "Untitled dish" : "New dish")}
        eyebrow={
          menuContext && (
            <Breadcrumb>
              <span>{menuContext.name || "Untitled menu"}</span>
              <span>/</span>
              <span>{menuContext.sectionName || "Untitled section"}</span>
            </Breadcrumb>
          )
        }
        context={dish.version > 0 && <span>Draft version {dish.version}</span>}
      >
        <SaveNotice {...save} />
        <Button onClick={back}>Back to {backLabel.toLowerCase()}</Button>
        <Button onClick={kitchen}><Icon name="chef" /> Kitchen preview</Button>
      </PageHeading>
      <div className={styles.editorColumns}>
        <section className={styles.formStack} aria-labelledby={`${formId}-details`}>
          <h2 id={`${formId}-details`}>Dish details</h2>
          <label className="fika-field">
            Dish name
            <input
              className="fika-input"
              disabled={!canManage}
              value={dish.name}
              maxLength={200}
              onChange={(event) =>
                update((item) => ({ ...item, name: event.target.value }))
              }
            />
          </label>
          <label className="fika-field">
            Category
            <select
              className="fika-select"
              disabled={!canManage}
              value={dish.category}
              onChange={(event) =>
                update((item) => ({
                  ...item,
                  category: event.target.value as Dish["category"],
                }))
              }
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {title(category)}
                </option>
              ))}
            </select>
          </label>
          <label className="fika-field">
            Hot / cold
            <select
              className="fika-select"
              disabled={!canManage}
              value={dish.temperature || ""}
              onChange={(event) =>
                update((item) => ({
                  ...item,
                  temperature: (event.target.value ||
                    null) as Dish["temperature"],
                }))
              }
            >
              <option value="">Not set</option>
              <option value="hot">Hot</option>
              <option value="cold">Cold</option>
            </select>
          </label>
        </section>
        <section className={styles.formStack} aria-labelledby={`${formId}-descriptions`}>
          <h2 id={`${formId}-descriptions`}>Descriptions</h2>
          <div className="fika-field">
            <label htmlFor={`${formId}-customer`}>Customer description</label>
            <textarea
              id={`${formId}-customer`}
              aria-describedby={`${formId}-customer-help`}
              className="fika-textarea"
              disabled={!canManage}
              maxLength={4000}
              value={dish.customerDescription}
              onChange={(event) =>
                update((item) => ({
                  ...item,
                  customerDescription: event.target.value,
                }))
              }
            />
            <span className={styles.fieldFoot} id={`${formId}-customer-help`}>
              Appears on the customer menu
              <span>{dish.customerDescription.length} / 4,000</span>
            </span>
          </div>
          <div className="fika-field">
            <label htmlFor={`${formId}-kitchen`}>Kitchen-only description</label>
            <textarea
              id={`${formId}-kitchen`}
              aria-describedby={`${formId}-kitchen-help`}
              className="fika-textarea"
              disabled={!canManage}
              maxLength={12000}
              value={dish.kitchenDescription}
              onChange={(event) =>
                update((item) => ({
                  ...item,
                  kitchenDescription: event.target.value,
                }))
              }
            />
            <span className={styles.fieldFoot} id={`${formId}-kitchen-help`}>
              Instructions for the kitchen team
              <span>{dish.kitchenDescription.length} / 12,000</span>
            </span>
          </div>
        </section>
      </div>
      <details className={`${styles.disclosure} ${dishStyles.assortmentDisclosure}`}>
        <summary ref={assortmentSummary}>
          Fixed assortment <span className={`${dishStyles.usage} ${dishStyles.assortmentStatus}`}>
            {assortment ? (assortmentIsComplete(dish) ? "· Totals match" : "· Needs attention") : "· Optional"}
          </span>
        </summary>
        {assortment ? (
          <AssortmentFields
            dish={dish}
            canManage={canManage}
            update={update}
            expectedTotalRef={expectedTotal}
            onRemove={() => assortmentSummary.current?.focus()}
          />
        ) : (
          <>
            <p>Use an assortment when one box contains a fixed mix of items.</p>
            <Button
              disabled={!canManage}
              onClick={() => {
                update((item) => item.assortment ? item : {
                  ...item,
                  assortment: { expectedTotal: 0, unit: "", components: [] },
                });
                requestAnimationFrame(() => expectedTotal.current?.focus());
              }}
            >
              <Icon name="plus" /> Add assortment
            </Button>
          </>
        )}
      </details>
      {safetyAvailable ? (
        <DishSafety key={`${dish.id}:${dish.version}:${save.state}`} dish={dish} saved={save.state === "saved"}
          canManage={canManage} checkerOrigin={checkerOrigin} />
      ) : (
        <div className="fika-notice">
          Food-safety verification is unavailable. Signing uses the existing FIKA
          allergen process.
        </div>
      )}
    </>
  );
}

export function AssortmentBuilder({
  dish,
  save,
  canManage,
  update,
  back,
  kitchen,
}: DishForm & {
  back: () => void;
  kitchen: () => void;
}) {
  if (!dish.assortment) return null;
  return (
    <>
      <PageHeading
        title={"Assortment — " + (dish.name || "Untitled dish")}
        eyebrow={
          <Breadcrumb>
            <span>Dishes</span>
            <span>/</span>
            <button onClick={back}>{dish.name || "Dish editor"}</button>
            <span>/</span>
            <span>Assortment</span>
          </Breadcrumb>
        }
      >
        <SaveNotice {...save} />
      </PageHeading>
      <AssortmentFields dish={dish} canManage={canManage} update={update} onRemove={back} />
      <div className={styles.footerActions}>
        <Button onClick={kitchen}>Kitchen preview</Button>
        <Button primary onClick={back}>Done</Button>
      </div>
    </>
  );
}

function AssortmentFields({
  dish,
  canManage,
  update,
  onRemove,
  expectedTotalRef,
}: Pick<DishForm, "dish" | "canManage" | "update"> & {
  onRemove: () => void;
  expectedTotalRef?: Ref<HTMLInputElement>;
}) {
  const assortment = dish.assortment;
  const [confirmRemove, setConfirmRemove] = useState(false);
  const componentsHeading = useId();
  const newComponent = useRef("");
  function revise(
    change: (
      value: NonNullable<Dish["assortment"]>,
    ) => NonNullable<Dish["assortment"]>,
  ) {
    update((item) =>
      item.assortment ? { ...item, assortment: change(item.assortment) } : item,
    );
  }
  if (!assortment) return null;
  const total = assortmentTotal(assortment.components);
  const valid = assortmentIsComplete(dish);

  return (
    <>
      <div className={styles.assortmentColumns}>
        <section className={styles.formStack}>
          <h2>Box configuration</h2>
          <label className="fika-field">
            Expected total per box
            <input
              type="number"
              ref={expectedTotalRef}
              min="0"
              step="any"
              className="fika-input"
              disabled={!canManage}
              value={assortment.expectedTotal}
              onChange={(event) =>
                revise((value) => ({
                  ...value,
                  expectedTotal: Number(event.target.value),
                }))
              }
            />
          </label>
          <label className="fika-field">
            Unit
            <input
              className="fika-input"
              disabled={!canManage}
              value={assortment.unit}
              maxLength={48}
              onChange={(event) =>
                revise((value) => ({ ...value, unit: event.target.value }))
              }
            />
          </label>
          <div
            className={
              "fika-notice " +
              (valid ? "fika-notice--success" : "fika-notice--warning")
            }
            role="status"
          >
            <strong>
              {valid ? "Assortment totals match" : "Assortment needs attention"}
            </strong>
            <br />
            {assortmentProgress(
              total,
              assortment.expectedTotal,
              assortment.unit,
            )}
            {!valid && (
              <p>
                Complete the box details before publishing. Your draft can still
                be saved.
              </p>
            )}
          </div>
        </section>
        <section aria-labelledby={componentsHeading}>
          <h2 id={componentsHeading} tabIndex={-1}>Assortment contents (per box)</h2>
          {assortment.components.length ? (
            <ol className={dishStyles.componentList}>
              {assortment.components.map((component, index) => (
                <li className={dishStyles.componentRow} key={component.id}>
                  <label className="fika-field">
                    Component {index + 1}
                    <input
                      className="fika-input"
                      value={component.name}
                      disabled={!canManage}
                      maxLength={200}
                      ref={(field) => {
                        if (!field || newComponent.current !== component.id) return;
                        newComponent.current = "";
                        field.focus();
                      }}
                      onChange={(event) =>
                        revise((value) => ({
                          ...value,
                          components: value.components.map((item) =>
                            item.id === component.id ? { ...item, name: event.target.value } : item,
                          ),
                        }))
                      }
                    />
                  </label>
                  <label className="fika-field">
                    Quantity <span className={styles.srOnly}>for component {index + 1}</span>
                    <input
                      className="fika-input"
                      type="number"
                      min="0"
                      step="any"
                      disabled={!canManage}
                      value={component.quantity}
                      onChange={(event) =>
                        revise((value) => ({
                          ...value,
                          components: value.components.map((item) =>
                            item.id === component.id ? { ...item, quantity: Number(event.target.value) } : item,
                          ),
                        }))
                      }
                    />
                  </label>
                  {canManage && (
                    <Button
                      label={"Remove component " + (index + 1)}
                      onClick={() => {
                        revise((value) => ({
                          ...value,
                          components: value.components.filter((item) => item.id !== component.id),
                        }));
                        document.getElementById(componentsHeading)?.focus();
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              ))}
            </ol>
          ) : (
            <p>Add the components that make up one box.</p>
          )}
          <Button
            disabled={!canManage}
            onClick={() => {
              const id = crypto.randomUUID();
              newComponent.current = id;
              revise((value) => ({
                ...value,
                components: [
                  ...value.components,
                  { id, name: "", quantity: 1 },
                ],
              }));
            }}
          >
            <Icon name="plus" /> Add component
          </Button>
        </section>
      </div>
      {canManage && (
        <details className={styles.disclosure}>
          <summary>Remove assortment</summary>
          <label className="fika-choice">
            <input
              type="checkbox"
              checked={confirmRemove}
              onChange={(event) => setConfirmRemove(event.target.checked)}
            />{" "}
            Remove the assortment and its components from this draft
          </label>
          <Button
            disabled={!confirmRemove}
            onClick={() => {
              update((item) => ({ ...item, assortment: null }));
              onRemove();
            }}
          >
            Remove assortment
          </Button>
        </details>
      )}
    </>
  );
}

export function KitchenPreview({
  dish,
  choices,
  chooseDish,
  loadMore,
  busy,
  boxCount,
  setBoxCount,
  quantities,
  back,
  activation,
}: {
  dish: Dish | null;
  choices?: Dish[];
  chooseDish: (id: string) => void;
  loadMore?: () => void;
  busy: boolean;
  boxCount: number;
  setBoxCount: (count: number) => void;
  quantities: ReturnType<typeof kitchenQuantities> | null;
  back: () => void;
  activation?: () => void;
}) {
  return (
    <>
      <div
        className={styles.tabBar}
        role="group"
        aria-label="Operational preview"
      >
        {activation && (
          <button type="button" onClick={activation}>
            Special collection activation
          </button>
        )}
        <span aria-current="page">CPU kitchen spec preview</span>
      </div>
      <PageHeading
        title="Draft kitchen preview"
        eyebrow={
          <Breadcrumb>
            <button onClick={back}>
              {choices ? "Collection activation" : "Dish editor"}
            </button>
            <span>/</span>
            <span>Kitchen preview</span>
          </Breadcrumb>
        }
      />
      <p className="fika-notice fika-notice--warning">
        Draft only. Verified CPU production packets and run sheets are
        unavailable.
      </p>
      <div className={styles.editorColumns}>
        <section className={styles.formStack}>
          {choices && (
            <>
              <label className="fika-field">
                Dish
                <select
                  className="fika-select"
                  disabled={!choices.length}
                  value={dish?.id || ""}
                  onChange={(event) => chooseDish(event.target.value)}
                >
                  {!choices.length && (
                    <option value="">No loaded dishes</option>
                  )}
                  {choices.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name || "Untitled dish"}
                    </option>
                  ))}
                </select>
              </label>
              {loadMore && (
                <Button disabled={busy} onClick={loadMore}>
                  Load more dishes
                </Button>
              )}
            </>
          )}
          {dish ? (
            <>
              <h2>{dish.name || "Untitled dish"}</h2>
              <p>
                {dish.kitchenDescription || "No kitchen description entered."}
              </p>
            </>
          ) : (
            <p>
              Choose a dish in the collection to preview its draft
              specification.
            </p>
          )}
          {dish?.assortment && (
            <label className="fika-field">
              Number of boxes
              <input
                type="number"
                min="1"
                step="1"
                className="fika-input"
                value={boxCount}
                onChange={(event) => setBoxCount(Number(event.target.value))}
              />
            </label>
          )}
        </section>
        {dish?.assortment && (
          <section>
            <h2>Order quantities</h2>
            {quantities ? (
              <>
                <p>
                  <strong>
                    {quantities.boxes} boxes × {quantities.perBox}{" "}
                    {quantities.unit} = {quantities.total} {quantities.unit}
                  </strong>
                </p>
                <div className={styles.tableScroll}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th scope="col">Component</th>
                        <th scope="col">Per box</th>
                        <th scope="col">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {quantities.components.map((item) => (
                        <tr key={item.id}>
                          <th scope="row">{item.name}</th>
                          <td>{item.perBox}</td>
                          <td>{item.total}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <p>
                Enter a whole positive box count and complete the assortment to
                calculate totals.
              </p>
            )}
          </section>
        )}
      </div>
    </>
  );
}
