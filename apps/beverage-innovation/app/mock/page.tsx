import Prototype from "./Prototype";
import EmptyPreview from "./EmptyPreview";

// Read at request time: local /mock retains the approved fixture comparison.
export const dynamic = "force-dynamic";

export default function MockPage() {
  return process.env.FIKA_RUNTIME_MODE === "staging" ? <EmptyPreview /> : <Prototype />;
}
