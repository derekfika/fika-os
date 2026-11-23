import { useRef, useState } from "react";
import { categories, type Dish, type Section } from "../lib/contract";
import { assignWeeks, copyWeeks } from "./rotation-workspace-model";
import { Button, title } from "./studio-ui";
import styles from "./rotation-workspace.module.css";

const numbers = [0, 1, 2, 3, 4, 5];
export function RotationWorkspace({
  section,
  dishes,
  week,
  canManage,
  update,
  chooseWeek,
  loadMore,
  busy,
  createDish,
}: {
  section: Section;
  dishes: Dish[];
  week: number;
  canManage: boolean;
  update: (change: Partial<Section>) => void;
  chooseWeek: (week: number) => void;
  loadMore?: () => void;
  busy: boolean;
  createDish: () => void;
}) {
  const top = useRef<HTMLHeadingElement>(null);
  const bulk = useRef<HTMLHeadingElement>(null);
  const copy = useRef<HTMLHeadingElement>(null);
  const [notice, setNotice] = useState<{
    area: "bulk" | "copy";
    text: string;
  } | null>(null);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [temperature, setTemperature] = useState("all");
  const [picked, setPicked] = useState<string[]>([]);
  const [targets, setTargets] = useState<number[]>([week]);
  const [source, setSource] = useState(week);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const allIds = Array.from(new Set(section.weeks.flat()));
  const byId = new Map(dishes.map((dish) => [dish.id, dish]));
  const matches = dishes.filter(
    (dish) =>
      (category === "all" || dish.category === category) &&
      (temperature === "all" || dish.temperature === temperature) &&
      dish.name
        .toLocaleLowerCase("en-GB")
        .includes(search.trim().toLocaleLowerCase("en-GB")),
  );
  const toggle = <T,>(values: T[], value: T) =>
    values.includes(value)
      ? values.filter((entry) => entry !== value)
      : [...values, value];
  const apply = (remove: boolean) => {
    const changed = picked.filter((id) =>
      targets.some((i) =>
        remove ? section.weeks[i].includes(id) : !section.weeks[i].includes(id),
      ),
    ).length;
    update({ weeks: assignWeeks(section.weeks, picked, targets, remove) });
    setNotice({
      area: "bulk",
      text: `${changed} ${changed === 1 ? "dish changed" : "dishes changed"} across ${targets.map((i) => `week ${i + 1}`).join(", ")} in this draft. See save status above.`,
    });
    setPicked([]);
  };
  const copyTargets = targets.filter((target) => target !== source);
  const populated = copyTargets.filter(
    (target) => section.weeks[target]?.length,
  );
  const snapshot = JSON.stringify(section.weeks);
  return (
    <div className={styles.workspace}>
      <section aria-label="Six-week rotation">
        <h2 ref={top} tabIndex={-1}>
          Six-week rotation
        </h2>
        <div className={styles.actions}>
          <Button onClick={() => bulk.current?.focus()}>
            Add or remove dishes
          </Button>
          <Button onClick={() => copy.current?.focus()}>Copy a week</Button>
        </div>
        <p>
          Change a dish in one week using its checkbox. Open a week to change
          the order.
        </p>
        <div className={styles.weekLinks}>
          {numbers.map((i) => (
            <Button key={i} onClick={() => chooseWeek(i)}>
              Week {i + 1} · {section.weeks[i]?.length || 0} choices
            </Button>
          ))}
        </div>
        {allIds.length === 0 && (
          <p>No dishes assigned yet. Select dishes below to begin.</p>
        )}
        <div className={styles.rows}>
          {allIds.map((id) => {
            const name = byId.get(id)?.name || "Dish unavailable";
            return (
              <fieldset className={styles.row} key={id}>
                <legend>{name}</legend>
                <div className={styles.weeks}>
                  {numbers.map((i) => (
                    <label key={i}>
                      <input
                        type="checkbox"
                        disabled={!canManage}
                        checked={section.weeks[i]?.includes(id) || false}
                        onChange={(event) =>
                          update({
                            weeks: assignWeeks(
                              section.weeks,
                              [id],
                              [i],
                              !event.target.checked,
                            ),
                          })
                        }
                      />{" "}
                      W{i + 1}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
        </div>
      </section>
      <section aria-label="Bulk dish assignment" className={styles.panel}>
        <h2 ref={bulk} tabIndex={-1}>
          Add or remove dishes
        </h2>
        <p role="status">{notice?.area === "bulk" ? notice.text : ""}</p>
        <Button onClick={() => top.current?.focus()}>Back to rotation</Button>
        <label className="fika-field">
          Search dishes
          <input
            className="fika-input"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <div className={styles.actions}>
          <label className="fika-field">
            Category
            <select
              className="fika-select"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            >
              <option value="all">All categories</option>
              {categories.map((value) => (
                <option key={value} value={value}>
                  {title(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="fika-field">
            Temperature
            <select
              className="fika-select"
              value={temperature}
              onChange={(event) => setTemperature(event.target.value)}
            >
              <option value="all">Any temperature</option>
              <option value="hot">Hot</option>
              <option value="cold">Cold</option>
            </select>
          </label>
        </div>
        <div className={styles.actions}>
          <Button
            disabled={!canManage || !matches.length}
            onClick={() =>
              setPicked(
                Array.from(
                  new Set([...picked, ...matches.map((dish) => dish.id)]),
                ),
              )
            }
          >
            Select all {matches.length} shown
          </Button>
          <Button disabled={!picked.length} onClick={() => setPicked([])}>
            Clear dish selection
          </Button>
          <span>{picked.length} selected</span>
        </div>
        <div className={styles.picker}>
          {matches.map((dish) => (
            <label key={dish.id}>
              <input
                type="checkbox"
                disabled={!canManage}
                checked={picked.includes(dish.id)}
                onChange={() => setPicked(toggle(picked, dish.id))}
              />{" "}
              <span>
                {dish.name} <small>· {title(dish.category)}</small>
              </span>
            </label>
          ))}
          {!matches.length && <p>No dishes match this search.</p>}
        </div>
        {loadMore && (
          <Button disabled={busy} onClick={loadMore}>
            Load more dishes
          </Button>
        )}
        <Button disabled={!canManage} onClick={createDish}>
          Create dish
        </Button>
        <fieldset>
          <legend>Apply to weeks</legend>
          <div className={styles.weeks}>
            {numbers.map((i) => (
              <label key={i}>
                <input
                  type="checkbox"
                  checked={targets.includes(i)}
                  onChange={() => {
                    setTargets(toggle(targets, i));
                    setConfirmation(null);
                  }}
                />{" "}
                W{i + 1}
              </label>
            ))}
          </div>
        </fieldset>
        <div className={styles.actions}>
          <Button
            onClick={() => {
              setTargets(numbers);
              setConfirmation(null);
            }}
          >
            Select all weeks
          </Button>
          <Button
            onClick={() => {
              setTargets([]);
              setConfirmation(null);
            }}
          >
            Clear week selection
          </Button>
          <Button
            primary
            disabled={!canManage || !picked.length || !targets.length}
            onClick={() => apply(false)}
          >
            Add {picked.length} {picked.length === 1 ? "dish" : "dishes"} to{" "}
            {targets.length} {targets.length === 1 ? "week" : "weeks"}
          </Button>
          <Button
            disabled={!canManage || !picked.length || !targets.length}
            onClick={() => apply(true)}
          >
            Remove {picked.length} {picked.length === 1 ? "dish" : "dishes"}{" "}
            from {targets.length} {targets.length === 1 ? "week" : "weeks"}
          </Button>
        </div>
      </section>
      <section aria-label="Copy rotation weeks" className={styles.panel}>
        <h2 ref={copy} tabIndex={-1}>
          Copy a week
        </h2>
        <p role="status">{notice?.area === "copy" ? notice.text : ""}</p>
        <Button onClick={() => top.current?.focus()}>Back to rotation</Button>
        <p>
          Copy the source into the selected weeks above. Existing choices in
          those weeks will be replaced.
        </p>
        <label className="fika-field">
          Copy from
          <select
            className="fika-select"
            value={source}
            onChange={(event) => {
              setSource(Number(event.target.value));
              setConfirmation(null);
            }}
          >
            {numbers.map((i) => (
              <option key={i} value={i}>
                Week {i + 1}
              </option>
            ))}
          </select>
        </label>
        {populated.length > 0 && (
          <label className={styles.confirm}>
            <input
              type="checkbox"
              checked={confirmation === snapshot}
              onChange={(event) =>
                setConfirmation(event.target.checked ? snapshot : null)
              }
            />{" "}
            Replace choices in{" "}
            {populated.map((i) => `week ${i + 1}`).join(", ")}
          </label>
        )}
        <Button
          disabled={
            !canManage ||
            !copyTargets.length ||
            (populated.length > 0 && confirmation !== snapshot)
          }
          onClick={() => {
            const result = copyWeeks(
              section.weeks,
              source,
              copyTargets,
              confirmation,
            );
            if (result) {
              update({ weeks: result });
              setNotice({
                area: "copy",
                text: `Copied week ${source + 1} to ${copyTargets.map((i) => `week ${i + 1}`).join(", ")} in this draft. See save status above.`,
              });
            }
            setConfirmation(null);
          }}
        >
          Copy week {source + 1} to {copyTargets.length}{" "}
          {copyTargets.length === 1 ? "week" : "weeks"}
        </Button>
      </section>
    </div>
  );
}
