// Guest UIDs are issued by the server. This prefix is only for displaying the
// account recovery warning; the browser must never derive or choose the UID.
export const isStableGuestUid = (uid: string) => uid.startsWith('guest_device_');
