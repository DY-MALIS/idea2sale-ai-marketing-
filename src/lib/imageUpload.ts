export interface UploadedImage {
  base64: string;
  mimeType: string;
}

interface ImageReadOptions {
  maxDimension?: number;
  outputType?: 'image/jpeg' | 'image/webp';
  quality?: number;
}

const optimizedImageDataUrl = async (file: File, options: ImageReadOptions): Promise<string> => {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error(`Could not decode ${file.name}.`));
      element.src = sourceUrl;
    });
    const maxDimension = Math.max(320, options.maxDimension || 1280);
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image resizing is unavailable in this browser.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL(options.outputType || 'image/webp', options.quality ?? 0.82);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
};

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
  options: ImageReadOptions = {},
): void => {
  const remainingSlots = Math.max(maxCount - currentCount, 0);
  files.slice(0, remainingSlots).forEach((file) => {
    if (!file.type.startsWith('image/')) {
      console.error('Unsupported image file:', file.name);
      return;
    }
    if (options.maxDimension) {
      void optimizedImageDataUrl(file, options).then((dataUrl) => {
        const [metadata, base64] = dataUrl.split(',', 2);
        const mimeType = metadata.match(/^data:([^;]+);base64$/)?.[1];
        if (!base64 || !mimeType) return;
        setImages((current) => (
          current.length >= maxCount ? current : [...current, { base64, mimeType }]
        ));
      }).catch((error) => console.error('Could not optimize this image:', file.name, error));
      return;
    }
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
