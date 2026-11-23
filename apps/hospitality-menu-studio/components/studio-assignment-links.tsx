import type { StudioSectionLink } from "./catalogue-governance-model";
import { Button } from "./studio-ui";
import styles from "./studio.module.css";

export function StudioAssignmentLinks({
  assignments,
  open,
}: {
  assignments: StudioSectionLink[];
  open: (menuId: string, sectionId: string) => void;
}) {
  return (
    <details className={styles.disclosure}>
      <summary>Linked sections in loaded menus ({assignments.length})</summary>
      {assignments.length === 0 ? (
        <p>No linked sections were found in the loaded drafts.</p>
      ) : (
        <ul>
          {assignments.map((link) => (
            <li key={JSON.stringify([link.menuId, link.sectionId])}>
              <Button onClick={() => open(link.menuId, link.sectionId)}>
                {link.menuName} · {link.sectionName}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
