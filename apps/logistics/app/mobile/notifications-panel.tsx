import { BellIcon, ChevronRightIcon } from "./icons";
import { formatNoticeTime, type DriverNoticeItem } from "./driver-notifications-client";
import styles from "./notifications-panel.module.css";

type Props = {
  items: DriverNoticeItem[];
  unreadCount: number;
  loading: boolean;
  error: string;
  busy: boolean;
  onOpen: (item: DriverNoticeItem) => void;
  onMarkAllRead: () => void;
  onRetry: () => void;
};

export function NotificationsPanel({ items, unreadCount, loading, error, busy, onOpen, onMarkAllRead, onRetry }: Props) {
  return (
    <section className={styles.panel} aria-label="Notifications">
      <div className={styles.toolbar}>
        <p className={styles.summary} role="status" aria-live="polite">{unreadCount ? `${unreadCount} unread` : "All caught up"}</p>
        <button type="button" className={styles.markAll} disabled={!unreadCount || busy} onClick={onMarkAllRead}>Mark all read</button>
      </div>
      {error && <div className={styles.error} role="alert"><span>{error}</span><button type="button" onClick={onRetry} disabled={busy}>Retry</button></div>}
      {loading && !items.length ? <p className={styles.loading} role="status">Loading notifications…</p> : items.length ? (
        <ul className={styles.list}>
          {items.map(item => {
            const unread = !item.readAt;
            return (
              <li key={item.id}>
                <button type="button" className={`${styles.item} ${unread ? styles.unread : styles.read}`} disabled={busy} onClick={() => onOpen(item)}
                  aria-label={`${unread ? "Unread. " : ""}${item.title}. ${item.detail}. ${formatNoticeTime(item.createdAt)}.${item.priority === "high" ? " Important." : ""}`}>
                  <span className={styles.dot} aria-hidden="true" />
                  <span className={styles.text}>
                    <span className={styles.title}>{item.title}{item.priority === "high" && <span className={styles.important}>Important</span>}</span>
                    <span className={styles.detail}>{item.detail}</span>
                    <small className={styles.time}>{formatNoticeTime(item.createdAt)}</small>
                  </span>
                  <ChevronRightIcon size={20} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : !error ? (
        <div className={styles.empty}><span aria-hidden="true"><BellIcon size={24} /></span><p>No notifications yet. Changes to your run will appear here.</p></div>
      ) : null}
    </section>
  );
}
