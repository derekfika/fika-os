import { createFirestoreMarksStore } from "./marks-firestore";

// One server-side Firestore store shared by the snapshot GET and the marks route. firebase-admin is imported lazily on first use.
export const developmentMarksStore = createFirestoreMarksStore();
