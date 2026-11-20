import { useState } from "react";
import type { Dish, Menu } from "../lib/contract";
import { Button } from "./studio-ui";
import styles from "./studio.module.css";

export function StudioRecovery({
  item,
  retainedAt,
  openLatest,
}: {
  item: Menu | Dish;
  retainedAt: string | null;
  openLatest: () => Promise<void>;
}) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const text = JSON.stringify(item, null, 2);
  return (
    <section className={styles.panelBody} aria-label="Recover your edits">
      <h2>Your edits need attention</h2>
      <p>
        A newer draft was saved elsewhere. The edits shown here have not been
        saved to that draft. A copy is kept on this device when device storage
        is available.
      </p>
      <p>
        These edits started from version {item.version}.
        {retainedAt
          ? ` Last retained on this device: ${new Date(retainedAt).toLocaleString("en-GB")}.`
          : " The time of the retained copy is not available."}
      </p>
      <p>
        Open the latest saved draft to continue. Your retained copy stays on
        this device and can be found on Home.
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
