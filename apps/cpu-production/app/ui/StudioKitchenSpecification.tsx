import type { ProductionLine, ProductionOrder } from "../../lib/production-types";
import { studioKitchenQuantities, studioKitchenSpecError, studioKitchenSpecForLine } from "../../lib/studio-kitchen-spec";
import styles from "./StudioKitchenSpecification.module.css";

export function StudioKitchenSpecification({ order, line }: { order: ProductionOrder; line: ProductionLine }) {
  const spec = studioKitchenSpecForLine(order, line);
  if (spec === null) return <p className={styles.error} role="alert">{studioKitchenSpecError}</p>;
  if (!spec) return null;
  return (
    <div className={styles.specification} role="region" aria-label="Frozen kitchen specification">
      {spec.selections.map(selection => {
        const quantities = studioKitchenQuantities(selection, line.customerUnit);
        return (
          <div key={selection.selectionId}>
            <strong className={styles.label}>Kitchen specification · {selection.name}</strong>
            <p>Dish version {selection.subject.revision} · Menu publication {selection.publication.publicationRevision}</p>
            <p className={styles.description}>{selection.kitchenDescription}</p>
            {quantities && <p>{quantities.summary}</p>}
            {quantities && quantities.components.length > 0 && (
              <ul>{quantities.components.map(component => <li key={component.id}>{component.label}</li>)}</ul>
            )}
          </div>
        );
      })}
    </div>
  );
}
