/** Customer-facing RCoA offering labels and their governed canonical IDs. */
export const rcoaEventTypes = [
  { id: "breakfast", label: "Breakfast", categories: ["Drinks", "Breakfast", "Sweet treats"], noticeType: "standard" },
  { id: "lunch", label: "Lunch", categories: ["Lunch", "Lunch Boxes", "Salads & Sushi", "Grazing Boxes", "Sweet treats"], noticeType: "standard" },
  { id: "afternoon", label: "Afternoon", categories: ["Afternoon", "Sweet treats", "Finger Food", "Drinks"], noticeType: "standard" },
  { id: "meeting_hospitality", label: "Meeting hospitality", categories: ["Drinks", "Breakfast", "Lunch", "Lunch Boxes", "Salads & Sushi", "Sweet treats", "Afternoon"], noticeType: "standard" },
  { id: "finger_food", label: "Finger food", categories: ["Finger Food", "Grazing Boxes", "Sweet treats", "Drinks"], noticeType: "standard" },
  { id: "event_catering", label: "Bowl food & canapes", categories: ["Fork Buffet & Bowl Food", "Canapes", "Grazing Events", "Drinks"], noticeType: "large" },
  { id: "dining", label: "Dining", categories: ["Dining", "Drinks"], noticeType: "large" },
  { id: "bespoke", label: "Bespoke events", categories: ["Bespoke Events", "Grazing Events", "Dining"], noticeType: "large", allowsEmptyOrder: true },
] as const;

export type RcoaEventType = (typeof rcoaEventTypes)[number]["id"];
