import type { Dish, Menu } from "../lib/contract";
import { Button, dateRange, Icon, PageHeading, Pill } from "./studio-ui";
import styles from "./studio.module.css";

export function MenuDashboard({
  actorName,
  menus,
  dishes,
  canManage,
  create,
  openMenu,
  openList,
  openDishes,
  openCollections,
}: {
  actorName: string;
  menus: Menu[];
  dishes: Dish[];
  canManage: boolean;
  create: () => void;
  openMenu: (menu: Menu) => void;
  openList: () => void;
  openDishes: () => void;
  openCollections: () => void;
}) {
  const draft = menus
    .filter((menu) => menu.kind === "seasonal")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  const latest = [...menus, ...dishes]
    .filter((item) => item.updatedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  return (
    <>
      <div className={styles.dashboardHeading}>
        <span className={styles.heroIcon}>
          <Icon name="chef" />
        </span>
        <PageHeading
          title={"Welcome, " + actorName.split(" ")[0]}
          context={<p>Your Hospitality menus</p>}
        >
          <Button primary disabled={!canManage} onClick={create}>
            <Icon name="plus" /> New menu
          </Button>
        </PageHeading>
      </div>
      <div className={styles.dashboardGrid}>
        <section className={styles.dashboardCard}>
          <div className={styles.cardLabel}>
            <span>Seasonal menus</span>
          </div>
          <h2>Find a menu</h2>
          <p>Open a draft or view its publication history.</p>
          <Button onClick={openList}>
            View menus <Icon name="forward" />
          </Button>
        </section>
        <section className={styles.dashboardCard}>
          <div className={styles.cardLabel}>
            <span>Seasonal draft</span>
            {draft && <Pill tone="info">Draft</Pill>}
          </div>
          <h2>{draft?.name || "No draft yet"}</h2>
          <p>
            {draft
              ? dateRange(draft.startDate, draft.endDate)
              : "Create a seasonal menu to get started."}
          </p>
          <Button
            disabled={!draft && !canManage}
            onClick={() => (draft ? openMenu(draft) : create())}
          >
            {draft ? "Continue editing" : "Create seasonal menu"}{" "}
            <Icon name="forward" />
          </Button>
        </section>
      </div>
      <div className={styles.quickLinks}>
        <button type="button" onClick={openDishes}>
          <Icon name="dishes" />
          <span>
            <strong>Dish Library</strong>
            <small>{dishes.length} loaded</small>
          </span>
        </button>
        <button type="button" onClick={openCollections}>
          <Icon name="collection" />
          <span>
            <strong>Special collections</strong>
            <small>
              {menus.filter((menu) => menu.kind === "collection").length} loaded
            </small>
          </span>
        </button>
        <div>
          <Icon name="history" />
          <span>
            <strong>Recent draft activity</strong>
            <small title={latest?.name}>
              {latest?.name || "No saved drafts yet"}
            </small>
          </span>
        </div>
      </div>
    </>
  );
}
