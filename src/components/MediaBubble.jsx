import { useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import { BUCKET, mmss } from '../utils/media';

export default function MediaBubble({ m, onOpen }) {
  const [url, setUrl] = useState(m.localUrl || null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (m.localUrl || !m.media_path) return;
    let off = false;
    supabase.storage.from(BUCKET).createSignedUrl(m.media_path, 3600).then(({ data, error }) => {
      if (off) return;
      if (error || !data) setFailed(true); else setUrl(data.signedUrl);
    });
    return () => { off = true; };
  }, [m.media_path, m.localUrl]);

  if (!m.media_path && !m.localUrl) return <span className="text-xs italic text-slate-500">Media no longer available</span>;
  if (failed) return <span className="text-xs italic text-slate-500">Media unavailable</span>;
  if (!url) return <div className={`animate-pulse rounded-md bg-slate-300 ${m.type === 'image' ? 'h-40 w-52' : 'h-10 w-56'}`} />;

  if (m.type === 'image') {
    return (
      <button type="button" onClick={() => onOpen(url)} className="block" aria-label="Open photo">
        <img src={url} alt="Photo" className="max-h-72 w-full max-w-[16rem] rounded-md object-cover" />
      </button>
    );
  }
  return (
    <div className="flex items-center gap-2">
      <audio controls preload="metadata" src={url} className="h-10 w-56 max-w-full" />
      {m.media_duration ? <span className="text-[11px] text-slate-500">{mmss(m.media_duration)}</span> : null}
    </div>
  );
}
