"use client";

import { useEffect, useState } from "react";
import type { MenuSnapshot } from "@/lib/domain";

type View = "hub" | "week" | "library" | "exceptions" | "import" | "sources";

export default function HubView({ snapshot, setView, importWorkbook }: { snapshot: MenuSnapshot; setView: (view: View) => void; importWorkbook: () => void }) {
  const [sandwichCount, setSandwichCount] = useState(0);
  const [recipeCount, setRecipeCount] = useState(0);
  useEffect(() => {
    void Promise.all([fetch("/api/sandwiches", { cache: "no-store" }), fetch("/api/menu/recipes", { cache: "no-store" })]).then(async ([sandwiches, recipes]) => {
      if (sandwiches.ok) { const body = await sandwiches.json(); setSandwichCount(Array.isArray(body.sandwiches) ? body.sandwiches.length : 0); }
      if (recipes.ok) { const body = await recipes.json(); setRecipeCount(Array.isArray(body.candidates) ? body.candidates.length : 0); }
    }).catch(() => undefined);
  }, []);
  const total = snapshot.items.length + sandwichCount + recipeCount;
  const cards = [
    { icon: "◆", title: "Weekly menu planner", text: "Build the week, set each day and keep allergen decisions together.", action: "Open week planner", onClick: () => setView("week") },
    { icon: "♧", title: "Menu item library", text: "Find, edit, categorise and reuse canonical dishes, saved builds and imported recipe evidence.", count: total, action: "Open full catalogue", href: "/catalogue" },
    { icon: "✦", title: "Saved sandwiches", text: "Recall chef-owned sandwich builds and their allergen matrices.", count: sandwichCount, action: "Open saved sandwiches", href: "/sandwiches" },
    { icon: "+", title: "Create a dish", text: "Add a new chef-owned dish, recipe notes and allergen evidence.", action: "Create dish", href: "/dishes/new" },
    { icon: "◇", title: "Delivered-in menus", text: "Manage recurring delivered-in lunch plans and their daily selections.", action: "Open menu planner", onClick: () => setView("week") },
    { icon: "⇥", title: "Import menu work", text: "Bring in Brian’s workbooks as editable menu-item evidence.", count: recipeCount, action: "Import workbook", onClick: importWorkbook },
    { icon: "◌", title: "Source packs", text: "See retained menu and recipe sources behind the catalogue.", action: "View sources", onClick: () => setView("sources") },
  ];
  return <>
    <section className="menu-page-heading hub-heading"><div><small>FIKA OS · menu workspace</small><h2>Everything on the menu.</h2><p>One calm home for creating, finding and planning the dishes our teams make. Chefs own their creations — there is no extra approval step here.</p></div><div className="hub-count"><strong>{total}</strong><span>{snapshot.items.length} canonical · {sandwichCount} saved sandwiches · {recipeCount} Brian recipe sources</span></div></section>
    <section className="hub-grid" aria-label="Menu Planning tools">{cards.map(card => <article className="hub-card" key={card.title}><div className="hub-card-top"><span className="hub-card-icon" aria-hidden="true">{card.icon}</span>{card.count !== undefined && <span className="hub-count-badge">{card.count}</span>}</div><h3>{card.title}</h3><p>{card.text}</p>{card.href ? <a className="button button-purple" href={card.href}>{card.action} <span aria-hidden="true">→</span></a> : <button className="button button-purple" onClick={card.onClick}>{card.action} <span aria-hidden="true">→</span></button>}</article>)}</section>
  </>;
}
