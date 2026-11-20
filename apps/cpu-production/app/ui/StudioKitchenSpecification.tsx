import type { ProductionLine, ProductionOrder } from "../../lib/production-types";
import { studioAssortmentQuantities, studioKitchenSpecError, studioKitchenSpecForLine } from "../../lib/studio-kitchen-spec";
import styles from "./StudioKitchenSpecification.module.css";

export function StudioKitchenSpecification({ order, line }: { order: ProductionOrder; line: ProductionLine }) {
  const spec = studioKitchenSpecForLine(order, line);
  if (spec === null) return <p className={styles.error} role="alert">{studioKitchenSpecError}</p>;
  if (!spec) return null;
  return (
    <div className={styles.specification} role="region" aria-label="Frozen kitchen specification">
      {spec.selections.map(selection => {
        const quantities = selection.assortment && studioAssortmentQuantities(selection.assortment);
        return (
          <div key={selection.selectionId}>
            <strong className={styles.label}>Kitchen specification · {selection.name}</strong>
            <p>Dish version {selection.subject.revision} · Menu publication {selection.publication.publicationRevision}</p>
            <p className={styles.description}>{selection.kitchenDescription}</p>
            {quantities && <>
              <p>{quantities.summary}</p>
              <ul>{quantities.components.map(component => <li key={component.id}>{component.label}</li>)}</ul>
            </>}
          </div>
        );
      })}
    </div>
  );
}
