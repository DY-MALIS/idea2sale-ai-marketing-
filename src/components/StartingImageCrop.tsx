import React, { useEffect, useRef, useState } from 'react';

type VideoImage = { base64: string; mimeType: string };

type Props = {
  image: VideoImage;
  aspectRatio: '9:16' | '16:9';
  language: 'km' | 'en';
  onApply: (image: VideoImage) => void;
  onCancel: () => void;
};

const cropGeometry = (width: number, height: number, ratio: number, zoom: number, x: number, y: number) => {
  const baseWidth = Math.min(width, height * ratio);
  const baseHeight = baseWidth / ratio;
  const cropWidth = baseWidth / zoom;
  const cropHeight = baseHeight / zoom;
  return {
    sx: (width - cropWidth) * x / 100,
    sy: (height - cropHeight) * y / 100,
    cropWidth,
    cropHeight,
  };
};

const StartingImageCrop: React.FC<Props> = ({ image, aspectRatio, language, onApply, onCancel }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sourceRef = useRef<HTMLImageElement | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const ratio = aspectRatio === '9:16' ? 9 / 16 : 16 / 9;
  const previewWidth = aspectRatio === '9:16' ? 270 : 480;
  const previewHeight = Math.round(previewWidth / ratio);

  useEffect(() => {
    const source = new Image();
    source.onload = () => {
      sourceRef.current = source;
      setLoaded(true);
    };
    source.onerror = () => setLoaded(false);
    source.src = `data:${image.mimeType};base64,${image.base64}`;
    return () => { sourceRef.current = null; };
  }, [image]);

  useEffect(() => {
    const source = sourceRef.current;
    const canvas = canvasRef.current;
    if (!loaded || !source || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { sx, sy, cropWidth, cropHeight } = cropGeometry(source.naturalWidth, source.naturalHeight, ratio, zoom, x, y);
    ctx.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
  }, [loaded, ratio, zoom, x, y, previewWidth, previewHeight]);

  const apply = () => {
    const source = sourceRef.current;
    if (!source) return;
    const { sx, sy, cropWidth, cropHeight } = cropGeometry(source.naturalWidth, source.naturalHeight, ratio, zoom, x, y);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.min(1280, Math.round(cropWidth)));
    canvas.height = Math.max(1, Math.round(canvas.width / ratio));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(source, sx, sy, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height);
    onApply({ base64: canvas.toDataURL('image/jpeg', 0.9).split(',')[1], mimeType: 'image/jpeg' });
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-brand-200 bg-white p-4 dark:border-slate-600 dark:bg-slate-800">
      <p className="text-sm font-semibold">
        {language === 'km' ? 'កាត់រូបឲ្យនៅតែផលិតផល ឬទេសភាព មុនសាកបង្កើតវីដេអូម្តងទៀត' : 'Crop to the product or scene before trying video generation again'}
      </p>
      <canvas
        ref={canvasRef}
        width={previewWidth}
        height={previewHeight}
        role="img"
        aria-label={language === 'km' ? 'រូបភាពក្រោយកាត់' : 'Crop preview'}
        className="max-w-full rounded-lg bg-slate-100 dark:bg-slate-700"
      />
      <p className="text-xs text-slate-600 dark:text-slate-300">
        {language === 'km' ? 'ពិនិត្យរូបខាងលើឲ្យប្រាកដថាមិនមានមុខមនុស្ស។ ការកាត់រូបមិនធានាថាសេវាវីដេអូនឹងទទួលយកទេ។' : 'Check that no face remains in the preview. Cropping does not guarantee provider acceptance.'}
      </p>
      {([
        ['zoom', language === 'km' ? 'ពង្រីក' : 'Zoom', zoom, 1, 3, 0.05, setZoom],
        ['x', language === 'km' ? 'រំកិលឆ្វេង/ស្តាំ' : 'Left / right', x, 0, 100, 1, setX],
        ['y', language === 'km' ? 'រំកិលលើ/ក្រោម' : 'Up / down', y, 0, 100, 1, setY],
      ] as const).map(([key, label, value, min, max, step, setValue]) => (
        <label key={key} className="block text-xs font-medium">
          {label}
          <input className="mt-1 w-full" type="range" min={min} max={max} step={step} value={value}
            onChange={(event) => setValue(Number(event.target.value))} />
        </label>
      ))}
      <div className="flex gap-2">
        <button type="button" disabled={!loaded} onClick={apply} className="rounded-lg bg-brand-600 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50">
          {language === 'km' ? 'ប្រើរូបដែលបានកាត់' : 'Use cropped image'}
        </button>
        <button type="button" onClick={onCancel} className="rounded-lg border border-brand-300 px-3 py-2 text-sm font-semibold">
          {language === 'km' ? 'បោះបង់' : 'Cancel'}
        </button>
      </div>
    </div>
  );
};

export default StartingImageCrop;
