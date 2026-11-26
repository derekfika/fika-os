"use client";
import { useEffect, useRef, useState } from "react";
import type { Publication } from "../lib/contract";
import { boxCount, publishedDishPage, publishedKitchenPreview, KitchenRequestGuard, type KitchenPreview, type PublishedDish } from "./published-kitchen-model";
import { useStudioRequest } from "./use-studio-draft";
function message(error: unknown) {
  const status = (error as { status?: number })?.status;
  if (status === 409) return "The signed evidence is no longer current, may have been revoked or replaced, or the publication changed. The specification cannot be shown.";
  if (status === 404) return "The publication or selected dish could not be found.";
  if (status === 422) return "The selection or box count is invalid. Check it and try again.";
  if (status === 401 || status === 403) return "You do not have access to this preview.";
  return "The published kitchen preview is unavailable. Try again when the service is available.";
}

export default function PublishedKitchenPreview({ menuId, publications, historyLoaded }: { menuId: string; publications: Publication[]; historyLoaded: boolean }) {
  const request = useStudioRequest();
  const read = (query: URLSearchParams) => request(undefined, "?" + query);
  const [publicationId, setPublicationId] = useState("");
  const [dishes, setDishes] = useState<PublishedDish[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [dishId, setDishId] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<KitchenPreview | null>(null);
  const [hasAssortment, setHasAssortment] = useState(false);
  const [boxes, setBoxes] = useState("1");
  const generation = useRef(new KitchenRequestGuard());
  useEffect(() => () => { generation.current.invalidate(); }, []);
  useEffect(() => {
    if (publicationId && !publications.some(item => item.id === publicationId)) {
      generation.current.invalidate(); setPublicationId(""); setDishes([]); setNextCursor(null); setDishId(""); setLoaded(false); setPreview(null); setHasAssortment(false); setError(""); setBusy(false);
    }
  }, [publicationId, publications]);

  async function loadDishes(pubId: string, cursor?: string) {
    const token = generation.current.next();
    setBusy(true); setError(""); setPreview(null);
    try {
      const query = new URLSearchParams({ menuId, publicationId: pubId, list: "published-kitchen-dishes" });
      if (cursor) query.set("cursor", cursor);
      const page = publishedDishPage(await read(query));
      if (!page || (cursor && page.nextCursor === cursor)) throw new Error("Invalid dish index");
      if (!generation.current.isCurrent(token)) return;
      if (cursor && page.items.some(item => dishes.some(existing => existing.id === item.id))) throw new Error("Duplicate dish page");
      setDishes(cursor ? [...dishes, ...page.items] : page.items);
      setNextCursor(page.nextCursor); setLoaded(true);
    } catch (cause) {
      if (!generation.current.isCurrent(token)) return;
      setDishes([]); setNextCursor(null); setDishId(""); setLoaded(false); setHasAssortment(false); setBoxes("1"); setError(message(cause));
    } finally { if (generation.current.isCurrent(token)) setBusy(false); }
  }
  function choosePublication(value: string) {
    generation.current.invalidate(); setPublicationId(value); setDishId(""); setDishes([]); setNextCursor(null);
    setLoaded(false); setPreview(null); setHasAssortment(false); setBoxes("1"); setError(""); setBusy(false);
    if (value) void loadDishes(value);
  }
  function chooseDish(value: string) {
    generation.current.invalidate(); setBusy(false); setDishId(value); setPreview(null); setHasAssortment(false); setBoxes("1"); setError("");
  }
  async function showPreview(withBoxes: boolean) {
    const selected = dishes.find(item => item.id === dishId);
    if (!selected || !publicationId) return;
    const count = withBoxes ? boxCount(boxes) : undefined;
    if (withBoxes && count === null) { generation.current.invalidate(); setPreview(null); setError("Enter a positive whole number of boxes."); return; }
    const token = generation.current.next();
    if (!withBoxes) setBoxes("1");
    setBusy(true); setPreview(null); setError("");
    try {
      const query = new URLSearchParams({ menuId, publicationId, kitchenDishId: selected.id });
      if (count !== undefined && count !== null) query.set("boxes", String(count));
      const result = publishedKitchenPreview(await read(query), menuId, publicationId, selected, count ?? undefined);
      if (!result) throw new Error("Invalid preview response");
      if (!generation.current.isCurrent(token)) return;
      setPreview(result); setHasAssortment(Boolean(result.dish.assortment));
    } catch (cause) {
      if (generation.current.isCurrent(token)) { setPreview(null); setError(message(cause)); }
    } finally { if (generation.current.isCurrent(token)) setBusy(false); }
  }
  return <div className="fika-card">
    <h3>Published kitchen content preview</h3>
    <p>Read-only published content, not a booking instruction or CPU production packet. Signed evidence is checked when the preview is opened.</p>
    {!publications.length ? <p>{historyLoaded ? "No published versions are recorded for this menu." : "Load published history above to select a publication."}</p> : <>
      <label className="fika-field">Published revision
        <select className="fika-select" value={publicationId} onChange={event => choosePublication(event.target.value)}>
          <option value="">Select a publication</option>
          {publications.map(item => <option key={item.id} value={item.id}>Revision {item.revision} · Effective {item.effectiveDate}</option>)}
        </select>
      </label>
      {publicationId && loaded && !dishes.length && <p>No dishes are recorded in this publication.</p>}
      {publicationId && dishes.length > 0 && <>
        <label className="fika-field">Published dish
          <select className="fika-select" value={dishId} onChange={event => chooseDish(event.target.value)}>
            <option value="">Select a dish</option>
            {dishes.map(item => <option key={item.id} value={item.id}>{item.name || "Unnamed dish"} · Version {item.version}</option>)}
          </select>
        </label>
        {nextCursor && <button type="button" className="fika-button fika-button--secondary" disabled={busy} onClick={() => void loadDishes(publicationId, nextCursor)}>Load more published dishes</button>}
        <button type="button" className="fika-button fika-button--secondary" disabled={busy || !dishId} onClick={() => void showPreview(false)}>Open published kitchen preview</button>
      </>}
      {hasAssortment && <>
        <label className="fika-field">Number of boxes
          <input className="fika-input" type="number" min="1" step="1" value={boxes} onChange={event => { generation.current.invalidate(); setBusy(false); setBoxes(event.target.value); setPreview(null); setError(""); }} />
        </label>
        <button type="button" className="fika-button fika-button--secondary" disabled={busy} onClick={() => void showPreview(true)}>Calculate published quantities</button>
      </>}
      <div role="status" aria-live="polite">{busy && <p>Loading published content…</p>}{error && <p>{error}</p>}</div>
      {preview && <div>
        <h3>{preview.dish.name} · Dish version {preview.dish.version}</h3>
        <p>Publication revision {preview.publication.revision} · Effective {preview.publication.effectiveDate}</p>
        <p>Signed evidence was verified when this preview was loaded. Open a fresh preview to recheck it.</p>
        <h3>Frozen kitchen description</h3><p style={{ whiteSpace: "pre-wrap" }}>{preview.dish.kitchenDescription || "No kitchen description recorded."}</p>
        {preview.quantities && <>
          <p>{preview.quantities.perBox} {preview.quantities.unit} per box × {preview.quantities.boxes} boxes = {preview.quantities.total} {preview.quantities.unit} total</p>
          <ul>{preview.quantities.components.map(item => <li key={item.id}>{item.name}: {item.perBox} {preview.quantities!.unit} per box · {item.total} {preview.quantities!.unit} total</li>)}</ul>
        </>}
      </div>}
    </>}
  </div>;
}
