import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import ContactList from './ContactList';
import MessageBubble, { previewOf } from './MessageBubble';
import MessageMenu from './MessageMenu';
import SettingsSheet from './SettingsSheet';
import { BUCKET, MAX_VOICE_SECS, baseType, extFor, mmss, compressImage, pickAudioType } from '../utils/media';
import { pushSupported, enablePush, disablePush, isPushEnabled, testPush } from '../utils/push';
import { useSettings } from '../utils/settings';
import { usePresence } from '../utils/presence';
import { holdLock } from '../utils/autoLock';
import { TTL, EDIT_WINDOW } from '../utils/constants';
import { lastSeenText } from '../utils/format';

// Unseen messages stay; seen messages expire TTL after the server-stamped seen_at; deleted ones vanish after TTL too
const alive = (m) => {
  if (m.deleted_at) return Date.now() - new Date(m.deleted_at).getTime() < TTL;
  return !(m.status === 'seen' && m.seen_at) || Date.now() - new Date(m.seen_at).getTime() < TTL;
};

const iconBtn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full';

export default function ChatWindow({ user, monthName, onBack, onLock, onSignOut }) {
  const [settings, updateSettings, settingsLoaded] = useSettings();
  const [partners, setPartners] = useState([]);
  const [pairs, setPairs] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState({}); // { [messageId]: { [userId]: emoji } }
  const [text, setText] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [editing, setEditing] = useState(null);
  const [menuId, setMenuId] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [notif, setNotif] = useState('checking'); // checking | unsupported | off | on
  const [viewer, setViewer] = useState(null);     // full-screen photo
  const [nudgeFrom, setNudgeFrom] = useState(null); // partner id who just pinged me
  const [coolUntil, setCoolUntil] = useState(0);
  const [rec, setRec] = useState(null);           // { secs } while recording a voice message
  const bottom = useRef(null);
  const activeRef = useRef(null);
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const recRef = useRef({});
  const typingRef = useRef({ last: 0, timer: null });

  // Contacts = approved users the admin has linked me with (row-level security enforces this)
  useEffect(() => {
    let stop = false;
    async function load() {
      const [u, p] = await Promise.all([
        supabase.from('users').select('id,email,last_seen_at').eq('approved', true).neq('id', user.id).order('email'),
        supabase.from('pairings').select('id,user_a,user_b'),
      ]);
      if (stop) return;
      if (u.data) setPartners(u.data);
      if (p.data) setPairs(p.data.map((x) => ({ id: x.id, partnerId: x.user_a === user.id ? x.user_b : x.user_a })));
    }
    load();
    const t = setInterval(load, 15000);
    return () => { stop = true; clearInterval(t); };
  }, [user.id]);

  // One contact -> open it straight away; several -> show the contact list
  const partner = partners.length === 1 ? partners[0] : partners.find((p) => p.id === activeId) || null;
  const partnerName = partner ? partner.email.split('@')[0] : '';
  useEffect(() => { activeRef.current = partner?.id || null; }, [partner?.id]);

  const onNudge = useCallback((pid) => {
    setNudgeFrom(pid);
    navigator.vibrate?.([200, 100, 200]);
    setTimeout(() => setNudgeFrom((cur) => (cur === pid ? null : cur)), 6000);
  }, []);
  const { online, typing, sendTyping, sendNudge } = usePresence(
    user.id, pairs.filter((p) => partners.some((x) => x.id === p.partnerId)), settings.shareStatus, onNudge);

  // Record my own "last seen" (null when I've chosen to hide it)
  useEffect(() => {
    if (!settingsLoaded) return undefined;
    const touch = () => supabase.rpc('touch_last_seen', { share: settings.shareStatus }).then(() => {}, () => {});
    touch();
    const t = setInterval(() => { if (document.visibilityState === 'visible') touch(); }, 45000);
    document.addEventListener('visibilitychange', touch); // also records the moment I leave
    window.addEventListener('pagehide', touch);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', touch); window.removeEventListener('pagehide', touch); };
  }, [settingsLoaded, settings.shareStatus]);

  const thread = partner
    ? messages.filter((m) => (m.sender_id === partner.id && m.receiver_id === user.id) ||
                             (m.sender_id === user.id && m.receiver_id === partner.id))
    : [];
  const unreadFor = (id) =>
    messages.filter((m) => m.sender_id === id && m.receiver_id === user.id && m.status !== 'seen' && !m.deleted_at).length;
  const goBack = () => (partner && partners.length > 1 ? setActiveId(null) : onBack());

  // Mark messages from the OPEN conversation as "seen" – only while the chat is visible
  const markSeen = useCallback(async () => {
    const from = activeRef.current;
    if (!from || document.visibilityState !== 'visible') return;
    await supabase.from('messages').update({ status: 'seen' })
      .eq('receiver_id', user.id).eq('sender_id', from).neq('status', 'seen');
  }, [user.id]);
  useEffect(() => { markSeen(); }, [partner?.id, markSeen]);

  // When the app is on screen, clear any notification + icon badge
  const clearAlerts = useCallback(() => {
    if (document.visibilityState !== 'visible') return;
    navigator.serviceWorker?.ready
      .then((reg) => reg.getNotifications({ tag: 'calendar-msg' }))
      .then((list) => list.forEach((n) => n.close()))
      .catch(() => {});
    navigator.clearAppBadge?.().catch(() => {});
  }, []);

  const applyReaction = useCallback((r) =>
    setReactions((prev) => ({ ...prev, [r.message_id]: { ...(prev[r.message_id] || {}), [r.user_id]: r.emoji } })), []);

  // Load recent messages + realtime (messages, status changes, edits, deletions, reactions)
  useEffect(() => {
    const since = new Date(Date.now() - TTL).toISOString();
    supabase.from('messages').select('*')
      .or(`status.neq.seen,seen_at.gt.${since}`).order('timestamp')
      .then(async ({ data, error }) => {
        if (error) return setError(error.message);
        setMessages(data || []);
        markSeen();
        const ids = (data || []).map((m) => m.id);
        if (ids.length) {
          const r = await supabase.from('message_reactions').select('*').in('message_id', ids);
          (r.data || []).forEach(applyReaction);
        }
      });

    const channel = supabase.channel(`chat-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) => {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
        if (m.receiver_id === user.id && m.sender_id === activeRef.current) markSeen();
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: m }) =>
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x))))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'message_reactions' }, ({ new: r }) => applyReaction(r))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'message_reactions' }, ({ new: r }) => applyReaction(r))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.id, markSeen, applyReaction]);

  // Back on screen: mark seen + clear notifications
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

  // Notifications
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

  async function runTest() {
    setShowSettings(false); setError(''); setNotice('Sending test…');
    try {
      const r = await testPush();
      if (r.ok) setNotice(r.text); else { setNotice(''); setError(r.text); }
    } catch (e) { setNotice(''); setError(e.message); }
  }

  // ---------- typing indicator ----------
  const stopTyping = () => {
    const t = typingRef.current;
    clearTimeout(t.timer); t.last = 0;
    if (partner) sendTyping(partner.id, false);
  };
  function onType(v) {
    setText(v);
    if (!partner || editing) return;
    const t = typingRef.current;
    const n = Date.now();
    if (v && n - t.last > 2500) { t.last = n; sendTyping(partner.id, true); }
    clearTimeout(t.timer);
    t.timer = setTimeout(() => { t.last = 0; sendTyping(partner.id, false); }, 3000);
  }

  // ---------- sending text (new, reply, edit) ----------
  async function send(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content || !partner) return;
    setText(''); setError('');
    stopTyping();

    if (editing) {
      const ed = editing;
      setEditing(null);
      if (content === ed.content) return;
      const { data, error } = await supabase.from('messages').update({ content }).eq('id', ed.id).select();
      if (error || !data?.length) {
        setError(error?.message || 'Could not edit the message.'); setText(content); setEditing(ed);
      } else {
        setMessages((prev) => prev.map((m) => (m.id === ed.id ? { ...m, ...data[0] } : m)));
      }
      return;
    }

    const reply_to = replyTo && !String(replyTo.id).startsWith('tmp-') ? replyTo.id : null;
    setReplyTo(null);
    const tmp = `tmp-${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: tmp, sender_id: user.id, receiver_id: partner.id, content, type: 'text', reply_to,
      timestamp: new Date().toISOString(), status: 'pending',
    }]);
    const { data, error } = await supabase.from('messages')
      .insert({ sender_id: user.id, receiver_id: partner.id, content, reply_to }).select().single();
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

  // ---------- photos & voice ----------
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
    holdLock((MAX_VOICE_SECS + 30) * 1000); // don't auto-lock mid-recording
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
  useEffect(() => () => stopRec(true), []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!partner) stopRec(true); }, [partner?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- message actions ----------
  const menuMsg = menuId ? messages.find((m) => m.id === menuId) : null;
  const canEdit = (m) => m.type === 'text' && !m.deleted_at && Date.now() - new Date(m.timestamp).getTime() < EDIT_WINDOW;

  async function react(m, emoji) {
    setMenuId(null);
    if (String(m.id).startsWith('tmp-')) return;
    const mine = reactions[m.id]?.[user.id] || '';
    const next = mine === emoji ? '' : emoji;
    applyReaction({ message_id: m.id, user_id: user.id, emoji: next });
    const { error } = await supabase.from('message_reactions')
      .upsert({ message_id: m.id, user_id: user.id, emoji: next }, { onConflict: 'message_id,user_id' });
    if (error) { applyReaction({ message_id: m.id, user_id: user.id, emoji: mine }); setError(error.message); }
  }

  function startReply(m) {
    setMenuId(null); setEditing(null); setReplyTo(m);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  function startEdit(m) {
    setMenuId(null); setReplyTo(null); setEditing(m); setText(m.content);
    setTimeout(() => inputRef.current?.focus(), 50);
  }

  async function copyText(m) {
    setMenuId(null);
    try { await navigator.clipboard.writeText(m.content); setNotice('Copied.'); setTimeout(() => setNotice(''), 1500); } catch (_) {}
  }

  async function deleteForEveryone(m) {
    setMenuId(null);
    if (!confirm('Delete this message for everyone?')) return;
    if (m.media_path) await supabase.storage.from(BUCKET).remove([m.media_path]);
    const { data, error } = await supabase.from('messages')
      .update({ deleted_at: new Date().toISOString(), content: '', media_path: null }).eq('id', m.id).select();
    if (error || !data?.length) setError(error?.message || 'Could not delete the message.');
    else setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...data[0] } : x)));
  }

  // "Seen" time under my most recent message that the other person has opened
  const lastSeenMine = [...thread].reverse().find((m) => m.sender_id === user.id && m.status === 'seen' && m.seen_at && !m.deleted_at);

  const coolLeft = Math.max(0, Math.ceil((coolUntil - now) / 1000));
  async function nudge() {
    if (!partner || coolLeft > 0) return;
    setError(''); setNotice('');
    try {
      const { data: sess } = await supabase.auth.getSession();
      const r = await fetch('/api/nudge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${sess.session?.access_token}` },
        body: JSON.stringify({ partnerId: partner.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (r.status === 429) { setCoolUntil(Date.now() + 60000); return setError(j.error); }
      if (!r.ok && r.status < 500) return setError(j.error || 'Could not send.');
      sendNudge(partner.id); // instant in-app ping if they have the chat open
      setCoolUntil(Date.now() + 60000);
      setNotice(r.ok && j.sent ? 'Notified.' : 'Pinged. (Their phone has notifications off.)');
      setTimeout(() => setNotice(''), 2500);
    } catch (e) { setError(e.message); }
  }

  const partnerLastSeen = partner ? (partners.find((p) => p.id === partner.id)?.last_seen_at || '') : '';
  const subtitle = partner
    ? (typing[partner.id] ? 'typing…' : online[partner.id] ? 'online' : lastSeenText(partnerLastSeen) || monthName)
    : 'Chats';

  return (
    <div className="flex h-[100dvh] flex-col bg-white dark:bg-[#0b141a]">
      <header className="flex shrink-0 items-center gap-1 bg-wa-dark px-2 py-2.5 text-white shadow dark:bg-[#1f2c34]">
        <button onClick={goBack} aria-label="Back" className="rounded-full p-2 hover:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="min-w-0 flex-1 px-1">
          <div className="truncate font-semibold">{partner ? partner.email : monthName}</div>
          <div className={`truncate text-xs ${partner && (typing[partner.id] || online[partner.id]) ? 'text-wa-green' : 'text-white/70'}`}>{subtitle}</div>
        </div>
        {partner && (
          <button onClick={nudge} disabled={coolLeft > 0} aria-label="Let them know I'm online" title="Let them know I'm online"
            className="flex items-center gap-1 rounded-full p-2 hover:bg-white/10 disabled:opacity-60">
            <span className="text-lg leading-none">👋</span>
            {coolLeft > 0 && <span className="text-[10px] tabular-nums">{coolLeft}</span>}
          </button>
        )}
        <button onClick={toggleNotifications} disabled={notif === 'checking'}
          aria-label={notif === 'on' ? 'Turn notifications off' : 'Turn notifications on'}
          title={notif === 'on' ? 'Notifications on' : 'Notifications off'}
          className="rounded-full p-2 hover:bg-white/10 disabled:opacity-50">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" />
            {notif !== 'on' && <path d="M3 3l18 18" />}
          </svg>
        </button>
        <button onClick={onLock} aria-label="Lock now" title="Lock now" className="rounded-full p-2 hover:bg-white/10">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
        </button>
        <button onClick={() => setShowSettings(true)} aria-label="Settings" className="rounded-full p-2 hover:bg-white/10">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>
        </button>
      </header>

      {!partner ? (
        <ContactList partners={partners} unreadFor={unreadFor} online={online} typing={typing} onOpen={setActiveId} />
      ) : (
        <main className="wa-pattern flex-1 overflow-y-auto px-3 py-4">
          <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
            <p className="mx-auto mb-2 rounded-lg bg-amber-100 px-3 py-1 text-center text-xs text-amber-900 dark:bg-[#1f2c34] dark:text-amber-200">
              Messages disappear 5 minutes after they are seen. Long-press a message for options.
            </p>
            {thread.map((m) => {
              const rx = Object.values(reactions[m.id] || {}).filter(Boolean);
              return (
                <MessageBubble key={m.id} m={m} mine={m.sender_id === user.id} partnerName={partnerName}
                  orig={m.reply_to ? messages.find((x) => x.id === m.reply_to) : null}
                  seenAt={lastSeenMine && lastSeenMine.id === m.id ? m.seen_at : null}
                  rx={rx} now={now} onMenu={(x) => setMenuId(x.id)} onView={setViewer} />
              );
            })}
            <div ref={bottom} />
          </div>
        </main>
      )}

      {nudgeFrom && (
        <div className="shrink-0 bg-wa-green px-4 py-1.5 text-center text-sm font-medium text-white" role="status">
          👋 {partners.find((p) => p.id === nudgeFrom)?.email.split('@')[0] || 'Someone'} is online
        </div>
      )}
      {error && <div className="shrink-0 bg-red-50 px-4 py-1 text-center text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}
      {notice && !error && <div className="shrink-0 bg-emerald-50 px-4 py-1 text-center text-xs text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">{notice}</div>}

      {partner && (
        <form onSubmit={send} className="shrink-0 bg-slate-100 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] dark:bg-[#1f2c34]">
          {(replyTo || editing) && (
            <div className="mx-auto mb-2 flex max-w-2xl items-center gap-2 rounded-lg border-l-4 border-wa-teal bg-white px-3 py-1.5 text-xs dark:bg-[#2a3942]">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-wa-teal">
                  {editing ? 'Editing message' : `Replying to ${replyTo.sender_id === user.id ? 'yourself' : partnerName}`}
                </div>
                {!editing && <div className="truncate text-slate-600 dark:text-slate-300">{previewOf(replyTo)}</div>}
              </div>
              <button type="button" aria-label="Cancel" onClick={() => { setReplyTo(null); setEditing(null); setText(''); }}
                className="rounded-full px-2 text-lg leading-none text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">×</button>
            </div>
          )}
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            {rec ? (
              <>
                <button type="button" onClick={() => stopRec(true)} aria-label="Cancel recording"
                  className={`${iconBtn} bg-white text-red-600 shadow-sm hover:bg-red-50 dark:bg-[#2a3942]`}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                </button>
                <div className="flex flex-1 items-center gap-2 rounded-full bg-white px-4 py-2.5 shadow-sm dark:bg-[#2a3942]">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                  <span className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{mmss(rec.secs)}</span>
                  <span className="text-xs text-slate-400">Recording…</span>
                </div>
                <button type="button" onClick={() => stopRec(false)} aria-label="Send voice message"
                  className={`${iconBtn} bg-wa-teal text-white hover:bg-wa-dark`}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 20.5l19-8.5-19-8.5v6.6l13 1.9-13 1.9z" /></svg>
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => { holdLock(120000); fileRef.current?.click(); }} aria-label="Send a photo"
                  className={`${iconBtn} text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-white/10`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                </button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => onType(e.target.value)}
                  onBlur={stopTyping}
                  maxLength={2000}
                  placeholder="Type a message"
                  className="min-w-0 flex-1 rounded-full bg-white px-4 py-2.5 shadow-sm focus:outline-none focus:ring-2 focus:ring-wa-teal dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-slate-400"
                />
                {text.trim() ? (
                  <button type="submit" aria-label={editing ? 'Save edit' : 'Send'} className={`${iconBtn} bg-wa-teal text-white hover:bg-wa-dark`}>
                    {editing ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 20.5l19-8.5-19-8.5v6.6l13 1.9-13 1.9z" /></svg>
                    )}
                  </button>
                ) : (
                  <button type="button" onClick={startRec} aria-label="Record a voice message" className={`${iconBtn} bg-wa-teal text-white hover:bg-wa-dark`}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v4" /></svg>
                  </button>
                )}
              </>
            )}
          </div>
        </form>
      )}

      {menuMsg && (
        <MessageMenu
          m={menuMsg} mine={menuMsg.sender_id === user.id} canEdit={canEdit(menuMsg)}
          myEmoji={reactions[menuMsg.id]?.[user.id] || ''}
          onReact={(e) => react(menuMsg, e)} onReply={() => startReply(menuMsg)} onEdit={() => startEdit(menuMsg)}
          onDelete={() => deleteForEveryone(menuMsg)} onCopy={() => copyText(menuMsg)} onClose={() => setMenuId(null)}
        />
      )}

      {showSettings && (
        <SettingsSheet settings={settings} update={updateSettings} notif={notif}
          onToggleNotif={toggleNotifications} onTest={runTest} onSignOut={onSignOut} onClose={() => setShowSettings(false)} />
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
