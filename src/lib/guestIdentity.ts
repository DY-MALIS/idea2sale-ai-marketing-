const GUEST_INSTALLATION_KEY = 'aime_guest_installation_id';
const STABLE_GUEST_PREFIX = 'guest_device_';

const createInstallationId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}_${Math.random().toString(36).slice(2)}_${Math.random().toString(36).slice(2)}`;
};

export const getGuestInstallationId = () => {
  const savedId = localStorage.getItem(GUEST_INSTALLATION_KEY);
  if (savedId) return savedId;

  const installationId = createInstallationId();
  localStorage.setItem(GUEST_INSTALLATION_KEY, installationId);
  return installationId;
};

export const isStableGuestUid = (uid: string) => uid.startsWith(STABLE_GUEST_PREFIX);
