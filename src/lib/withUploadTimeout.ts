const DEFAULT_TIMEOUT_MS = 180000;
const DEFAULT_MESSAGE = 'Upload is taking too long. Please check your internet connection and try again.';

export const withUploadTimeout = async <T,>(
  promise: Promise<T>,
  message: string = DEFAULT_MESSAGE,
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<T> => {
  let timeoutId: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = window.setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) window.clearTimeout(timeoutId);
  }
};
