import { NextRequest, NextResponse } from "next/server";
import { internalTokenAllowed } from "../../../../../shared/internal-auth";
import { db } from "@/lib/firebase-admin";
import { bookingEmailStore } from "@/lib/booking-email-firestore";
import { runBookingEmailWorker } from "@/lib/booking-email-outbox";
import { isRcoaEmailTestFixture, RCOA_EMAIL_TEST_KINDS, RCOA_EMAIL_TEST_NOTIFICATION_IDS, RCOA_EMAIL_TEST_OPLOC, RCOA_EMAIL_TEST_RECIPIENT, createRcoaEmailTestFixture } from "@/lib/booking-email-test-fixture";

export const dynamic = "force-dynamic";

/** Creates fixed synthetic notification records, then exercises the normal durable Gmail worker. */
export async function POST(request: NextRequest) {
  if (!internalTokenAllowed(request)) return NextResponse.json({ error: "Internal access required." }, { status: 403 });
  if (process.env.FIKA_RUNTIME_MODE !== "production"
    || process.env.FIKA_HOSPITALITY_EMAIL_TEST_MODE_ENABLED !== "true"
    || process.env.FIKA_HOSPITALITY_EMAIL_DELIVERY_ENABLED !== "true") return new NextResponse(null, { status: 404 });

  const allowedOplocs = (process.env.FIKA_HOSPITALITY_EMAIL_ALLOWED_OPLOCS || "").split(",").map(value => value.trim()).filter(Boolean);
  const testIds = (process.env.FIKA_HOSPITALITY_EMAIL_TEST_NOTIFICATION_IDS || "").split(",").map(value => value.trim()).filter(Boolean);
  const fixedIds = Object.values(RCOA_EMAIL_TEST_NOTIFICATION_IDS);
  if (allowedOplocs.length !== 1 || allowedOplocs[0] !== RCOA_EMAIL_TEST_OPLOC
    || process.env.FIKA_HOSPITALITY_EMAIL_TEST_RECIPIENT?.trim().toLowerCase() !== RCOA_EMAIL_TEST_RECIPIENT
    || testIds.length !== fixedIds.length || fixedIds.some(id => !testIds.includes(id))) {
    return NextResponse.json({ error: "RCoA delivery test scope is not exact; no messages were queued." }, { status: 503 });
  }

  try {
    const refs = RCOA_EMAIL_TEST_KINDS.map(kind => ({ kind, ref: db.collection("fikaBookingNotifications").doc(RCOA_EMAIL_TEST_NOTIFICATION_IDS[kind]) }));
    await db.runTransaction(async transaction => {
      const snapshots = await Promise.all(refs.map(({ ref }) => transaction.get(ref)));
      for (let index = 0; index < refs.length; index++) {
        const { kind, ref } = refs[index];
        const snapshot = snapshots[index];
        if (snapshot.exists) {
          if (!isRcoaEmailTestFixture(snapshot.data() as ReturnType<typeof createRcoaEmailTestFixture>)) throw new Error("An RCoA test notification ID contains unexpected data.");
        } else {
          transaction.create(ref, createRcoaEmailTestFixture(kind));
        }
      }
    });
    const result = await runBookingEmailWorker(bookingEmailStore, 25);
    const notifications = await Promise.all(refs.map(async ({ kind, ref }) => {
      const snapshot = await ref.get();
      const record = snapshot.data();
      return { kind, status: record?.outboxStatus || "missing", attempts: Number(record?.attempts || 0) };
    }));
    return NextResponse.json({ ok: true, fixtureCount: refs.length, candidates: result.candidates, attempted: result.attempted, notifications });
  } catch (error) {
    console.error("hospitality.email.rcoa_test.failed", { errorType: error instanceof Error ? error.name : "UnknownError" });
    return NextResponse.json({ error: "RCoA delivery test failed; inspect notification attempt evidence." }, { status: 502 });
  }
}
