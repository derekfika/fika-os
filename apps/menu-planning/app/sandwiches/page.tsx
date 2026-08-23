"use client";

import { useEffect, useState } from "react";
import {
  sandwichAllergenColumns,
  type SavedSandwich,
  type SandwichAllergens,
} from "@/lib/sandwich-types";
import "./sandwiches.css";

function blank(): SandwichAllergens {
  return Object.fromEntries(
    sandwichAllergenColumns.map(([key]) => [key, "clear"]),
  ) as SandwichAllergens;
}
function cycle(value: SandwichAllergens[string]) {
  return value === "clear"
    ? "contains"
    : value === "contains"
      ? "may_contain"
      : "clear";
}

export default function SandwichesPage() {
  const [sandwiches, setSandwiches] = useState<SavedSandwich[]>([]);
  const [title, setTitle] = useState("");
  const [allergens, setAllergens] = useState<SandwichAllergens>(blank());
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const response = await fetch("/api/sandwiches", { cache: "no-store" });
    const body = await response.json();
    if (response.ok) setSandwiches(body.sandwiches || []);
    else setMessage(body.error?.message || "Could not load sandwiches.");
  };
  useEffect(() => {
    void load();
  }, []);
  const choose = (sandwich: SavedSandwich) => {
    setTitle(sandwich.title);
    setAllergens({ ...blank(), ...sandwich.allergens });
    setMessage(`Editing ${sandwich.title}. Save to update it.`);
  };
  const toggle = (key: string) =>
    setAllergens((current) => {
      const next = {
        ...current,
        [key]: cycle(current[key] || "clear"),
      } as SandwichAllergens;
      if (key === "noKeyAllergens" && next[key] !== "clear")
        for (const other of Object.keys(next))
          if (other !== key) next[other] = "clear";
      if (key !== "noKeyAllergens" && next[key] !== "clear")
        next.noKeyAllergens = "clear";
      return next;
    });
  const save = async () => {
    setBusy(true);
    setMessage("");
    const response = await fetch("/api/sandwiches", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, allergens, updatedBy: "Menu Planning" }),
    });
    const body = await response.json();
    if (!response.ok)
      setMessage(body.error?.message || "Could not save sandwich.");
    else {
      setSandwiches(body.sandwiches || []);
      setMessage(`Saved ${body.sandwich.title}.`);
    }
    setBusy(false);
  };
  return (
    <main className="menu-app">
      <header className="os-header">
        <a className="os-brand" href="/">
          <strong>FIKA</strong>
          <span>OS</span>
        </a>
        <div>
          <small>Reusable production knowledge</small>
          <h1>Saved sandwiches</h1>
        </div>
        <a className="button button-soft" href="/">
          Back to Menu Planning
        </a>
      </header>
      <section className="menu-page-heading">
        <div>
          <small>Production chefs and recipe team</small>
          <h2>Save the sandwich once.</h2>
          <p>
            Keep a title and its reviewed allergen pattern together, then recall
            it from any production plan without retyping.
          </p>
        </div>
      </section>
      {message && (
        <p className="menu-error" role="status">
          {message}
        </p>
      )}
      <section className="workspace-panel">
        <header className="panel-header">
          <div>
            <small>Shared sandwich library</small>
            <h3>
              {sandwiches.length} saved sandwich
              {sandwiches.length === 1 ? "" : "es"}
            </h3>
          </div>
          <button
            className="button button-soft"
            onClick={() => {
              setTitle("");
              setAllergens(blank());
              setMessage("New sandwich");
            }}
          >
            New sandwich
          </button>
        </header>
        {sandwiches.length ? (
          <div className="library-list">
            {sandwiches.map((sandwich) => (
              <button
                className="library-row"
                key={sandwich.id}
                onClick={() => choose(sandwich)}
              >
                <div>
                  <strong>{sandwich.title}</strong>
                  <span>
                    {Object.entries(sandwich.allergens)
                      .filter(([, value]) => value !== "clear")
                      .map(
                        ([key, value]) => `${key}: ${value.replace("_", " ")}`,
                      )
                      .join(" · ") || "No key allergens recorded"}
                  </span>
                </div>
                <small>
                  Updated{" "}
                  {new Date(sandwich.updatedAt).toLocaleDateString("en-GB")}
                </small>
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <h3>No saved sandwiches yet.</h3>
            <p>
              Create the first one below, or save it directly from CPU
              Production.
            </p>
          </div>
        )}
      </section>
      <section className="workspace-panel sandwich-editor">
        <header className="panel-header">
          <div>
            <small>Identical master-style matrix</small>
            <h3>{title || "New sandwich"}</h3>
          </div>
          <button
            className="button button-purple"
            disabled={busy || !title.trim()}
            onClick={() => void save()}
          >
            Save sandwich
          </button>
        </header>
        <label className="sandwich-title-field">
          Sandwich title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="e.g. Vegan cheddar, onion marmalade, salad"
          />
        </label>
        <div className="allergen-table-wrap">
          <table className="allergen-checker">
            <thead>
              <tr>
                <th>Dish / food / product</th>
                {sandwichAllergenColumns.map(([, label]) => (
                  <th key={label}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>{title || "Dish / food / product"}</th>
                {sandwichAllergenColumns.map(([key, label]) => {
                  const value = allergens[key] || "clear";
                  return (
                    <td key={key}>
                      <button
                        type="button"
                        aria-label={`${label}: ${value}`}
                        className={`allergen-cell allergen-cell--${value}`}
                        onClick={() => toggle(key)}
                      >
                        {value === "may_contain"
                            ? "MC"
                            : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="form-help">
          Click each cell to cycle clear → contains → may contain → clear. “No
          key allergens” clears the other cells.
        </p>
      </section>
    </main>
  );
}
