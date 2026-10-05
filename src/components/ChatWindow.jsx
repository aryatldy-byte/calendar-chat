import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';
import ContactList from './ContactList';
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

  // Fallback local notification if the page is open in the background (server push uses the same tag)
  const localNotify = useCallback(() => {
    if (document.visibilityState === 'visible') return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    navigator.serviceWorker?.ready.then((reg) =>
      reg.showNotification('Calendar', {
        body: 'New event added', tag: 'calendar-msg', renotify: true, icon: '/icon-192.png',
      })).catch(() => {});
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
        if (m.receiver_id === user.id) { if (m.sender_id === activeRef.current) markSeen(); localNotify(); }
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages' }, ({ new: m }) =>
        setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, ...m } : x))))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.id, markSeen, localNotify]);

  // When the person comes back to the tab/app, mark as seen
  useEffect(() => {
    const onVis = () => markSeen();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); };
  }, [markSeen]);

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
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                  <span className="ml-2 inline-flex translate-y-1 items-center gap-1 align-bottom text-[11px] text-slate-500">
                    {fmt(m.timestamp)}
                    {mine && <Ticks status={m.status || 'sent'} />}
                  </span>
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
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={2000}
            placeholder={partner ? 'Type a message' : 'Waiting for the second person…'}
            disabled={!partner}
            className="flex-1 rounded-full bg-white px-4 py-2.5 shadow-sm focus:outline-none focus:ring-2 focus:ring-wa-teal"
          />
          <button type="submit" disabled={!text.trim() || !partner} aria-label="Send"
            className="flex h-11 w-11 items-center justify-center rounded-full bg-wa-teal text-white hover:bg-wa-dark disabled:opacity-50">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 20.5l19-8.5-19-8.5v6.6l13 1.9-13 1.9z" /></svg>
          </button>
        </div>
      </form>
      )}
    </div>
  );
}
