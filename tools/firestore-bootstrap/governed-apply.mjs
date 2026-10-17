import {
  applyPlan,
  createBootstrapJournal,
  sourceStateHash,
  validateJournal,
  validateResumableDestination,
  verifyApprovedPlan,
  verifyFinalDestination,
} from "./engine.mjs";

export async function runGovernedApply({
  savedPlan,
  args,
  env,
  sourceInventory,
  destinationInventory,
  journal,
  journalPresent,
  adapters,
  refreshSourceInventory,
  refreshDestinationInventory,
  persistJournal,
}) {
  const plan = verifyApprovedPlan(savedPlan, args, env);
  if (sourceInventory.project !== plan.sourceProject) throw new Error("Fresh source inventory project does not match the approved plan.");
  if (sourceStateHash(sourceInventory) !== plan.sourceHash) throw new Error("Fresh source state does not match the approved source-state hash. Refusing to regenerate or apply a plan under the old approval.");

  const verifiedResume = validateResumableDestination(plan, destinationInventory);
  const existingDocuments = destinationInventory.records || [];
  if (!journalPresent && existingDocuments.length) throw new Error("Destination is partially populated but the plan-scoped journal is missing; reconcile before resuming.");

  const currentJournal = journalPresent ? journal : createBootstrapJournal(plan);
  const entries = validateJournal(currentJournal, plan);
  const approvedTargets = new Map(plan.actions.filter(action => action.action.startsWith("create")).map(action => [action.path, action]));
  for (const record of existingDocuments) {
    const path = record.path || record.name?.split("/documents/")[1];
    const action = approvedTargets.get(path);
    if (!action) throw new Error(`Destination document is not an approved target: ${path || "<missing>"}.`);
    if (!entries[path]) entries[path] = {
      path,
      sourceHash: action.sourceHash,
      targetHash: action.targetHash,
      transforms: action.transforms,
      status: "verified-existing-identical",
    };
  }

  const saveJournal = async () => persistJournal(structuredClone(currentJournal));
  await saveJournal();
  const adaptersWithJournal = {
    ...adapters,
    async saveJournal(updatedEntries) {
      currentJournal.entries = updatedEntries;
      await saveJournal();
    },
  };
  await applyPlan(plan, adaptersWithJournal, entries);

  const sourceAfter = await refreshSourceInventory();
  if (sourceAfter.project !== plan.sourceProject || sourceStateHash(sourceAfter) !== plan.sourceHash) throw new Error("Source changed during apply. The completed journal is preserved; stop and review before any retry.");
  const destinationAfter = await refreshDestinationInventory();
  const finalDestinationVerification = verifyFinalDestination(plan, destinationAfter);
  return { planHash: plan.planHash, verifiedResume, finalDestinationVerification, journal: currentJournal };
}
