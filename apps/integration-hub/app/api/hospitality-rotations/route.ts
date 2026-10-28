import { db } from "@/lib/firebase-admin";
import { RotationStore } from "@/lib/hospitality-rotations/store";
import { rotationHandlers } from "@/lib/hospitality-rotations/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const { GET, POST } = rotationHandlers(new RotationStore(db));
