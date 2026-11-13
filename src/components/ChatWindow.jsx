import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import ContactList from './ContactList';
import MessageBubble, { previewOf } from './MessageBubble';
import MessageMenu from './MessageMenu';
import SettingsSheet from './SettingsSheet';
import Avatar from './Avatar';
import CameraCapture from './CameraCapture';
import { BUCKET, MAX_VOICE_SECS, baseType, extFor, mmss, compressImage, pickAudioType } from '../utils/media';
import { pushSupported, enablePush, disablePush, isPushEnabled, testPush } from '../utils/push';
import { useSettings } from '../utils/settings';
import { usePresence } from '../utils/presence';
import { holdLock } from '../utils/autoLock';
import { TTL, EDIT_WINDOW, ONLINE_PING_MIN_GAP } from '../utils/constants';
import { postApi } from '../utils/api';
import { lastSeenText } from '../utils/format';

// Unseen messages stay; seen messages expire TTL (15 min) after the server-stamped seen_at; deleted ones vanish after TTL too.
// Expired messages are hidden here at once and deleted from the database by /api/purge-expired.
const alive = (m) => {
  if (m.deleted_at) return Date.now() - new Date(m.deleted_at).getTime() < TTL;
  return !(m.status === 'seen' && m.seen_at) || Date.now() - new Date(m.seen_at).getTime() < TTL;
};

