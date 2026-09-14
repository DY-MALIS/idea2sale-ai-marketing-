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

// Demo Mode's synthetic 'demo-user' id isn't tied to any real identity, so on a
// shared/handed-down browser a *different* person signing into their own real
// account would otherwise inherit whatever an earlier, unrelated demo session
// left in localStorage (see mergeStoredScheduleHistory below). Gate that
// carry-over on sessionStorage, which -- unlike localStorage -- clears when the
// tab/browser closes, so it only survives the intended "tried the demo, then
// signed up in the same session" flow, not a demo session from days ago on a
// public computer.
const DEMO_SESSION_KEY = 'was_demo_mode_this_session';

export const markDemoModeSession = () => {
  try {
    sessionStorage.setItem(DEMO_SESSION_KEY, '1');
  } catch {
    // sessionStorage unavailable (private browsing, etc) -- carry-over simply won't apply.
  }
};

export const wasDemoModeThisSession = (): boolean => {
  try {
    return sessionStorage.getItem(DEMO_SESSION_KEY) === '1';
  } catch {
    return false;
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
  const demoCarryOverAllowed = wasDemoModeThisSession();
  const merged = new Map<string, SchedulePost>();
  remotePosts.forEach((post) => merged.set(postIdentity(post), post));
  getStoredScheduledPosts()
    .filter((post) => !post.userId || post.userId === currentUserId || (post.userId === 'demo-user' && demoCarryOverAllowed))
    .forEach((post) => {
      const key = postIdentity(post);
      if (!merged.has(key)) merged.set(key, post);
    });
  return [...merged.values()];
};
