import { notFound } from "next/navigation";
import RotationsDashboardPreview from "./RotationsDashboardPreview";
import styles from "./rotations-preview.module.css";
import { isRotationsPreviewAvailable } from "../../lib/rotations-ui-access";

/** This preview must never render in a production build; the real route requires Sol's AUTHMOD gate. */
export default function RotationsPreviewPage() {
  if (!isRotationsPreviewAvailable(process.env.NODE_ENV)) notFound();
  return <RotationsDashboardPreview styles={styles} />;
}
