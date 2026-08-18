import { db } from "../lib/firebase-admin";
import { localBookingFixtures } from "../lib/local-booking-fixtures";
import { productionOrderV1Id } from "../lib/production-domain";
import { stableDocumentId } from "../lib/canonical-editor";

// Local-only cleanup for the deterministic fixture set. It is intentionally
// limited to the known fixture IDs and is safe to repeat before launch.
const batch = db.batch();
for (const booking of localBookingFixtures) {
  batch.delete(db.collection("fikaBookings").doc(booking.canonicalId));
  batch.delete(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(productionOrderV1Id(booking.canonicalId))));
}
await batch.commit();
console.log(`Removed ${localBookingFixtures.length} fixture Bookings and matching Production Orders.`);
