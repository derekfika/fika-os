import { useRef, useState } from "react";

export type CatalogueEditSend = (
  command: Record<string, unknown> & { action: string },
) => Promise<{ message: string }>;

export function useSiteOperation(
  send: CatalogueEditSend,
  reload: () => Promise<void>,
) {
  const active = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [conflict, setConflict] = useState(false);

  async function run(operation: () => Promise<void>) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await operation();
      setConflict(false);
    } catch (caught) {
      const detail =
        caught instanceof Error
          ? caught.message
          : "Hub did not confirm the catalogue change.";
      setError(detail);
      if (
        (caught as { status?: number } | null)?.status === 409 ||
        /changed elsewhere/i.test(detail)
      )
        setConflict(true);
    } finally {
      active.current = false;
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    message,
    conflict,
    resetFeedback: () => {
      setError("");
      setMessage("");
    },
    reset: () => {
      setError("");
      setMessage("");
      setConflict(false);
    },
    report: setError,
    submit: (command: Parameters<CatalogueEditSend>[0], onSaved: () => void) =>
      run(async () => {
        const result = await send(command);
        onSaved();
        setMessage(result.message);
      }),
    refresh: (onRefreshed: () => void) =>
      run(async () => {
        await reload();
        onRefreshed();
        setMessage("Latest Hub settings loaded.");
      }),
  };
}
