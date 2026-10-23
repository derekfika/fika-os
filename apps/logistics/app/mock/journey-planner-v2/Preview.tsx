"use client";

import { useMemo, useState } from "react";
import { JourneyPlannerShell } from "../../journey-planner/JourneyPlannerShell";
import { SCENARIOS, STATUS_FOR, scenarioModel, type Scenario } from "./fixtures";

/** Preview-only container: UI state only; no network, no persistence, no operational commands. */
export function Preview({ initialScenario = "full-day", initialRunId, hideChrome = false, initialExpandedKey }: { initialScenario?: Scenario; initialRunId?: string; hideChrome?: boolean; initialExpandedKey?: string }) {
  const [scenario, setScenario] = useState<Scenario>(initialScenario);
  const [selected, setSelected] = useState<string | undefined>(initialRunId);
  const model = useMemo(() => scenarioModel(scenario, selected), [scenario, selected]);
  return <>
    <JourneyPlannerShell model={model} status={STATUS_FOR[scenario]} showPreviewTag={!hideChrome} initialExpandedKey={initialExpandedKey}
      actions={{ onSelectRun: (id) => setSelected(id), onSelectStop: (id) => setSelected(id), onCloseInspector: () => setSelected(undefined) }} />
    {!hideChrome && <label data-preview-scenario style={{ position: "fixed", right: 12, bottom: 10, zIndex: 60, display: "flex", gap: 8, alignItems: "center", padding: "5px 11px", border: "1px solid var(--fika-border-default)", borderRadius: 999, background: "var(--fika-surface-card)", fontSize: 12, fontWeight: 600 }}>
      Fixture
      <select value={scenario} onChange={(event) => { setScenario(event.target.value as Scenario); setSelected(undefined); }} aria-label="Fixture scenario">
        {SCENARIOS.map((name) => <option key={name} value={name}>{name}</option>)}
      </select>
    </label>}
  </>;
}
