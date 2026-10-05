import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import ContactList from './ContactList';
import MediaBubble from './MediaBubble';
import { BUCKET, MAX_VOICE_SECS, baseType, extFor, mmss, compressImage, pickAudioType } from '../utils/media';
import { pushSupported, enablePush, disablePush, isPushEnabled, testPush } from '../utils/push';

const TTL = 5 * 60 * 1000; // a message disappears 5 minutes after the recipient has SEEN it
const FADE = 3000;         // fade-out animation starts 3s before that

const fmt = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
// Unseen messages stay; seen messages expire TTL after the server-stamped seen_at
const alive = (m) => !(m.status === 'seen' && m.seen_at) || Date.now() - new Date(m.seen_at).getTime() < TTL;

/** pending -> ✓ grey · sent/delivered (saved in Supabase) -> ✓✓ grey · seen -> ✓✓ blue */
function Ticks({ status }) {
  const double = status !== 'pending';
  const label = status === 'pending' ? 'Sending' : status === 'seen' ? 'Seen' : 'Delivered';
  return (
    <svg role="img" aria-label={label} width="18" height="12" viewBox="0 0 18 12" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      className={status === 'seen' ? 'text-[#53bdeb]' : 'text-slate-500'}>
      <path d="M1 6.5l3.5 3.5L11 2" />
      {double && <path d="M4.5 6.5l3.5 3.5L14.5 2" transform="translate(2.5 0)" />}
    </svg>
  );
}

