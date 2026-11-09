const bangkokDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
});

export const contentPlanDay = (date = new Date()) => bangkokDate.format(date);

// Quotas belong to the account that owns the plan. A generation by another
// customer must never prevent this account's scheduled item from starting.
export function selectDuePlanItems(dueDocs, generatedDocs, dailyCap, today = contentPlanDay()) {
  const usedByOwner = new Map();
  for (const doc of generatedDocs) {
    const item = doc.data();
    const started = item.completedAt || item.processingAt;
    const owner = String(item.userId || '');
    if (!owner || !started?.toDate || contentPlanDay(started.toDate()) !== today) continue;
    usedByOwner.set(owner, (usedByOwner.get(owner) || 0) + 1);
  }

  return dueDocs.filter((doc) => {
    const owner = String(doc.data()?.userId || '');
    if (!owner || (usedByOwner.get(owner) || 0) >= dailyCap) return false;
    usedByOwner.set(owner, (usedByOwner.get(owner) || 0) + 1);
    return true;
  });
}
