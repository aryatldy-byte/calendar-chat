import { useCallback, useEffect, useRef, useState } from 'react';
import { mmss } from '../utils/media';

// Only one voice message plays at a time
let playingAudio = null;
const RATES = [1, 1.5, 2];

/**
 * WhatsApp-style voice message player: play/pause, drag the slider to jump to ANY point (and hear from there),
 * current time / total time, and 1x / 1.5x / 2x speed.
 *
 * Why it downloads the file first: browsers can't jump around in a streamed recording whose header has no length
 * (that is what MediaRecorder produces), which is why the old player always restarted from the beginning.
 * Playing from a local copy makes seeking instant, and we work out the real length ourselves.
 */
export default function VoicePlayer({ url, knownDuration = 0 }) {
  const audioRef = useRef(null);
  const ownUrl = useRef(null);
  const [src, setSrc] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(knownDuration || 0);
  const [rate, setRate] = useState(1);
  const [failed, setFailed] = useState(false);

  // Fetch a local copy (falls back to streaming the link if the download is blocked)
  useEffect(() => {
    let off = false;
    setFailed(false);
    if (url.startsWith('blob:')) { setSrc(url); return undefined; }
    fetch(url)
      .then((r) => { if (!r.ok) throw new Error('download failed'); return r.blob(); })
      .then((b) => {
        if (off) return;
        ownUrl.current = URL.createObjectURL(b);
        setSrc(ownUrl.current);
      })
      .catch(() => { if (!off) setSrc(url); });
    return () => {
      off = true;
      if (ownUrl.current) { URL.revokeObjectURL(ownUrl.current); ownUrl.current = null; }
    };
  }, [url]);

  useEffect(() => () => {
    const a = audioRef.current;
    if (a) a.pause();
    if (playingAudio === a) playingAudio = null;
  }, []);

  const realDuration = useCallback((a) => {
    if (a && Number.isFinite(a.duration) && a.duration > 0) return a.duration;
    return knownDuration || 0;
  }, [knownDuration]);

  // Recordings often report "Infinity" as their length. Jumping to the far end once forces the browser to measure it.
  const onMeta = () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.duration === Infinity || Number.isNaN(a.duration)) {
      const fix = () => {
        a.removeEventListener('timeupdate', fix);
        a.currentTime = 0;
        setDur(realDuration(a));
      };
      a.addEventListener('timeupdate', fix);
      a.currentTime = 1e101;
    } else {
      setDur(realDuration(a));
    }
  };

  const toggle = async () => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) {
      if (playingAudio && playingAudio !== a) playingAudio.pause();
      playingAudio = a;
      a.playbackRate = rate;
      try { await a.play(); } catch (_) { setFailed(true); }
    } else {
      a.pause();
    }
  };

  const seek = (v) => {
    const a = audioRef.current;
    const t = Math.max(0, Math.min(v, dur || v));
    setCur(t);
    if (a) { try { a.currentTime = t; } catch (_) {} }
  };

  const nextRate = () => {
    const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(r);
    if (audioRef.current) audioRef.current.playbackRate = r;
  };

  if (failed) return <span className="text-xs italic text-slate-500 dark:text-slate-400">Could not play this voice message</span>;

  const total = dur || knownDuration || 0;
  return (
    // Touch events stay inside the player so dragging the slider never opens the long-press message menu
    <div className="flex w-60 max-w-full items-center gap-2" onTouchStart={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
      {src && (
        <audio
          ref={audioRef} src={src} preload="auto"
          onLoadedMetadata={onMeta}
          onDurationChange={() => { const d = realDuration(audioRef.current); if (d) setDur(d); }}
          onTimeUpdate={() => { const a = audioRef.current; if (a && a.currentTime < 1e6) setCur(a.currentTime); }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => { setPlaying(false); setCur(0); if (audioRef.current) audioRef.current.currentTime = 0; }}
          onError={() => setFailed(true)}
        />
      )}
      <button type="button" onClick={toggle} disabled={!src} aria-label={playing ? 'Pause voice message' : 'Play voice message'}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-teal text-white hover:bg-wa-dark disabled:opacity-50">
        {playing ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 001.5.9l12-7.5a1 1 0 000-1.8l-12-7.5A1 1 0 007 4.5z" /></svg>
        )}
      </button>
      <div className="min-w-0 flex-1">
        <input
          type="range" min={0} max={total || 1} step={0.1} value={Math.min(cur, total || 1)} disabled={!src || !total}
          onChange={(e) => seek(Number(e.target.value))}
          aria-label="Voice message position" aria-valuetext={`${mmss(Math.floor(cur))} of ${mmss(Math.round(total))}`}
          className="block h-6 w-full cursor-pointer accent-wa-teal disabled:opacity-60"
        />
        <div className="-mt-1 flex items-center justify-between text-[11px] tabular-nums text-slate-500 dark:text-slate-400">
          <span>{mmss(Math.floor(cur))} / {mmss(Math.round(total))}</span>
          <button type="button" onClick={nextRate} aria-label="Playback speed"
            className="rounded-full bg-black/10 px-1.5 font-semibold text-slate-700 dark:bg-white/15 dark:text-slate-200">{rate}×</button>
        </div>
      </div>
    </div>
  );
}