export default function ChatWindow({ user, monthName, onBack, onSignOut }) {
  const [partners, setPartners] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [viewer, setViewer] = useState(null); // full-screen photo
  const [rec, setRec] = useState(null);        // { secs } while recording a voice message
  const fileRef = useRef(null);
  const recRef = useRef({});
  const [notif, setNotif] = useState('checking'); // checking | unsupported | off | on
  const bottom = useRef(null);
  const activeRef = useRef(null);

  // Contacts = approved users the admin has linked me with (row-level security enforces this)
  useEffect(() => {
    let stop = false;
    async function load() {
      const { data } = await supabase.from('users').select('id,email')
        .eq('approved', true).neq('id', user.id).order('email');
      if (!stop && data) setPartners(data);
    }
    load();
    const t = setInterval(load, 15000);
    return () => { stop = true; clearInterval(t); };
  }, [user.id]);

  // One contact -> open it straight away; several -> show the contact list
  const partner = partners.length === 1 ? partners[0] : partners.find((p) => p.id === activeId) || null;
  useEffect(() => { activeRef.current = partner?.id || null; }, [partner?.id]);

  const thread = partner
    ? messages.filter((m) => (m.sender_id === partner.id && m.receiver_id === user.id) ||
                             (m.sender_id === user.id && m.receiver_id === partner.id))
    : [];
  const unreadFor = (id) =>
    messages.filter((m) => m.sender_id === id && m.receiver_id === user.id && m.status !== 'seen').length;
  const goBack = () => (partner && partners.length > 1 ? setActiveId(null) : onBack());

  // Mark messages from the OPEN conversation as "seen" – only while the chat is visible
  const markSeen = useCallback(async () => {
    const from = activeRef.current;
    if (!from || document.visibilityState !== 'visible') return;
    await supabase.from('messages').update({ status: 'seen' })
      .eq('receiver_id', user.id).eq('sender_id', from).neq('status', 'seen');
  }, [user.id]);
  useEffect(() => { markSeen(); }, [partner?.id, markSeen]);

  // When the app is on screen, clear any notification + icon badge (the server push adds a running count)
  const clearAlerts = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker?.ready
      .then((reg) => reg.getNotifications({ tag: 'calendar-msg' }))
      .then((list) => list.forEach((n) => n.close()))
      .catch(() => {});
    navigator.clearAppBadge?.().catch(() => {});
  }, []);

  // Load recent messages + realtime (new messages and status changes)
  useEffect(() => {
    const since = new Date(Date.now() - TTL).toISOString();
    supabase.from('messages').select('*')
      .or(`status.neq.seen,seen_at.gt.${since}`).order('timestamp')
      .then(({ data, error }) => {
        if (error) return setError(error.message);
        setMessages(data || []);
        markSeen();
      });

    const channel = supabase.channel(`chat-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        if (m.receiver_id === user.id) { if (m.sender_id === activeRef.current) markSeen(); }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: m }) =>
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x))))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.id, markSeen]);

  // When the person comes back to the tab/app, mark as seen
  useEffect(() => {
    const onVis = () => { markSeen(); clearAlerts(); };
    clearAlerts();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [markSeen, clearAlerts]);

  // 1s ticker: drives fade-out and removes expired messages (frontend-only hiding)
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setMessages((prev) => (prev.every(alive) ? prev : prev.filter(alive)));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [thread.length, partner?.id]);

  // Notification state
  useEffect(() => {
    if (!pushSupported()) return setNotif('unsupported');
    isPushEnabled().then((on) => setNotif(on ? 'on' : 'off')).catch(() => setNotif('off'));
  }, []);

  async function toggleNotifications() {
    setError('');
    try {
      if (notif === 'unsupported') {
        setError('Notifications are not available in this browser. On iPhone: Share → Add to Home Screen, then open the app from the home screen.');
      } else if (notif === 'on') {
        await disablePush(); setNotif('off');
      } else {
        await enablePush(user.id); setNotif('on');
      }
    } catch (e) { setError(e.message); }
  }

  async function sendMedia(kind, blob, duration) {
    if (!partner) return;
    setError('');
    const tmp = `tmp-${Date.now()}`;
    const localUrl = URL.createObjectURL(blob);
    setMessages((prev) => [...prev, {
      id: tmp, sender_id: user.id, receiver_id: partner.id, type: kind, localUrl, media_path: 'pending',
      media_duration: duration || null, content: kind === 'image' ? 'Photo' : 'Voice message',
      timestamp: new Date().toISOString(), status: 'pending',
    }]);
    let path = null;
    try {
      const mime = baseType(blob.type);
      path = `${user.id}/${crypto.randomUUID()}.${extFor(mime)}`;
      const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: mime, upsert: false });
      if (up.error) throw up.error;
      const { data, error } = await supabase.from('messages').insert({
        sender_id: user.id, receiver_id: partner.id, type: kind, media_path: path,
        media_duration: duration || null, content: kind === 'image' ? 'Photo' : 'Voice message',
      }).select().single();
      if (error) throw error;
      setMessages((prev) => {
        const rest = prev.filter((m) => m.id !== tmp);
        return rest.some((x) => x.id === data.id)
          ? rest.map((x) => (x.id === data.id ? { ...x, localUrl } : x))
          : [...rest, { ...data, localUrl }];
      });
    } catch (e) {
      if (path) supabase.storage.from(BUCKET).remove([path]);
      setMessages((prev) => prev.filter((m) => m.id !== tmp));
      setError(e.message || 'Upload failed');
    }
  }

  async function pickImage(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Please choose an image.');
    try { await sendMedia('image', await compressImage(file)); } catch (err) { setError(err.message); }
  }

  async function startRec() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return setError('Voice recording is not supported in this browser.');
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const type = pickAudioType();
      const mr = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      const r = recRef.current;
      Object.assign(r, { mr, chunks: [], cancelled: false, start: Date.now() });
      mr.ondataavailable = (ev) => { if (ev.data.size) r.chunks.push(ev.data); };
      mr.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        clearInterval(r.timer);
        setRec(null);
        const secs = Math.round((Date.now() - r.start) / 1000);
        const blob = new Blob(r.chunks, { type: mr.mimeType || type || 'audio/webm' });
        if (!r.cancelled && secs >= 1 && blob.size > 0) sendMedia('voice', blob, secs);
      };
      mr.start();
      setRec({ secs: 0 });
      r.timer = setInterval(() => {
        const secs = Math.floor((Date.now() - r.start) / 1000);
        setRec({ secs });
        if (secs >= MAX_VOICE_SECS && mr.state === 'recording') mr.stop();
      }, 500);
    } catch (_) {
      setError('Microphone access was denied or is unavailable.');
    }
  }

  const stopRec = (cancel = false) => {
    const r = recRef.current;
    r.cancelled = cancel;
    if (r.mr && r.mr.state === 'recording') r.mr.stop();
  };
  // Leaving the chat while recording discards the recording
  useEffect(() => () => stopRec(true), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!partner) stopRec(true); }, [partner?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function runTest() {
    setError(''); setNotice('Sending test…');
    try {
      const r = await testPush();
      if (r.ok) setNotice(r.text); else { setNotice(''); setError(r.text); }
    } catch (e) { setNotice(''); setError(e.message); }
  }

  async function send(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content || !partner) return;
    setText(''); setError('');

    // Optimistic message: single grey tick until Supabase confirms it
    const tmp = `tmp-${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: tmp, sender_id: user.id, receiver_id: partner.id, content,
      timestamp: new Date().toISOString(), status: 'pending',
    }]);

    const { data, error } = await supabase.from('messages')
      .insert({ sender_id: user.id, receiver_id: partner.id, content }).select().single();
    if (error) {
      setMessages((prev) => prev.filter((m) => m.id !== tmp));
      setError(error.message); setText(content);
      return;
    }
    setMessages((prev) => {
      const rest = prev.filter((m) => m.id !== tmp);
      return rest.some((x) => x.id === data.id) ? rest : [...rest, data];
    });
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex shrink-0 items-center gap-2 bg-wa-dark px-3 py-2.5 text-white shadow">
        <button onClick={goBack} aria-label="Back" className="rounded-full p-2 hover:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{partner ? partner.email : monthName}</div>
          <div className="truncate text-xs text-white/70">{partner ? monthName : 'Chats'}</div>
        </div>
        <button onClick={toggleNotifications} disabled={notif === 'checking'}
          aria-label={notif === 'on' ? 'Turn notifications off' : 'Turn notifications on'}
          title={notif === 'on' ? 'Notifications on' : 'Notifications off'}
          className="rounded-full p-2 hover:bg-white/10 disabled:opacity-50">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" />
            {notif !== 'on' && <path d="M3 3l18 18" />}
          </svg>
        </button>
        {notif === 'on' && (
          <button onClick={runTest} className="rounded-full px-2 py-1 text-xs text-white/80 hover:bg-white/10">Test</button>
        )}
        <button onClick={onSignOut} className="rounded-full px-3 py-1 text-xs text-white/80 hover:bg-white/10">Sign out</button>
      </header>

      {!partner ? (
        <ContactList partners={partners} unreadFor={unreadFor} onOpen={setActiveId} />
      ) : (
        <>
      <main className="wa-pattern flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
          <p className="mx-auto mb-2 rounded-lg bg-amber-100 px-3 py-1 text-center text-xs text-amber-900">
            Messages disappear 5 minutes after they are seen.
          </p>
          {thread.map((m) => {
            const mine = m.sender_id === user.id;
            const fading = m.status === 'seen' && m.seen_at && now - new Date(m.seen_at).getTime() >= TTL - FADE;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={
                  'max-w-[80%] rounded-lg px-3 py-1.5 text-[15px] shadow-sm ' +
                  (mine ? 'rounded-tr-none bg-wa-bubble text-slate-900' : 'rounded-tl-none bg-gray-200 text-slate-900') +
                  (fading ? ' animate-fadeout' : '')
                }>
                  {m.type && m.type !== 'text' ? (
                    <>
                      <MediaBubble m={m} onOpen={setViewer} />
                      <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-500">
                        {fmt(m.timestamp)}
                        {mine && <Ticks status={m.status || 'sent'} />}
                      </div>
                    </>
                  ) : (
                    <>
                      <span className="whitespace-pre-wrap break-words">{m.content}</span>
                      <span className="ml-2 inline-flex translate-y-1 items-center gap-1 align-bottom text-[11px] text-slate-500">
                        {fmt(m.timestamp)}
                        {mine && <Ticks status={m.status || 'sent'} />}
                      </span>
                    </>
                  )}
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
      </main>

        </>
      )}

      {notice && !error && <div className="shrink-0 bg-emerald-50 px-4 py-1 text-center text-xs text-emerald-800">{notice}</div>}
      {error && <div className="shrink-0 bg-red-50 px-4 py-1 text-center text-xs text-red-700">{error}</div>}

      {partner && (
      <form onSubmit={send} className="shrink-0 bg-slate-100 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-2xl items-center gap-2">
          {rec ? (
            <>
              <button type="button" onClick={() => stopRec(true)} aria-label="Cancel recording"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white text-red-600 shadow-sm hover:bg-red-50">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
              </button>
              <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-4 py-2.5 shadow-sm">
                <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                <span className="text-sm tabular-nums text-slate-700">{mmss(rec.secs)}</span>
                <span className="text-xs text-slate-400">Recording…</span>
              </div>
              <button type="button" onClick={() => stopRec(false)} aria-label="Send voice message"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-wa-teal text-white hover:bg-wa-dark">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 20.5l19-8.5-19-8.5v6.6l13 1.9-13 1.9z" /></svg>
              </button>
            </>
          ) : (
            <>
              <button type="button" onClick={() => fileRef.current?.click()} aria-label="Send a photo"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-slate-600 hover:bg-slate-200">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
              </button>
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={2000}
                placeholder="Type a message"
                className="min-w-0 flex-1 rounded-full bg-white px-4 py-2.5 shadow-sm focus:outline-none focus:ring-2 focus:ring-wa-teal"
              />
              {text.trim() ? (
                <button type="submit" aria-label="Send" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-wa-teal text-white hover:bg-wa-dark">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 20.5l19-8.5-19-8.5v6.6l13 1.9-13 1.9z" /></svg>
                </button>
              ) : (
                <button type="button" onClick={startRec} aria-label="Record a voice message"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-wa-teal text-white hover:bg-wa-dark">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v4" /></svg>
                </button>
              )}
            </>
          )}
        </div>
      </form>
      )}
      {viewer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4" onClick={() => setViewer(null)}>
          <button aria-label="Close" className="absolute right-4 top-4 rounded-full p-2 text-2xl leading-none text-white hover:bg-white/10">×</button>
          <img src={viewer} alt="Photo" className="max-h-full max-w-full object-contain" />
        </div>
      )}
    </div>
  );
}
