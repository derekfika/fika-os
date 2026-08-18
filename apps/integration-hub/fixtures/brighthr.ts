export const brightHrFixture = {
  employees: [
    { id: "bright-synthetic-001", name: { givenName: "Alex", familyName: "North" }, email: "alex.north@example.invalid", employment: { jobTitle: "Hospitality Legend", status: "Active", location: { id: "bright-location-synthetic-001", name: "Synthetic North House" } }, _metadata: { version: "4" } },
    { id: "bright-synthetic-002", name: { givenName: "Sam", familyName: "Green" }, email: "sam.green@example.invalid", employment: { jobTitle: "Coffee Legend", status: "Terminated", terminationDate: "2026-06-30" }, _metadata: { version: "7" } },
  ],
  absences: [{ id: "absence-synthetic-001", employeeId: "bright-synthetic-001", startDate: "2026-08-03", endDate: "2026-08-04", type: "Annual leave", status: "Approved" }],
};