const EMOJI_PICK = ['😀','😂','🥰','😍','😘','😎','🤗','😉','😊','🙈','😢','😭','😡','🤔','😴','🥳','👍','👏','🙏','💪','🔥','❤️','💯','🎉'];
const iconBtn = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition active:scale-95';

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
  const [showAttach, setShowAttach] = useState(false); // camera / gallery picker
  const [showCamera, setShowCamera] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [onlineAlerts, setOnlineAlerts] = useState(null); // my "alert me when they come online" switch (null = not available yet)
  const [showMenu, setShowMenu] = useState(false);
  const [showEmoji, setShowEmoji] = useState(false);
  const [atBottom, setAtBottom] = useState(true);
  const [missed, setMissed] = useState(0);
  const mainRef = useRef(null);
  const atBottomRef = useRef(true);
  const prevLen = useRef(0);
  const bottom = useRef(null);
  const activeRef = useRef(null);
  const fileRef = useRef(null);
  const camRef = useRef(null);   // phone camera app (fallback when the in-app camera isn't available)
  const lastOnlinePing = useRef(0);
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

  const showOnline = useCallback((pid, buzz) => {
    setNudgeFrom(pid);
    if (buzz) navigator.vibrate?.([200, 100, 200]);
    setTimeout(() => setNudgeFrom((cur) => (cur === pid ? null : cur)), 6000);
  }, []);
  const onNudge = useCallback((pid) => showOnline(pid, true), [showOnline]);
  const onCameOnline = useCallback((pid) => showOnline(pid, false), [showOnline]);
  // The other person emptied the chat: drop it from this screen too
  const onCleared = useCallback((pid) => {
    setMessages((prev) => prev.filter((m) => !((m.sender_id === pid && m.receiver_id === user.id) || (m.sender_id === user.id && m.receiver_id === pid))));
    setReplyTo(null); setEditing(null); setMenuId(null);
    setNotice('The chat was cleared.'); setTimeout(() => setNotice(''), 3000);
  }, [user.id]);
  const { online, typing, sendTyping, sendNudge, sendCleared } = usePresence(
    user.id, pairs.filter((p) => partners.some((x) => x.id === p.partnerId)), settings.shareStatus,
    { onNudge, onOnline: onCameOnline, onCleared });

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

  // Really delete expired messages (and their photo/voice files) from the database; the screen already hides them
  useEffect(() => {
    const run = () => { if (document.visibilityState === 'visible') postApi('/api/purge-expired').catch(() => {}); };
    run();
    const t = setInterval(run, 60000);
    return () => clearInterval(t);
  }, []);

  // Tell the people I'm linked with that I just came online (their phones get a push if their chat isn't open).
  // Skipped when I've chosen to hide my online status. The server limits it to one alert per person every 5 minutes.
  useEffect(() => {
    if (!settingsLoaded || !settings.shareStatus) return undefined;
    const announce = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastOnlinePing.current < ONLINE_PING_MIN_GAP) return;
      lastOnlinePing.current = Date.now();
      postApi('/api/online').catch(() => {});
    };
    announce();
    document.addEventListener('visibilitychange', announce);
    return () => document.removeEventListener('visibilitychange', announce);
  }, [settingsLoaded, settings.shareStatus]);

  // My "alert me when they come online" switch (stored in the database so the server can respect it)
  useEffect(() => {
    supabase.from('users').select('online_alerts').eq('id', user.id).maybeSingle()
      .then(({ data, error }) => { if (!error && data && typeof data.online_alerts === 'boolean') setOnlineAlerts(data.online_alerts); });
  }, [user.id]);
  async function toggleOnlineAlerts(v) {
    const prev = onlineAlerts;
    setOnlineAlerts(v);
    const { error } = await supabase.rpc('set_online_alerts', { enabled: v });
    if (error) { setOnlineAlerts(prev); setError(error.message); }
  }

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

  const partnerTyping = partner ? !!typing[partner.id] : false;
  const jumpDown = useCallback(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); setMissed(0); }, []);
  const onScroll = () => {
    const el = mainRef.current; if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    atBottomRef.current = near; setAtBottom(near);
    if (near) setMissed(0);
  };
  // Follow new messages when I'm at the bottom (or I sent it); otherwise show a "new messages" button
  useEffect(() => {
    const grew = thread.length - prevLen.current; prevLen.current = thread.length;
    const last = thread[thread.length - 1];
    if (atBottomRef.current || grew <= 0 || last?.sender_id === user.id) bottom.current?.scrollIntoView({ behavior: grew > 0 ? 'smooth' : 'auto' });
    else setMissed((n) => n + grew);
  }, [thread.length, partner?.id, partnerTyping]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { prevLen.current = 0; setMissed(0); }, [partner?.id]);

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
    setText(''); setError(''); setShowEmoji(false);
    navigator.vibrate?.(8);
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

  // Photo from the in-app camera (already resized to JPEG)
  async function sendCameraShot(blob) {
    setShowCamera(false);
    await sendMedia('image', blob);
  }
  function openCamera() {
    setShowAttach(false);
    holdLock(180000);
    if (window.isSecureContext && navigator.mediaDevices?.getUserMedia) setShowCamera(true);
    else camRef.current?.click(); // no in-app camera here -> use the phone's camera app
  }
  function openGallery() {
    setShowAttach(false);
    holdLock(120000);
    fileRef.current?.click();
  }
  function openCameraApp() { setShowCamera(false); holdLock(180000); setTimeout(() => camRef.current?.click(), 50); }

  // Clear chat: deletes every message + photo + voice note with this person, for both of you
  async function clearChat() {
    if (!partner || clearing) return;
    setClearing(true); setError('');
    try {
      const r = await postApi('/api/clear-chat', { partnerId: partner.id });
      if (!r.ok) throw new Error(r.json.error || 'Could not clear the chat.');
      const pid = partner.id;
      setMessages((prev) => prev.filter((m) => !((m.sender_id === pid && m.receiver_id === user.id) || (m.sender_id === user.id && m.receiver_id === pid))));
      setReplyTo(null); setEditing(null); setMenuId(null); setText('');
      sendCleared(pid); // if they have the chat open, it empties for them straight away
      setConfirmClear(false);
      setNotice('Chat cleared.'); setTimeout(() => setNotice(''), 2500);
    } catch (e) { setError(e.message); setConfirmClear(false); }
    setClearing(false);
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
      <header className="relative z-20 flex shrink-0 items-center gap-1 bg-gradient-to-r from-wa-dark to-wa-teal px-2 py-2 text-white shadow-md dark:from-[#1f2c34] dark:to-[#202c33]">
        <button onClick={goBack} aria-label="Back" className="rounded-full p-2 transition hover:bg-white/10 active:scale-95">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        {partner ? (
          <Avatar name={partner.email} online={!!online[partner.id]} size="h-10 w-10 text-base" ring="border-wa-teal dark:border-[#1f2c34]" />
        ) : (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/15 text-xl">💬</span>
        )}
        <div className="min-w-0 flex-1 px-1.5">
          <div className="truncate font-semibold leading-tight">{partner ? partner.email : monthName}</div>
          <div className={`truncate text-xs ${partner && (typing[partner.id] || online[partner.id]) ? 'font-medium text-[#b5ffd0]' : 'text-white/75'}`}>{subtitle}</div>
        </div>
        {partner && (
          <button onClick={nudge} disabled={coolLeft > 0} aria-label="Let them know I'm online" title="Let them know I'm online"
            className="flex items-center gap-1 rounded-full p-2 transition hover:bg-white/10 active:scale-95 disabled:opacity-60">
            <span className="text-lg leading-none">👋</span>
            {coolLeft > 0 && <span className="text-[10px] tabular-nums">{coolLeft}</span>}
          </button>
        )}
        <button onClick={onLock} aria-label="Lock now" title="Lock now" className="rounded-full p-2 transition hover:bg-white/10 active:scale-95">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
        </button>
        <div className="relative">
          <button onClick={() => setShowMenu((v) => !v)} aria-label="More" aria-expanded={showMenu} className="rounded-full p-2 transition hover:bg-white/10 active:scale-95">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
          </button>
          {showMenu && (
            <>
              <div className="fixed inset-0 z-30" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 top-11 z-40 w-56 animate-pop overflow-hidden rounded-2xl bg-white py-1 text-sm text-slate-800 shadow-xl dark:bg-[#233138] dark:text-slate-100" role="menu">
                <button role="menuitem" disabled={notif === 'checking'} onClick={() => { setShowMenu(false); toggleNotifications(); }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-100 disabled:opacity-50 dark:hover:bg-white/10">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" />{notif !== 'on' && <path d="M3 3l18 18" />}</svg>
                  {notif === 'on' ? 'Notifications: on' : 'Notifications: off'}
                </button>
                {partner && (
                  <button role="menuitem" onClick={() => { setShowMenu(false); setConfirmClear(true); }}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left text-red-600 hover:bg-slate-100 dark:text-red-400 dark:hover:bg-white/10">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" /></svg>
                    Clear chat
                  </button>
                )}
                <button role="menuitem" onClick={() => { setShowMenu(false); setShowSettings(true); }}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-100 dark:hover:bg-white/10">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></svg>
                  Settings
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {!partner ? (
        <ContactList partners={partners} unreadFor={unreadFor} online={online} typing={typing} onOpen={setActiveId} />
      ) : (
        <main ref={mainRef} onScroll={onScroll} className="wa-pattern relative flex-1 overflow-y-auto px-3 py-4">
          <div className="mx-auto flex max-w-2xl flex-col">
            <p className="mx-auto mb-3 flex items-center gap-1.5 rounded-full bg-white/85 px-3 py-1 text-center text-[11px] text-slate-600 shadow-sm backdrop-blur dark:bg-[#1f2c34]/90 dark:text-slate-300">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></svg>
              Messages disappear {Math.round(TTL / 60000)} min after they're seen · double-tap to ❤️ · long-press for options
            </p>
            {thread.length === 0 && (
              <div className="mx-auto mt-10 flex max-w-xs flex-col items-center gap-2 rounded-2xl bg-white/80 px-6 py-6 text-center shadow-sm backdrop-blur dark:bg-[#1f2c34]/90">
                <span className="text-4xl">👋</span>
                <div className="font-medium text-slate-800 dark:text-slate-100">No messages yet</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Say hi to {partnerName || 'them'} to start the conversation.</div>
              </div>
            )}
            {thread.map((m, i) => {
              const rx = Object.values(reactions[m.id] || {}).filter(Boolean);
              const newGroup = i > 0 && thread[i - 1].sender_id !== m.sender_id;
              return (
                <div key={m.id} className={i === 0 ? '' : newGroup ? 'mt-3' : 'mt-1'}>
                  <MessageBubble m={m} mine={m.sender_id === user.id} partnerName={partnerName}
                    orig={m.reply_to ? messages.find((x) => x.id === m.reply_to) : null}
                    seenAt={lastSeenMine && lastSeenMine.id === m.id ? m.seen_at : null}
                    rx={rx} now={now} onMenu={(x) => setMenuId(x.id)} onView={setViewer} onLike={(x) => react(x, '❤️')} />
                </div>
              );
            })}
            {partnerTyping && (
              <div className="mt-3 flex justify-start animate-slideup" aria-label="typing">
                <div className="flex items-center gap-1 rounded-2xl rounded-bl-md border border-black/5 bg-white px-3.5 py-3 shadow-sm dark:border-white/5 dark:bg-[#202c33]">
                  {[0, 1, 2].map((i) => <span key={i} className="h-1.5 w-1.5 animate-dot rounded-full bg-slate-400" style={{ animationDelay: `${i * 0.18}s` }} />)}
                </div>
              </div>
            )}
            <div ref={bottom} />
          </div>
        </main>
      )}

      {partner && !atBottom && (
        <div className="pointer-events-none relative z-10 h-0">
          <button onClick={jumpDown} aria-label="Scroll to latest"
            className="pointer-events-auto absolute -top-14 right-3 flex h-11 w-11 animate-pop items-center justify-center rounded-full bg-white text-slate-600 shadow-lg ring-1 ring-black/5 transition active:scale-95 dark:bg-[#233138] dark:text-slate-200">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9l6 6 6-6" /></svg>
            {missed > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-wa-green px-1 text-[11px] font-semibold text-white">{missed}</span>}
          </button>
        </div>
      )}

      {nudgeFrom && (
        <div className="shrink-0 animate-slidedown bg-gradient-to-r from-wa-teal to-wa-green px-4 py-1.5 text-center text-sm font-medium text-white shadow" role="status">
          👋 {partners.find((p) => p.id === nudgeFrom)?.email.split('@')[0] || 'Someone'} is online
        </div>
      )}
      {error && <div className="shrink-0 bg-red-50 px-4 py-1 text-center text-xs text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div>}
      {notice && !error && <div className="shrink-0 bg-emerald-50 px-4 py-1 text-center text-xs text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300">{notice}</div>}

      {partner && (
        <form onSubmit={send} className="shrink-0 border-t border-black/5 bg-white/90 px-2 py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] backdrop-blur dark:border-white/5 dark:bg-[#111b21]/95">
          {(replyTo || editing) && (
            <div className="mx-auto mb-2 flex max-w-2xl items-center gap-2 rounded-xl border-l-4 border-wa-teal bg-slate-100 px-3 py-1.5 text-xs dark:bg-[#2a3942]">
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
          {showEmoji && !rec && (
            <div className="mx-auto mb-2 grid max-w-2xl animate-pop grid-cols-8 gap-1 rounded-2xl bg-slate-100 p-2 text-2xl dark:bg-[#2a3942]">
              {EMOJI_PICK.map((e) => (
                <button key={e} type="button" onClick={() => { onType(text + e); inputRef.current?.focus(); }}
                  className="rounded-lg py-1 transition hover:bg-white active:scale-90 dark:hover:bg-white/10">{e}</button>
              ))}
            </div>
          )}
          <div className="mx-auto flex max-w-2xl items-center gap-2">
            {rec ? (
              <>
                <button type="button" onClick={() => stopRec(true)} aria-label="Cancel recording"
                  className={`${iconBtn} bg-slate-100 text-red-600 hover:bg-red-50 dark:bg-[#2a3942]`}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg>
                </button>
                <div className="flex flex-1 items-center gap-2 rounded-full bg-slate-100 px-4 py-2.5 dark:bg-[#2a3942]">
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
                  <span className="text-sm tabular-nums text-slate-700 dark:text-slate-200">{mmss(rec.secs)}</span>
                  <span className="text-xs text-slate-400">Recording…</span>
                </div>
                <button type="button" onClick={() => stopRec(false)} aria-label="Send voice message"
                  className={`${iconBtn} bg-gradient-to-br from-wa-green to-wa-teal text-white shadow-md hover:opacity-95`}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 20.5l19-8.5-19-8.5v6.6l13 1.9-13 1.9z" /></svg>
                </button>
              </>
            ) : (
              <>
                <div className="relative">
                  <button type="button" onClick={() => setShowAttach((v) => !v)} aria-label="Send a photo" aria-expanded={showAttach}
                    className={`${iconBtn} text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-white/10`}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-3l-2-2H9L7 7H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1z" /><circle cx="12" cy="13" r="3.5" /></svg>
                  </button>
                  {showAttach && (
                    <>
                      <div className="fixed inset-0 z-30" onClick={() => setShowAttach(false)} />
                      <div className="absolute bottom-12 left-0 z-40 w-44 animate-pop overflow-hidden rounded-xl bg-white py-1 text-sm shadow-xl dark:bg-[#233138]" role="menu">
                        <button type="button" role="menuitem" onClick={openCamera} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 7h-3l-2-2H9L7 7H4a1 1 0 00-1 1v10a1 1 0 001 1h16a1 1 0 001-1V8a1 1 0 00-1-1z" /><circle cx="12" cy="13" r="3.5" /></svg>
                          Camera
                        </button>
                        <button type="button" role="menuitem" onClick={openGallery} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-white/10">
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="M21 15l-5-5L5 21" /></svg>
                          Gallery
                        </button>
                      </div>
                    </>
                  )}
                </div>
                <button type="button" onClick={() => setShowEmoji((v) => !v)} aria-label="Emoji" aria-expanded={showEmoji}
                  className={`${iconBtn} text-xl text-slate-600 hover:bg-slate-200 dark:text-slate-300 dark:hover:bg-white/10`}>😊</button>
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickImage} />
                <input ref={camRef} type="file" accept="image/*" capture="environment" hidden onChange={pickImage} />
                <input
                  ref={inputRef}
                  value={text}
                  onChange={(e) => onType(e.target.value)}
                  onBlur={stopTyping}
                  maxLength={2000}
                  placeholder="Type a message"
                  autoComplete="off"
                  className="min-w-0 flex-1 rounded-full bg-slate-100 px-4 py-2.5 focus:bg-white focus:outline-none focus:ring-2 focus:ring-wa-teal dark:bg-[#2a3942] dark:text-[#e9edef] dark:placeholder:text-slate-400"
                />
                {text.trim() ? (
                  <button type="submit" aria-label={editing ? 'Save edit' : 'Send'} className={`${iconBtn} bg-gradient-to-br from-wa-green to-wa-teal text-white shadow-md hover:opacity-95`}>
                    {editing ? (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L20 7" /></svg>
                    ) : (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 20.5l19-8.5-19-8.5v6.6l13 1.9-13 1.9z" /></svg>
                    )}
                  </button>
                ) : (
                  <button type="button" onClick={startRec} aria-label="Record a voice message" className={`${iconBtn} bg-gradient-to-br from-wa-green to-wa-teal text-white shadow-md hover:opacity-95`}>
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
          onToggleNotif={toggleNotifications} onTest={runTest} onSignOut={onSignOut} onClose={() => setShowSettings(false)}
          onlineAlerts={onlineAlerts} onToggleOnlineAlerts={toggleOnlineAlerts} />
      )}

      {showCamera && <CameraCapture onSend={sendCameraShot} onClose={() => setShowCamera(false)} onFallback={openCameraApp} />}

      {confirmClear && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !clearing && setConfirmClear(false)}>
          <div className="w-full max-w-sm animate-pop rounded-2xl bg-white p-5 shadow-xl dark:bg-[#233138]" role="alertdialog" aria-label="Clear chat" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Clear this chat?</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">
              Every message, photo and voice message with {partnerName || 'this person'} will be permanently deleted for <b>both of you</b>. This can't be undone.
            </p>
            <div className="mt-4 flex gap-2">
              <button type="button" disabled={clearing} onClick={() => setConfirmClear(false)}
                className="flex-1 rounded-lg border border-slate-300 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-white/10">Cancel</button>
              <button type="button" disabled={clearing} onClick={clearChat}
                className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60">{clearing ? 'Clearing…' : 'Clear chat'}</button>
            </div>
          </div>
        </div>
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
