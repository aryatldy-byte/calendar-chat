export const BUCKET = 'chat-media';
export const MAX_VOICE_SECS = 120;

export const baseType = (t = '') => t.split(';')[0];
export const extFor = (t) =>
  ({ 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'image/jpeg': 'jpg' }[baseType(t)] || 'bin');
export const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** Resize to max 1600px and re-encode as JPEG (smaller upload; also strips EXIF/GPS metadata). */
export async function compressImage(file, max = 1600, quality = 0.82) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    if (!blob) throw new Error('Could not process that image.');
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function pickAudioType() {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus']
    .find((t) => MediaRecorder.isTypeSupported(t)) || '';
}
