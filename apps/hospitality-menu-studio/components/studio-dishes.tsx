import { useState } from "react";
import { categories, type Dish, type Menu } from "../lib/contract";
import { assortmentIsComplete, type kitchenQuantities } from "../lib/review";
import { assortmentTotal } from "./studio-model";
import {
  Breadcrumb,
  Button,
  Icon,
  PageHeading,
  Pill,
  SaveNotice,
  Temperature,
  title,
  type DraftStatus,
} from "./studio-ui";
import styles from "./studio.module.css";

export function DishCollection({
  dishes,
  menus,
  canManage,
  create,
  edit,
  loadMore,
  busy,
  error,
}: {
  dishes: Dish[];
  menus: Menu[];
  canManage: boolean;
  create: () => void;
  edit: (dish: Dish) => void;
  loadMore?: () => void;
  busy: boolean;
  error: string;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [temperature, setTemperature] = useState("all");
  const filtered = dishes.filter(
    (dish) =>
      (category === "all" ||
        (category === "veg"
          ? ["vegetarian", "vegan"].includes(dish.category)
          : category === dish.category)) &&
      (temperature === "all" || dish.temperature === temperature) &&
      dish.name
        .toLocaleLowerCase("en-GB")
        .includes(search.trim().toLocaleLowerCase("en-GB")),
  );
  const usage = new Map<string, number>();
  for (const menu of menus) {
    const menuDishes = new Set(
      menu.sections.flatMap((section) =>
        section.mode === "static"
          ? section.staticDishIds
          : section.weeks.flat(),
      ),
    );
    for (const id of menuDishes) usage.set(id, (usage.get(id) || 0) + 1);
  }
  return (
    <>
      <PageHeading
        title="Dish collection"
        context={<p>Your reusable Hospitality dishes</p>}
      >
        <Button primary onClick={create} disabled={!canManage}>
          <Icon name="plus" /> Add dish
        </Button>
      </PageHeading>
      <div className={styles.filterBar}>
        <label className={"fika-field " + styles.searchField}>
          Search dishes
          <span>
            <Icon name="search" />
            <input
              type="search"
              placeholder="Search dishes…"
              className="fika-input"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </span>
        </label>
        <label className="fika-field">
          Category
          <select
            className="fika-select"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
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
            value={temperature}
            onChange={(event) => setTemperature(event.target.value)}
          >
            <option value="all">All temperatures</option>
            <option value="hot">Hot</option>
            <option value="cold">Cold</option>
          </select>
        </label>
      </div>
      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <caption className={styles.srOnly}>
            Loaded dishes and their use in loaded menu drafts
          </caption>
          <thead>
            <tr>
              <th scope="col">Dish</th>
              <th scope="col">Category</th>
              <th scope="col">Hot / cold</th>
              <th scope="col">Allergens</th>
              <th scope="col">Version</th>
              <th scope="col">Loaded menus</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((dish) => (
              <tr key={dish.id}>
                <th scope="row">
                  <button
                    type="button"
                    className={styles.textAction}
                    onClick={() => edit(dish)}
                  >
                    {dish.name || "Untitled dish"}
                  </button>
                </th>
                <td>{title(dish.category)}</td>
                <td>
                  <Temperature value={dish.temperature} />
                </td>
                <td>
                  <Pill>Unavailable</Pill>
                </td>
                <td>{dish.version}</td>
                <td>{usage.get(dish.id) || 0}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!filtered.length && (
          <p className={styles.empty}>
            No matching dishes. Change the filters or add a dish.
          </p>
        )}
      </div>
      {loadMore && (
        <Button disabled={busy} onClick={loadMore}>
          Load more dishes
        </Button>
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
  assortment,
  kitchen,
}: DishForm & {
  back: () => void;
  backLabel: string;
  assortment: () => void;
  kitchen: () => void;
}) {
  return (
    <>
      <PageHeading
        title={dish.version ? "Edit dish" : "New dish"}
        eyebrow={
          <Breadcrumb>
            <button onClick={back}>{backLabel}</button>
            <span>/</span>
            <span>{dish.name || "New dish"}</span>
          </Breadcrumb>
        }
        context={
          <div className={styles.metadata}>
            <Pill tone="info">Draft</Pill>
            {dish.version > 0 && <span>Version {dish.version}</span>}
          </div>
        }
      >
        <SaveNotice {...save} />
      </PageHeading>
      <div className={styles.editorColumns}>
        <section className={styles.formStack} aria-label="Dish details">
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
        <section className={styles.formStack} aria-label="Dish descriptions">
          <label className="fika-field">
            Customer description
            <textarea
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
            <span className={styles.fieldFoot}>
              Customer-facing menu copy{" "}
              <span>{dish.customerDescription.length} / 4,000</span>
            </span>
          </label>
          <label className="fika-field">
            Kitchen-only description
            <textarea
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
            <span className={styles.fieldFoot}>
              Kitchen specification{" "}
              <span>{dish.kitchenDescription.length} / 12,000</span>
            </span>
          </label>
        </section>
      </div>
      <div className="fika-notice">
        Food-safety verification is unavailable. Signing uses the existing FIKA
        allergen process.
      </div>
      <div className={styles.footerActions}>
        <Button onClick={back}>Back to {backLabel.toLowerCase()}</Button>
        <Button onClick={kitchen}>Kitchen preview</Button>
        <Button
          primary
          onClick={assortment}
          disabled={!dish.assortment && !canManage}
        >
          {dish.assortment ? "Edit assortment" : "Add assortment"}
        </Button>
      </div>
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
  const assortment = dish.assortment;
  const [confirmRemove, setConfirmRemove] = useState(false);
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
        context={<p>Define the quantities and contents in one box.</p>}
      >
        <SaveNotice {...save} />
      </PageHeading>
      <div className={styles.assortmentColumns}>
        <section className={styles.formStack}>
          <h2>Box configuration</h2>
          <label className="fika-field">
            Expected total per box
            <input
              type="number"
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
            Total per box: {total} of {assortment.expectedTotal}{" "}
            {assortment.unit}
          </div>
        </section>
        <section>
          <h2>Assortment contents (per box)</h2>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Item / component</th>
                  <th scope="col">Quantity</th>
                  <th scope="col">Actions</th>
                </tr>
              </thead>
              <tbody>
                {assortment.components.map((component, index) => (
                  <tr key={component.id}>
                    <td>
                      <input
                        aria-label={"Component " + (index + 1)}
                        className="fika-input"
                        value={component.name}
                        disabled={!canManage}
                        maxLength={200}
                        onChange={(event) =>
                          revise((value) => ({
                            ...value,
                            components: value.components.map((item) =>
                              item.id === component.id
                                ? { ...item, name: event.target.value }
                                : item,
                            ),
                          }))
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={"Quantity for component " + (index + 1)}
                        className={"fika-input " + styles.quantity}
                        type="number"
                        min="0"
                        step="any"
                        disabled={!canManage}
                        value={component.quantity}
                        onChange={(event) =>
                          revise((value) => ({
                            ...value,
                            components: value.components.map((item) =>
                              item.id === component.id
                                ? {
                                    ...item,
                                    quantity: Number(event.target.value),
                                  }
                                : item,
                            ),
                          }))
                        }
                      />
                    </td>
                    <td>
                      <Button
                        disabled={!canManage}
                        label={"Remove component " + (index + 1)}
                        onClick={() =>
                          revise((value) => ({
                            ...value,
                            components: value.components.filter(
                              (item) => item.id !== component.id,
                            ),
                          }))
                        }
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!assortment.components.length && (
              <p className={styles.empty}>
                Add the components that make up one box.
              </p>
            )}
          </div>
          <Button
            disabled={!canManage}
            onClick={() =>
              revise((value) => ({
                ...value,
                components: [
                  ...value.components,
                  { id: crypto.randomUUID(), name: "", quantity: 1 },
                ],
              }))
            }
          >
            <Icon name="plus" /> Add item
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
              back();
            }}
          >
            Remove assortment
          </Button>
        </details>
      )}
      <div className={styles.footerActions}>
        <Button onClick={kitchen}>Kitchen preview</Button>
        <Button primary onClick={back}>
          Done
        </Button>
      </div>
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
