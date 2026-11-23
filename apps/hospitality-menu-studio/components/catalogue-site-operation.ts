import { useRef, useState } from "react";
import type {
  CatalogueCommand,
  CatalogueCommandResult,
  CatalogueSend,
} from "./catalogue-wire";

function versionMap(input: unknown): Record<string, number> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  const entries = Object.entries(input);
  return entries.every(
    ([, version]) =>
      typeof version === "number" &&
      Number.isSafeInteger(version) &&
      version >= 0,
  )
    ? Object.fromEntries(entries)
    : undefined;
}

export function confirmsSiteCommand(
  receipt: CatalogueCommandResult,
  command: CatalogueCommand,
): boolean {
  if (command.action === "rename-category") {
    const payload = receipt.payload;
    const itemVersions = versionMap(command.expectedItemVersions);
    const layoutVersions = versionMap(command.expectedLayoutVersions);
    if (!payload || !itemVersions || !layoutVersions) return false;
    return (
      Object.entries(itemVersions).every(([id, version]) =>
        payload.rows.some(
          (row) =>
            row.itemId === id &&
            row.version > version &&
            row.category === command.newCategory,
        ),
      ) &&
      Object.entries(layoutVersions).every(([scope, version]) => {
        const layout = payload.serviceLayout;
        const updated =
          scope === "company" ? layout?.company : layout?.sites[scope.slice(5)];
        return Boolean(updated && updated.version > version);
      })
    );
  }
  const version = command.expectedVersion;
  if (typeof version !== "number" || !Number.isSafeInteger(version))
    return false;
  if (
    command.action === "set-site-availability" ||
    command.action === "set-site-override"
  ) {
    const row = receipt.rows?.find(
      (row) => row.itemId === command.itemId && row.version > version,
    );
    if (!row || typeof command.oplocId !== "string") return false;
    return (
      command.action === "set-site-override" ||
      row.availableAt.includes(command.oplocId) === command.available
    );
  }
  if (
    command.action !== "set-service-categories" &&
    command.action !== "clear-service-override"
  )
    return false;
  if (typeof command.serviceId !== "string") return false;
  const stored = receipt.serviceLayoutStored;
  const updated =
    typeof command.oplocId === "string"
      ? stored?.sites[command.oplocId]
      : stored?.company;
  if (!updated || updated.version <= version) return false;
  const rule = updated.services[command.serviceId];
  if (command.action === "clear-service-override")
    return typeof command.oplocId === "string" && !rule;
  const categories = command.categories;
  return Boolean(
    rule &&
      Array.isArray(categories) &&
      Boolean(rule.hidden) === Boolean(command.hidden) &&
      rule.categories.length === categories.length &&
      rule.categories.every((name, index) => name === categories[index]),
  );
}

export function useSiteOperation(
  send: CatalogueSend,
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
    submit: (command: CatalogueCommand, onSaved: () => void) =>
      run(async () => {
        const result = await send(command);
        onSaved();
        setMessage(
          result.package === "stale"
            ? result.message + " The booking catalogue is awaiting refresh."
            : result.message,
        );
      }),
    refresh: (onRefreshed: () => void) =>
      run(async () => {
        await reload();
        onRefreshed();
        setMessage("Latest Hub settings loaded.");
      }),
  };
}
