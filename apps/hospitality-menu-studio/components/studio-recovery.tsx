import { useState } from "react";
import type { Dish, Menu } from "../lib/contract";
import { formatRetainedTime, retainedDraftText } from "./studio-model";
import { Button } from "./studio-ui";
import styles from "./studio.module.css";

export function StudioRecovery({
  item,
  retainedAt,
  openLatest,
  dishes,
}: {
  item: Menu | Dish;
  retainedAt: string | null;
  openLatest: () => Promise<void>;
  dishes: Dish[];
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const text = retainedDraftText(item, dishes);
  return (
    <section className={styles.panelBody} aria-label="Recover your edits">
      <h2>Your edits need attention</h2>
      <p>
        A newer draft was saved elsewhere. These edits still need to be
        reconciled with the latest saved version.
      </p>
      <p>
        These edits started from version {item.version}.
        {retainedAt
          ? ` Last retained on this device: ${formatRetainedTime(retainedAt)}.`
          : ""}
      </p>
      <p>
        Opening the latest draft keeps a copy of these edits on this device.
        If device storage is unavailable, copy the text below before leaving.
      </p>
      <Button
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void openLatest().finally(() => setBusy(false));
        }}
      >
        Open latest saved draft
      </Button>
      <details>
        <summary>View and copy retained text</summary>
        <label htmlFor="retained-draft-text">Retained draft text</label>
        <textarea
          id="retained-draft-text"
          className="fika-textarea"
          readOnly
          value={text}
          rows={8}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button
          onClick={() => {
            void Promise.resolve()
              .then(() => navigator.clipboard.writeText(text))
              .then(
                () => setMessage("Copied."),
                () =>
                  setMessage(
                    "Select the text above and copy it using your device.",
                  ),
              );
          }}
        >
          Copy retained text
        </Button>
        <p role="status">{message}</p>
      </details>
    </section>
  );
}
