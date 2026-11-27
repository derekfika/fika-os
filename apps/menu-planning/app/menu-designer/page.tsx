"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MenuPlanningShell from "../menu-planning-shell";
import MenuStructureEditor from "../menu-structure-editor";
import { useMenuAccess } from "../menu-access";
import { copyMenuStructure, createBlankMenuStructure, type MenuStructureSnapshot, type MenuStructureTemplate } from "@/lib/menu-structure-library";

type MenuLibraryResponse = { templates?: MenuStructureTemplate[]; error?: { message?: string } };

export default function MenuDesignerPage() {
  const access = useMenuAccess();
  const [templates, setTemplates] = useState<MenuStructureTemplate[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [name, setName] = useState("Breakfast Service");
  const [structure, setStructure] = useState<MenuStructureSnapshot>(() => createBlankMenuStructure());
  const [baseline, setBaseline] = useState(() => JSON.stringify({ name: "Breakfast Service", structure }));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingSelection, setPendingSelection] = useState<string>();
  const [pendingHref, setPendingHref] = useState<string>();
  const dirty = JSON.stringify({ name, structure }) !== baseline;
  const activeTemplates = useMemo(() => templates.filter(template => !template.archivedAt), [templates]);
  const archivedTemplates = useMemo(() => templates.filter(template => template.archivedAt), [templates]);
  const selectedTemplate = templates.find(template => template.id === selectedId);

  const loadTemplates = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/menu-structure-library?includeArchived=1", { cache: "no-store" });
      const body = await response.json() as MenuLibraryResponse;
      if (!response.ok) throw new Error(body.error?.message || "Saved menu structures could not be loaded.");
      setTemplates(Array.isArray(body.templates) ? body.templates : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Saved menu structures could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadTemplates(); }, [loadTemplates]);
  useEffect(() => {
    if (!dirty) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    const interceptInternalNavigation = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target || target.origin !== window.location.origin || target.pathname === window.location.pathname) return;
      event.preventDefault();
      setPendingHref(target.href);
    };
    document.addEventListener("click", interceptInternalNavigation, true);
    return () => { window.removeEventListener("beforeunload", warnBeforeLeaving); document.removeEventListener("click", interceptInternalNavigation, true); };
  }, [dirty]);

  const applyTemplate = (template?: MenuStructureTemplate) => {
    const nextName = template?.name || "Breakfast Service";
    const nextStructure = template ? copyMenuStructure(template) : createBlankMenuStructure();
    setSelectedId(template?.id || "");
    setName(nextName);
    setStructure(nextStructure);
    setBaseline(JSON.stringify({ name: nextName, structure: nextStructure }));
    setNotice("");
    setError("");
  };

  const requestSelection = (id: string) => {
    if (dirty) { setPendingSelection(id); return; }
    applyTemplate(templates.find(template => template.id === id));
  };

  const save = async (action: "create" | "edit" | "duplicate" | "archive") => {
    if (busy || !access.canManage) return;
    const current = templates.find(template => template.id === selectedId);
    if ((action === "edit" || action === "archive") && !current) return;
    const saveAction = action === "edit" && !current ? "create" : action;
    if (saveAction !== "archive" && !name.trim()) { setError("Give this layout a name before saving."); return; }
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/menu-structure-library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: saveAction, ...(current && saveAction !== "create" ? { templateId: current.id, expectedVersion: current.version } : {}), name: saveAction === "duplicate" ? `Copy of ${name.trim()}` : name.trim(), structure }),
      });
      const body = await response.json() as MenuLibraryResponse;
      if (!response.ok) throw new Error(body.error?.message || "The Menu Library could not be updated.");
      const nextTemplates = Array.isArray(body.templates) ? body.templates : [];
      setTemplates(nextTemplates);
      if (saveAction === "archive") {
        applyTemplate();
        setTemplates(nextTemplates);
        setNotice(`${current!.name} was archived. Existing menu instances are unchanged.`);
      } else {
        const saved = saveAction === "duplicate"
          ? nextTemplates.find(template => !template.archivedAt && template.name === `Copy of ${name.trim()}` && template.id !== current?.id)
          : saveAction === "create" ? nextTemplates.find(template => !template.archivedAt && template.id !== selectedId && template.name === name.trim())
            : nextTemplates.find(template => template.id === current?.id);
        if (saved) applyTemplate(saved);
        setTemplates(nextTemplates);
        setNotice(saveAction === "duplicate" ? "A separate copy was added to Menu Library." : "Menu layout saved. Existing menu instances are unchanged.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The Menu Library could not be updated.");
    } finally {
      setBusy(false);
    }
  };

  const discardAndContinue = () => {
    if (pendingSelection !== undefined) {
      const id = pendingSelection;
      setPendingSelection(undefined);
      applyTemplate(templates.find(template => template.id === id));
      return;
    }
    if (pendingHref) {
      const href = pendingHref;
      setPendingHref(undefined);
      setBaseline(JSON.stringify({ name, structure }));
      window.location.assign(href);
    }
  };

  return <MenuPlanningShell section="Menu Designer">
    <section className="workspace-intro planner-intro menu-designer-intro"><small>Menu Planning · reusable layouts</small><h2>Menu Designer</h2><p>Design category and row layouts for future supplementary menus. Dates, dishes, portions, PAX, site allocations and publication details stay with each menu instance.</p></section>
    <div className="menu-designer-workspace">
      <aside className="menu-designer-library workspace-panel" aria-label="Saved menu layouts">
        <div className="menu-designer-library__heading"><div><small>Menu Library</small><h3>Saved layouts</h3></div><button type="button" className="button button-soft" disabled={!access.canManage || busy || dirty} onClick={() => applyTemplate()}>New layout</button></div>
        {loading ? <p role="status">Loading saved layouts…</p> : activeTemplates.length ? <ul>{activeTemplates.map(template => <li key={template.id}><button type="button" className={selectedId === template.id ? "menu-designer-template is-active" : "menu-designer-template"} aria-current={selectedId === template.id ? "true" : undefined} onClick={() => requestSelection(template.id)}><strong>{template.name}</strong><span>{template.categories.length} categories · {template.categories.reduce((count, category) => count + category.rows.length, 0)} rows</span></button></li>)}</ul> : <div className="menu-designer-empty"><h4>No saved layouts yet</h4><p>Create your first layout and reuse it when scheduling a supplementary menu.</p></div>}
        {archivedTemplates.length > 0 && <details className="menu-designer-archived"><summary>Archived layouts · {archivedTemplates.length}</summary><ul>{archivedTemplates.map(template => <li key={template.id}><span>{template.name}</span><small>Archived</small></li>)}</ul></details>}
      </aside>
      <section className="menu-designer-editor workspace-panel" aria-label="Menu layout editor">
        <header className="menu-designer-editor__heading"><div><small>{selectedTemplate ? `Saved layout · version ${selectedTemplate.version}` : "New reusable layout"}</small><h3>{selectedTemplate?.name || "Design a menu layout"}</h3></div>{dirty && <span className="menu-designer-unsaved" role="status">Unsaved changes</span>}</header>
        <label className="menu-designer-title"><span>Menu title</span><input className="fika-input" maxLength={100} value={name} disabled={!access.canManage || busy} onChange={event => setName(event.target.value)} /></label>
        <p className="menu-designer-guidance">Set category and row names, then reorder them by dragging or using the arrow controls. Saved layouts are copied into new menus; later edits here do not change existing menus.</p>
        <MenuStructureEditor structure={structure} onChange={setStructure} disabled={!access.canManage || busy} enableDragAndDrop />
        {error && <p className="menu-error" role="alert">{error}</p>}{notice && <p className="menu-designer-notice" role="status">{notice}</p>}
        {access.status === "unavailable" && <p className="menu-error" role="alert">Menu Planning permissions could not be verified. Changes are unavailable.</p>}
        <footer className="menu-designer-actions">
          {dirty && <button type="button" className="button button-soft" disabled={busy} onClick={() => { if (selectedTemplate) applyTemplate(selectedTemplate); else applyTemplate(); }}>Discard changes</button>}
          <button type="button" className="button button-soft" disabled={!access.canManage || busy || !selectedTemplate || dirty} onClick={() => void save("duplicate")}>Duplicate</button>
          {selectedTemplate && <button type="button" className="button button-danger" disabled={!access.canManage || busy || dirty} onClick={() => void save("archive")}>Archive</button>}
          <button type="button" className="button button-purple" disabled={!access.canManage || busy || !dirty || !name.trim()} onClick={() => void save(selectedTemplate ? "edit" : "create")}>{busy ? "Saving…" : selectedTemplate ? "Save changes" : "Save to Menu Library"}</button>
        </footer>
      </section>
    </div>
    {(pendingSelection !== undefined || pendingHref) && <div className="menu-designer-confirm-backdrop"><section className="menu-designer-confirm" role="dialog" aria-modal="true" aria-labelledby="menu-designer-confirm-title"><h3 id="menu-designer-confirm-title">Discard unsaved layout changes?</h3><p>Your edits have not been saved. Discard them to continue, or return to the designer and save first.</p><div><button type="button" className="button button-soft" onClick={() => { setPendingSelection(undefined); setPendingHref(undefined); }}>Keep editing</button><button type="button" className="button button-danger" onClick={discardAndContinue}>Discard and continue</button></div></section></div>}
  </MenuPlanningShell>;
}
