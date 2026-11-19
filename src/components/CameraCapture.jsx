import { useCallback, useEffect, useRef, useState } from 'react';
import { holdLock } from '../utils/autoLock';

const MAX = 1600; // longest side of the photo we send

/**
 * Full-screen camera: live preview, shutter, front/back switch, then Retake / Send.
 * onSend(blob) receives a JPEG (resized, no location data). onFallback() opens the phone's own camera app instead.
 */
export default function CameraCapture({ onSend, onClose, onFallback }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const alive = useRef(true);
  const [facing, setFacing] = useState('environment');
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState('');
  const [multi, setMulti] = useState(false);
  const [shot, setShot] = useState(null); // { blob, url }

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async (mode) => {
    stop(); setReady(false); setErr('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      if (!alive.current) { stream.getTracks().forEach((t) => t.stop()); return; }
      streamRef.current = stream;
      const v = videoRef.current;
      if (v) { v.srcObject = stream; await v.play().catch(() => {}); }
      setReady(true);
      navigator.mediaDevices.enumerateDevices()
        .then((d) => alive.current && setMulti(d.filter((x) => x.kind === 'videoinput').length > 1)).catch(() => {});
    } catch (e) {
      if (!alive.current) return;
      setErr(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
        ? 'Camera permission was denied. Allow camera access for this site in your browser settings, then try again.'
        : 'Could not open the camera on this device.');
    }
  }, [stop]);

  useEffect(() => {
    alive.current = true;
    holdLock(180000); // don't auto-lock while the camera permission prompt / camera is open
    start(facing);
    return () => { alive.current = false; stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [facing]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url); }, [shot]);

  async function snap() {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const scale = Math.min(1, MAX / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement('canvas');
    c.width = Math.round(v.videoWidth * scale);
    c.height = Math.round(v.videoHeight * scale);
    c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.85));
    if (!blob) return setErr('Could not take the photo. Please try again.');
    holdLock(180000);
    stop(); setReady(false); // release the camera while previewing
    setShot({ blob, url: URL.createObjectURL(blob) });
  }

  const btn = 'flex h-12 w-12 items-center justify-center rounded-full bg-white/15 text-white hover:bg-white/25';
  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black" role="dialog" aria-label="Camera">
      <div className="flex shrink-0 items-center justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button type="button" onClick={onClose} aria-label="Close camera" className={btn}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {multi && !shot && (
          <button type="button" onClick={() => setFacing((f) => (f === 'environment' ? 'user' : 'environment'))} aria-label="Switch camera" className={btn}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-3l-2-2H9L7 7H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1z" /><path d="M9 13a3 3 0 015-2l1 1M15 13a3 3 0 01-5 2l-1-1" /></svg>
          </button>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {err ? (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center text-white">
            <p className="max-w-xs text-sm">{err}</p>
            <div className="flex gap-2">
              {onFallback && <button type="button" onClick={onFallback} className="rounded-lg bg-wa-teal px-4 py-2 text-sm font-medium">Use phone camera app</button>}
              <button type="button" onClick={() => start(facing)} className="rounded-lg bg-white/15 px-4 py-2 text-sm">Try again</button>
            </div>
          </div>
        ) : shot ? (
          <img src={shot.url} alt="Photo preview" className="h-full w-full object-contain" />
        ) : (
          <>
            <video ref={videoRef} playsInline muted autoPlay
              className="h-full w-full object-contain" style={facing === 'user' ? { transform: 'scaleX(-1)' } : undefined} />
            {!ready && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/70">Opening camera…</div>}
          </>
        )}
      </div>

      <div className="flex shrink-0 items-center justify-center gap-10 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        {shot ? (
          <>
            <button type="button" onClick={() => { setShot(null); start(facing); }} className="rounded-full bg-white/15 px-5 py-3 text-sm font-medium text-white hover:bg-white/25">Retake</button>
            <button type="button" onClick={() => onSend(shot.blob)} className="rounded-full bg-wa-teal px-6 py-3 text-sm font-semibold text-white hover:bg-wa-dark">Send</button>
          </>
        ) : (
          <button type="button" onClick={snap} disabled={!ready || !!err} aria-label="Take photo"
            className="flex h-[72px] w-[72px] items-center justify-center rounded-full border-4 border-white disabled:opacity-40">
            <span className="h-14 w-14 rounded-full bg-white" />
          </button>
        )}
      </div>
    </div>
  );
}
