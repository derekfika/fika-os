import MenuPlanningShell from "../menu-planning-shell";

export default function SettingsPage() {
  return <MenuPlanningShell section="Settings"><section className="workspace-intro"><small>Menu Planning configuration</small><h2>Settings</h2><p>Menu Planning configuration will live here.</p></section><section className="workspace-panel"><div className="empty-state"><h3>Configuration is not available yet.</h3><p>This space is reserved for genuine operational settings. No controls are exposed until they are connected to supported configuration.</p></div></section></MenuPlanningShell>;
}
