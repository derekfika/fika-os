import { redirect } from "next/navigation";
import styles from "../rotations-preview/rotations-preview.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The Rotations manager now lives in Menu Planning; Hospitality only consumes published rotations. */
export default function RotationsMovedPage() {
  const menuPlanning = (process.env.FIKA_MENU_PLANNING_URL || "").trim().replace(/\/$/, "");
  if (/^https:\/\/[^/]+$/.test(menuPlanning) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(menuPlanning)) redirect(`${menuPlanning}/rotations`);
  return <main className={styles.page}><header className={styles.header}><div><p className={styles.eyebrow}>Hospitality · Menu management</p><h1>Rotations have moved</h1></div></header><section className={styles.panel} role="status"><p>Hospitality Rotations are now managed in Menu Planning under <strong>Hospitality Rotations</strong>. Published rotations continue to apply to Hospitality bookings.</p></section></main>;
}
