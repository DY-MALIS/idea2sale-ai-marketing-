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
      const base64 = (reader.result as string).split(',')[1];
      if (base64) {
        setImages((current) => (
          current.length >= maxCount ? current : [...current, { base64, mimeType: file.type }]
        ));
      }
    };
    reader.readAsDataURL(file);
  });
};
