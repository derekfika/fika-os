export type ExternalProductionMaterialisation = {
  sourceDomain: "grab-and-go" | "menu-planning";
  sourceEntityId: string;
  sourceVersion: number;
  sourceContentHash?: string;
  sourcePublicationDayId?: string;
  destinationOplocId: string;
  destinationLabel?: string;
  serviceDate: string;
  requiredBy?: string;
  serviceWindow?: { startTime: string; endTime?: string };
  status: "submitted" | "published" | "amended" | "cancelled" | "withdrawn";
  lines: Array<{
    sourceLineId: string;
    canonicalItemId?: string;
    itemName: string;
    quantity: number;
    unit: string;
    workstream?: "sandwiches" | "hospitality" | "delivered_in" | "grab_and_go" | "unassigned";
    approvedAllergenSnapshot?: {
      allergens: Record<string, string>;
      mayContainNotes?: string;
      sourcePublicationDayId?: string;
      sourceVersion?: number;
      sourceContentHash?: string;
    };
  }>;
};
