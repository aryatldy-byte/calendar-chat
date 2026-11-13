import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { MONTHS, PIN, setUnlock } from '../utils/unlock';
import { useSettings } from '../utils/settings';
import { bioVerify } from '../utils/biometric';
import { holdLock } from '../utils/autoLock';
import { keyOf, loadEvents, saveEvents } from '../utils/events';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function MonthGrid({ year, month, today, events, onOpen, onDay }) {
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  const isThisMonth = today.getFullYear() === year && today.getMonth() === month;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800">
      <button
        onClick={() => onOpen(month)}
        className="mb-3 rounded text-left text-base font-semibold text-sky-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 dark:text-sky-400"
      >
        {MONTHS[month]}
      </button>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="pb-1 font-medium text-slate-400">{d}</div>
        ))}
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="h-8" />;
          const has = (events[keyOf(year, month, d)] || []).length > 0;
          const isToday = isThisMonth && d === today.getDate();
          return (
            <button key={i} onClick={() => onDay(d)} aria-label={`${MONTHS[month]} ${d}${has ? ', has events' : ''}`}
              className="relative flex h-8 items-center justify-center rounded-full hover:bg-slate-100 dark:hover:bg-slate-700">
              <span className={'flex h-6 w-6 items-center justify-center rounded-full ' +
                (isToday ? 'bg-sky-600 font-semibold text-white' : 'text-slate-700 dark:text-slate-200')}>{d}</span>
              {has && <span className="absolute bottom-0 h-1 w-1 rounded-full bg-sky-500" />}
            </button>
          );
        })}
      </div>
    </section>
  );
}

function PinModal({ month, onClose, onSuccess }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState(false);
  const [fails, setFails] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  const [, force] = useState(0);
  const input = useRef(null);

  useEffect(() => { input.current?.focus(); }, []);
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const locked = Date.now() < lockedUntil;

  function handle(v) {
    const digits = v.replace(/\D/g, '').slice(0, 4);
    setValue(digits);
    setError(false);
    if (digits.length === 4 && !locked) {
      if (digits === PIN) return onSuccess();
      const n = fails + 1;
      setFails(n);
      setError(true);
      setValue('');
      if (n >= 5) { setLockedUntil(Date.now() + 30000); setFails(0); }
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}
      role="dialog" aria-modal="true" aria-label={`Password for ${MONTHS[month]}`}>
      <div className="w-full max-w-xs animate-pop rounded-2xl bg-white p-6 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{MONTHS[month]}</h2>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Enter your 4-digit password.</p>
        <input ref={input} type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={value}
          disabled={locked} onChange={(e) => handle(e.target.value)} aria-label="4-digit password"
          className={'mt-4 w-full rounded-lg border px-3 py-3 text-center text-2xl tracking-[0.6em] focus:outline-none focus:ring-2 focus:ring-sky-500 dark:bg-slate-900 dark:text-slate-100 ' +
            (error ? 'animate-shake border-red-400' : 'border-slate-300 dark:border-slate-600')} />
        <p className="mt-2 h-5 text-sm text-red-600" aria-live="polite">
          {locked ? `Too many attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.` : error ? 'Incorrect password.' : ''}
        </p>
        <button onClick={onClose} className="mt-2 w-full rounded-lg py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">Cancel</button>
      </div>
    </div>
  );
}

function DayModal({ year, month, day, events, onAdd, onRemove, onClose }) {
  const [title, setTitle] = useState('');
  const [time, setTime] = useState('');
  const list = events[keyOf(year, month, day)] || [];
  const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true">
      <div className="w-full max-w-sm animate-pop rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">{MONTHS[month]} {day}, {year}</h2>
        <ul className="mt-3 space-y-2">
          {list.length === 0 && <li className="text-sm text-slate-500 dark:text-slate-400">No events.</li>}
          {list.map((ev) => (
            <li key={ev.id} className="flex items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm dark:bg-sky-900/30">
              <span className="min-w-0 truncate text-slate-800 dark:text-slate-100">{ev.time && <b className="mr-2">{ev.time}</b>}{ev.title}</span>
              <button onClick={() => onRemove(ev.id)} aria-label="Delete event" className="text-slate-500 hover:text-red-600">✕</button>
            </li>
          ))}
        </ul>
        <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); if (!title.trim()) return; onAdd({ title: title.trim(), time }); setTitle(''); setTime(''); }}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add event" maxLength={80} className={field} />
          <div className="flex gap-2">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} aria-label="Time" />
            <button className="rounded-lg bg-sky-600 px-4 text-sm font-medium text-white hover:bg-sky-700">Add</button>
          </div>
        </form>
        <button onClick={onClose} className="mt-3 w-full rounded-lg py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">Close</button>
      </div>
    </div>
  );
}

