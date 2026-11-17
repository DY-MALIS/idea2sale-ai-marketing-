// Retire approval holds without unexpectedly publishing overdue drafts.
// Future posts keep their scheduled time; overdue posts require rescheduling.
export async function releaseApprovalHeldPosts(db, now = Date.now()) {
  let released = 0;
  let overdue = 0;
  const statuses = ['AWAITING_DUE', 'AWAITING_LINK', 'REQUESTED', 'REQUESTING', 'SEND_FAILED', 'SEND_UNCERTAIN', 'GROUP_PENDING'];
  for (const approvalStatus of statuses) {
    const snapshot = await db.collection('scheduled_posts').where('approvalStatus', '==', approvalStatus).get();
    for (const doc of snapshot.docs) {
      const post = doc.data();
      if (post?.approvalRequired !== true || !['PENDING', 'AWAITING_APPROVAL'].includes(post.status)) continue;
      const outcome = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        const data = fresh.data();
        if (data?.approvalRequired !== true || !['PENDING', 'AWAITING_APPROVAL'].includes(data.status)) return null;
        const dueAt = new Date(data.scheduledTime).getTime();
        const isFuture = Number.isFinite(dueAt) && dueAt > now;
        tx.update(doc.ref, isFuture
          ? { status: 'PENDING', approvalRequired: false, approvalStatus: 'BYPASSED' }
          : { status: 'FAILED', approvalRequired: false, approvalStatus: 'BYPASSED', errorMessage: 'This older post is overdue. Reschedule it to publish without Telegram approval.' });
        return isFuture ? 'released' : 'overdue';
      });
      if (outcome === 'released') released += 1;
      if (outcome === 'overdue') overdue += 1;
    }
  }
  return { released, overdue };
}
