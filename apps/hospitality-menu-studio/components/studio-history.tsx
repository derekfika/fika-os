import { useEffect, useRef, useState } from "react";
import type { DraftVersion, Menu, Publication } from "../lib/contract";
import { Breadcrumb, Button, formatDate, PageHeading, Pill } from "./studio-ui";
import styles from "./studio.module.css";
import PublishedKitchenPreview from "./published-kitchen-preview";

const savedDate = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/London",
});
const dateLabel = (value: string) => savedDate.format(new Date(value));

export function VersionHistory({
  menu,
  versions,
  history,
  historyLoaded,
  loadVersions,
  loadHistory,
  compare,
  restoreDraft,
  restorePublication,
  back,
  canManage,
  canPublish,
  busy,
  saved,
  notice,
  canPreviewPublishedKitchen,
}: {
  menu: Menu;
  versions: DraftVersion[];
  history: Publication[];
  historyLoaded: boolean;
  loadVersions: () => void;
  loadHistory: () => void;
  compare: (from: number, to: number) => Promise<string[]>;
  restoreDraft: (version: number) => void;
  restorePublication: (publicationId: string) => void;
  back: () => void;
  canManage: boolean;
  canPublish: boolean;
  busy: boolean;
  saved: boolean;
  notice: string;
  canPreviewPublishedKitchen: boolean;
}) {
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [changes, setChanges] = useState<string[] | null>(null);
  const [checking, setChecking] = useState(false);
  const [comparisonError, setComparisonError] = useState("");
  const comparison = useRef(0);
  useEffect(
    () => () => {
      comparison.current++;
    },
    [],
  );
  async function compareSelection() {
    const key = ++comparison.current;
    setChecking(true);
    setChanges(null);
    setComparisonError("");
    try {
      const result = await compare(Number(selected), menu.version);
      if (key === comparison.current) setChanges(result);
    } catch (failure) {
      if (key === comparison.current)
        setComparisonError((failure as Error).message);
    } finally {
      if (key === comparison.current) setChecking(false);
    }
  }

  return (
    <>
      <PageHeading
        title="Versions and history"
        eyebrow={
          <Breadcrumb>
            <button onClick={back}>{menu.name || "Menu overview"}</button>
            <span>/</span>
            <span>History</span>
          </Breadcrumb>
        }
        context={
          <p>
            Compare saved menu structure or restore an earlier version as a new
            draft.
          </p>
        }
      />
      <div className={styles.sectionHeading}>
        <h2>Draft versions</h2>
        <Button disabled={busy} onClick={loadVersions}>
          Load draft versions
        </Button>
      </div>
      {versions.length > 0 && (
        <>
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Version</th>
                  <th scope="col">Saved (UK time)</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {versions.map((version) => (
                  <tr key={version.version}>
                    <th scope="row">Version {version.version}</th>
                    <td>{dateLabel(version.savedAt)}</td>
                    <td>
                      {version.version === menu.version ? (
                        <Pill tone="info">Current draft</Pill>
                      ) : version.restoredFromVersion ? (
                        "Restored from version " + version.restoredFromVersion
                      ) : (
                        "Saved draft"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className={styles.panelBody}>
            <div className={styles.filterBar}>
              <label className="fika-field">
                Saved draft version
                <select
                  className="fika-select"
                  value={selected}
                  disabled={checking}
                  onChange={(event) => {
                    setSelected(event.target.value);
                    setConfirmed(false);
                    setChanges(null);
                    setComparisonError("");
                  }}
                >
                  <option value="">Select a version</option>
                  {versions
                    .filter((version) => version.version < menu.version)
                    .map((version) => (
                      <option key={version.version} value={version.version}>
                        Version {version.version} · {dateLabel(version.savedAt)}
                      </option>
                    ))}
                </select>
              </label>
              <Button
                disabled={!selected || checking || !saved}
                onClick={() => void compareSelection()}
              >
                {checking ? "Comparing…" : "Compare with current draft"}
              </Button>
            </div>
            {changes && (
              <div className={styles.summary} role="status">
                <h3>Draft comparison</h3>
                {changes.length ? (
                  <ul>
                    {changes.map((change, index) => (
                      <li key={index}>{change}</li>
                    ))}
                  </ul>
                ) : (
                  <p>No menu structure changes between these versions.</p>
                )}
                <p className="fika-help">
                  Individual dish descriptions are versioned separately.
                </p>
              </div>
            )}
            {comparisonError && <p role="alert">{comparisonError}</p>}
            <div className={styles.footerActions}>
              <label className="fika-choice">
                <input
                  type="checkbox"
                  disabled={!selected || !canManage}
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />{" "}
                Confirm replacing the current draft with this version as a new
                draft
              </label>
              <Button
                disabled={
                  busy || !canManage || !saved || !selected || !confirmed
                }
                onClick={() => restoreDraft(Number(selected))}
              >
                Restore draft version
              </Button>
            </div>
          </section>
        </>
      )}
      <div className={styles.sectionHeading}>
        <h2>Published versions</h2>
        <Button disabled={busy} onClick={loadHistory}>
          Load published history
        </Button>
      </div>
      {historyLoaded && !history.length && (
        <p className={styles.empty}>
          No published versions were returned for this menu.
        </p>
      )}
      {history.map((entry) => (
        <div className={styles.row} key={entry.id}>
          <span>
            <strong>Revision {entry.revision}</strong>
            <small>
              Effective {formatDate(entry.effectiveDate)} · Published{" "}
              {dateLabel(entry.publishedAt)}
            </small>
          </span>
          <Button
            onClick={() => restorePublication(entry.id)}
            disabled={!canPublish || !saved || busy}
          >
            Restore as new draft
          </Button>
        </div>
      ))}
      {canPreviewPublishedKitchen && (
        <PublishedKitchenPreview menuId={menu.id} publications={history} historyLoaded={historyLoaded} />
      )}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
