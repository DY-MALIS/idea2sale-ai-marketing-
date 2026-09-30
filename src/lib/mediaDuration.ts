// Browser media elements can leave duration as NaN/Infinity for a downloaded
// clip even when the MP4 itself is valid. Read the container's movie header
// directly so voice-over muxing can continue from the bytes already fetched.
export const mp4DurationSeconds = (bytes: Uint8Array): number | null => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const labelAt = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const scan = (start: number, end: number): number | null => {
    for (let offset = start; offset + 8 <= end;) {
      let size = view.getUint32(offset);
      const type = labelAt(offset + 4);
      let headerSize = 8;
      if (size === 1) {
        if (offset + 16 > end) return null;
        const extendedSize = Number(view.getBigUint64(offset + 8));
        if (!Number.isSafeInteger(extendedSize)) return null;
        size = extendedSize;
        headerSize = 16;
      } else if (size === 0) {
        size = end - offset;
      }
      if (size < headerSize || offset + size > end) return null;
      if (type === 'moov') {
        const duration = scan(offset + headerSize, offset + size);
        if (duration) return duration;
      }
      if (type === 'mvhd') {
        const data = offset + headerSize;
        const version = bytes[data];
        const timeScaleOffset = data + (version === 1 ? 20 : 12);
        const durationOffset = data + (version === 1 ? 24 : 16);
        if (durationOffset + (version === 1 ? 8 : 4) > offset + size) return null;
        const timeScale = view.getUint32(timeScaleOffset);
        const duration = version === 1 ? Number(view.getBigUint64(durationOffset)) : view.getUint32(durationOffset);
        if (timeScale > 0 && Number.isSafeInteger(duration) && duration > 0) return duration / timeScale;
      }
      offset += size;
    }
    return null;
  };
  return scan(0, bytes.byteLength);
};

// ffmpeg.wasm already receives the media bytes for muxing. Probe those same
// bytes when a container has no usable movie header instead of waiting for a
// browser <video>/<audio> metadata event that may never fire.
export const ffprobeDurationSeconds = async (
  ffmpeg: { ffprobe: (args: string[], timeout?: number) => Promise<number>; readFile: (path: string, encoding: 'utf8') => Promise<string | Uint8Array> },
  inputName: string,
  outputName: string,
): Promise<number | null> => {
  try {
    const code = await ffmpeg.ffprobe([
      '-v', 'error', '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1', inputName, '-o', outputName,
    ], 15000);
    if (code !== 0) return null;
    const output = await ffmpeg.readFile(outputName, 'utf8');
    const duration = Number(String(output).trim());
    return Number.isFinite(duration) && duration > 0 ? duration : null;
  } catch {
    return null;
  }
};