export default function CalendarView() {
  const router = useRouter();
  const [settings] = useSettings();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [pending, setPending] = useState(null);     // month waiting for the PIN
  const [day, setDay] = useState(null);             // { month, day } for the event modal
  const [events, setEvents] = useState({});
  const [toast, setToast] = useState('');

  useEffect(() => { setEvents(loadEvents()); }, []);
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(''), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const enter = (m) => { setUnlock(m); router.push('/chat'); };

  async function openMonth(m) {
    if (!settings.bioCred) return setPending(m);
    holdLock(60000);
    try {
      await bioVerify(settings.bioCred);
      enter(m);
    } catch (_) {
      if (settings.pinFallback) setPending(m);
      else setToast('Verification failed or cancelled.');
    }
  }

  const mutate = (fn) => setEvents((prev) => { const next = fn({ ...prev }); saveEvents(next); return next; });
  const addEvent = (ev) => mutate((e) => {
    const k = keyOf(year, day.month, day.day);
    e[k] = [...(e[k] || []), { id: `${Date.now()}`, ...ev }].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    return e;
  });
  const removeEvent = (id) => mutate((e) => {
    const k = keyOf(year, day.month, day.day);
    e[k] = (e[k] || []).filter((x) => x.id !== id);
    if (!e[k].length) delete e[k];
    return e;
  });

  const todays = events[keyOf(today.getFullYear(), today.getMonth(), today.getDate())] || [];

  return (
    <div className="min-h-full bg-slate-50 dark:bg-slate-900">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur dark:border-slate-700 dark:bg-slate-900/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <h1 className="text-xl font-semibold text-slate-800 dark:text-slate-100">Calendar</h1>
          <div className="flex items-center gap-1 text-slate-600 dark:text-slate-300">
            <button onClick={() => setYear(year - 1)} aria-label="Previous year" className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800">‹</button>
            <span className="w-14 text-center font-medium text-slate-800 dark:text-slate-100">{year}</span>
            <button onClick={() => setYear(year + 1)} aria-label="Next year" className="rounded-full p-2 hover:bg-slate-100 dark:hover:bg-slate-800">›</button>
            <button onClick={() => setYear(today.getFullYear())} className="ml-2 rounded-full border border-slate-300 px-3 py-1 text-sm hover:bg-slate-100 dark:border-slate-600 dark:hover:bg-slate-800">Today</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-4 p-4">
        {todays.length > 0 && (
          <section className="rounded-xl border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-900/20">
            <h2 className="text-sm font-semibold text-sky-800 dark:text-sky-300">Today</h2>
            <ul className="mt-1 text-sm text-slate-700 dark:text-slate-200">
              {todays.map((ev) => <li key={ev.id}>{ev.time && <b className="mr-2">{ev.time}</b>}{ev.title}</li>)}
            </ul>
          </section>
        )}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {MONTHS.map((_, m) => (
            <MonthGrid key={m} year={year} month={m} today={today} events={events}
              onOpen={openMonth} onDay={(d) => setDay({ month: m, day: d })} />
          ))}
        </div>
      </main>

      {pending !== null && (
        <PinModal month={pending} onClose={() => setPending(null)} onSuccess={() => enter(pending)} />
      )}
      {day && (
        <DayModal year={year} month={day.month} day={day.day} events={events}
          onAdd={addEvent} onRemove={removeEvent} onClose={() => setDay(null)} />
      )}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-full bg-slate-800 px-4 py-2 text-sm text-white shadow-lg" role="status">{toast}</div>
      )}
    </div>
  );
}
