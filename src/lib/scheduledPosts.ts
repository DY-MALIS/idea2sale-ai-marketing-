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

export const getDemoBusinessName = (): string => {
  try {
    return String(JSON.parse(localStorage.getItem('demo_business_profile') || 'null')?.businessName || '').trim();
  } catch {
    return '';
  }
};

export const getDemoScheduledPosts = (): SchedulePost[] => {
  const businessName = getDemoBusinessName();
  return getStoredScheduledPosts().filter((post) =>
    post.userId === 'demo-user' && (businessName ? post.businessName === businessName : !post.businessName)
  );
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
  remotePosts.filter((post) => post.userId === currentUserId).forEach((post) => merged.set(postIdentity(post), post));
  getStoredScheduledPosts()
    .filter((post) => post.userId === currentUserId && !post.localOnly)
    .forEach((post) => {
      const key = postIdentity(post);
      if (!merged.has(key)) merged.set(key, post);
    });
  return [...merged.values()];
};
