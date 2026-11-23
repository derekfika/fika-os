import { z } from "zod";
import type {
  CatalogueCommand,
  CatalogueCommandResult,
  CataloguePayload,
  CatalogueRow,
} from "./catalogue-wire";
import type { Menu, Section } from "../lib/contract";

export type StudioSectionLink = {
  menuId: string;
  menuName: string;
  sectionId: string;
  sectionName: string;
};

export function linkedStudioSections(
  menus: readonly Menu[],
  matches: (section: Section) => boolean,
): StudioSectionLink[] {
  return menus.flatMap((menu) =>
    menu.sections.filter(matches).map((section) => ({
      menuId: menu.id,
      menuName: menu.name || "Untitled menu",
      sectionId: section.id,
      sectionName: section.name || "Untitled section",
    })),
  );
}

const sitePrice = z.object({
  oplocId: z.string(),
  offeringId: z.string(),
  amount: z.number().optional(),
  vatRate: z.number().optional(),
  minimumQuantity: z.number().optional(),
});

const migration = z.discriminatedUnion("status", [
  z.object({ status: z.literal("not_needed") }),
  z.object({
    status: z.literal("uniform"),
    amount: z.number(),
    vatRate: z.number(),
    minimumQuantity: z.number().optional(),
  }),
  z.object({
    status: z.literal("operator_required"),
    reason: z.string(),
    values: z.array(sitePrice),
    minimumQuantity: z.number().optional(),
  }),
]);

export function defaultAssessment(row: CatalogueRow) {
  const result = migration.safeParse(row.priceMigration);
  return result.success ? result.data : { status: "not_needed" as const };
}

export function mergeSelection(
  payload: Pick<CataloguePayload, "rows" | "reviewGroups">,
  groupId: string,
  survivor: string,
) {
  const group = payload.reviewGroups.find(
    (candidate) => candidate.id === groupId,
  );
  if (
    !group ||
    group.memberIds.length < 2 ||
    group.memberIds.length > 11 ||
    new Set(group.memberIds).size !== group.memberIds.length ||
    !group.memberIds.includes(survivor)
  )
    return null;
  const byId = new Map(payload.rows.map((row) => [row.itemId, row]));
  const expectedVersions: Record<string, number> = {};
  for (const id of group.memberIds) {
    const row = byId.get(id);
    if (
      !row ||
      row.status !== "active" ||
      !Number.isSafeInteger(row.version) ||
      row.version < 1
    )
      return null;
    expectedVersions[id] = row.version;
  }
  return {
    action: "merge-items",
    groupId,
    survivorItemId: survivor,
    sourceItemIds: group.memberIds.filter((id) => id !== survivor),
    expectedVersions,
  } as const;
}

export function adoptionPrice(amountText: string, vatText: string) {
  if (
    !/^\d+(?:\.\d{1,2})?$/.test(amountText.trim()) ||
    !/^\d+(?:\.\d+)?$/.test(vatText.trim())
  )
    return null;
  const amount = Number(amountText);
  const vatRate = Number(vatText) / 100;
  if (!Number.isFinite(amount) || vatRate < 0 || vatRate > 1) return null;
  return { amount, vatRate };
}

export function governanceReceipt(
  command: CatalogueCommand,
  receipt: CatalogueCommandResult,
): boolean {
  switch (command.action) {
    case "link-provider-item":
    case "adopt-company-default":
      return (
        typeof command.expectedVersion === "number" &&
        Boolean(
          receipt.rows?.some(
            (row) =>
              row.itemId === command.itemId &&
              row.version > (command.expectedVersion as number),
          ),
        )
      );
    case "merge-items":
      return Boolean(
        receipt.payload?.rows.some(
          (row) =>
            row.itemId === command.survivorItemId && row.status === "active",
        ) &&
          Array.isArray(command.sourceItemIds) &&
          command.sourceItemIds.every((id) =>
            receipt.payload?.rows.some(
              (row) => row.itemId === id && row.status === "archived",
            ),
          ),
      );
    case "record-review-decision": {
      if (!Array.isArray(command.memberIds)) return false;
      const ids = new Set(command.memberIds);
      return Boolean(
        receipt.payload?.reviewGroups.some(
          (group) =>
            group.decision === command.decision &&
            group.memberIds.length === ids.size &&
            group.memberIds.every((id) => ids.has(id)),
        ),
      );
    }
    default:
      return false;
  }
}
