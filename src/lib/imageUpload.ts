export interface UploadedImage {
  base64: string;
  mimeType: string;
}

// Reads newly-selected files as base64 and appends them into a capped image
// list via the given setState updater, skipping files beyond the remaining
// capacity. Each file resolves independently (not batched as a single
// Promise.all), matching the incremental-append behavior the multi-image
// upload widgets already relied on.
export const readImagesIntoState = (
  files: File[],
  maxCount: number,
  currentCount: number,
  setImages: (updater: (current: UploadedImage[]) => UploadedImage[]) => void,
): void => {
  const remainingSlots = Math.max(maxCount - currentCount, 0);
  files.slice(0, remainingSlots).forEach((file) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      // onloadend fires on error/abort too, not just success -- reader.result is
      // null in those cases. Without this guard, `.split(',')` on null threw an
      // uncaught TypeError inside this event handler (not caught by React's
      // ErrorBoundary, since it's outside React's render/lifecycle), silently
      // dropping the file with zero feedback to the user.
      if (typeof reader.result !== 'string') {
        console.error('Could not read this file:', file.name);
        return;
      }
      const base64 = reader.result.split(',')[1];
      if (base64) {
        setImages((current) => (
          current.length >= maxCount ? current : [...current, { base64, mimeType: file.type }]
        ));
      }
    };
    reader.readAsDataURL(file);
  });
};
