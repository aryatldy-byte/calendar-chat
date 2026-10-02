import { useEffect, useRef, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

const TTL = 5 * 60 * 1000; // messages disappear from the screen after 5 minutes
const FADE = 3000;         // fade-out animation starts 3s before that

const fmt = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const alive = (m) => Date.now() - new Date(m.timestamp).getTime() < TTL;

export default function ChatWindow({ user, monthName, onBack, onSignOut }) {
  const [partner, setPartner] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [now, setNow] = useState(Date.now());
  const [error, setError] = useState('');
  const bottom = useRef(null);

  // Find the other approved user (poll until they exist)
  useEffect(() => {
    let stop = false;
    async function find() {
      const { data } = await supabase.from('users').select('id,email')
        .eq('approved', true).neq('id', user.id).limit(1).maybeSingle();
      if (!stop && data) setPartner(data);
    }
    find();
    const t = setInterval(() => { if (!partner) find(); }, 10000);
    return () => { stop = true; clearInterval(t); };
  }, [user.id, partner]);

  // Load recent messages + subscribe to new ones
  useEffect(() => {
    const since = new Date(Date.now() - TTL).toISOString();
    supabase.from('messages').select('*').gt('timestamp', since).order('timestamp')
      .then(({ data, error }) => (error ? setError(error.message) : setMessages(data || [])));

    const channel = supabase.channel(`chat-${user.id}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, ({ new: m }) =>
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m])))
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user.id]);

  // 1s ticker: drives fade-out and removes expired messages (frontend-only hiding)
  useEffect(() => {
    const t = setInterval(() => {
      setNow(Date.now());
      setMessages((prev) => (prev.every(alive) ? prev : prev.filter(alive)));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages.length]);

  async function send(e) {
    e.preventDefault();
    const content = text.trim();
    if (!content || !partner) return;
    setText(''); setError('');
    const { data, error } = await supabase.from('messages')
      .insert({ sender_id: user.id, receiver_id: partner.id, content }).select().single();
    if (error) { setError(error.message); setText(content); return; }
    setMessages((prev) => (prev.some((x) => x.id === data.id) ? prev : [...prev, data]));
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <header className="flex shrink-0 items-center gap-3 bg-wa-dark px-3 py-2.5 text-white shadow">
        <button onClick={onBack} aria-label="Back to calendar" className="rounded-full p-2 hover:bg-white/10">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{monthName}</div>
          <div className="truncate text-xs text-white/70">{partner ? partner.email : 'Waiting for the second person…'}</div>
        </div>
        <button onClick={onSignOut} className="rounded-full px-3 py-1 text-xs text-white/80 hover:bg-white/10">Sign out</button>
      </header>

      <main className="wa-pattern flex-1 overflow-y-auto px-3 py-4">
        <div className="mx-auto flex max-w-2xl flex-col gap-1.5">
          <p className="mx-auto mb-2 rounded-lg bg-amber-100 px-3 py-1 text-center text-xs text-amber-900">
            Messages disappear from the screen after 5 minutes.
          </p>
          {messages.map((m) => {
            const mine = m.sender_id === user.id;
            const fading = now - new Date(m.timestamp).getTime() >= TTL - FADE;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div className={
                  'max-w-[80%] rounded-lg px-3 py-1.5 text-[15px] shadow-sm ' +
                  (mine ? 'rounded-tr-none bg-wa-bubble text-slate-900' : 'rounded-tl-none bg-gray-200 text-slate-900') +
                  (fading ? ' animate-fadeout' : '')
                }>
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                  <span className="ml-2 inline-block translate-y-1 text-[11px] text-slate-500">{fmt(m.timestamp)}</span>
                </div>
              </div>
            );
          })}
          <div ref={bottom} />
        </div>
      </main>

      {error && <div className="shrink-0 bg-red-50 px-4 py-1 text-center text-xs text-red-700">{error}</div>}

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
    </div>
  );
}
