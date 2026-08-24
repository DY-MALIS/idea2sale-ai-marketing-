import { SchedulePost } from '../types';

const STORAGE_KEY = 'demo_scheduled_posts';

export const getStoredScheduledPosts = (): SchedulePost[] => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
};

const postIdentity = (post: SchedulePost) => [
  post.platform,
  post.scheduledTime,
  String(post.content || '').trim(),
  post.mediaUrl || post.videoUrl || post.mediaName || post.videoName || '',
].join('|');

// Remote Firestore records win when a legacy browser copy represents the same
// scheduled post. Old app versions did not set localOnly, so filtering on that
// flag hid valid July/August history after later upgrades.
export const mergeStoredScheduleHistory = (
  remotePosts: SchedulePost[],
  currentUserId: string,
) => {
  const merged = new Map<string, SchedulePost>();
  remotePosts.forEach((post) => merged.set(postIdentity(post), post));
  getStoredScheduledPosts()
    .filter((post) => !post.userId || post.userId === currentUserId || post.userId === 'demo-user')
    .forEach((post) => {
      const key = postIdentity(post);
      if (!merged.has(key)) merged.set(key, post);
    });
  return [...merged.values()];
};
