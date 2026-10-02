import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { MONTHS, PIN, setUnlock } from '../utils/unlock';

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

function MonthGrid({ year, month, today, onOpen }) {
  const first = new Date(year, month, 1).getDay();
  const total = new Date(year, month + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: total }, (_, i) => i + 1)];
  const isThisMonth = today.getFullYear() === year && today.getMonth() === month;

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <button
        onClick={() => onOpen(month)}
        className="mb-3 text-left text-base font-semibold text-sky-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded"
      >
        {MONTHS[month]}
      </button>
      <div className="grid grid-cols-7 gap-y-1 text-center text-xs">
        {WEEKDAYS.map((d, i) => (
          <div key={i} className="pb-1 font-medium text-slate-400">{d}</div>
        ))}
        {cells.map((d, i) => (
          <div key={i} className="flex h-7 items-center justify-center">
            {d && (
              <span
                className={
                  'flex h-6 w-6 items-center justify-center rounded-full ' +
                  (isThisMonth && d === today.getDate()
                    ? 'bg-sky-600 font-semibold text-white'
                    : 'text-slate-700')
                }
              >
                {d}
              </span>
            )}
          </div>
        ))}
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Password for ${MONTHS[month]}`}
    >
      <div className="w-full max-w-xs animate-pop rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800">{MONTHS[month]}</h2>
        <p className="mt-1 text-sm text-slate-500">Enter your 4-digit password.</p>
        <input
          ref={input}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          maxLength={4}
          value={value}
          disabled={locked}
          onChange={(e) => handle(e.target.value)}
          aria-label="4-digit password"
          className={
            'mt-4 w-full rounded-lg border px-3 py-3 text-center text-2xl tracking-[0.6em] focus:outline-none focus:ring-2 focus:ring-sky-500 ' +
            (error ? 'animate-shake border-red-400' : 'border-slate-300')
          }
        />
        <p className="mt-2 h-5 text-sm text-red-600" aria-live="polite">
          {locked
            ? `Too many attempts. Try again in ${Math.ceil((lockedUntil - Date.now()) / 1000)}s.`
            : error ? 'Incorrect password.' : ''}
        </p>
        <button onClick={onClose} className="mt-2 w-full rounded-lg py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function CalendarView() {
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getFullYear());
  const [pending, setPending] = useState(null);

  return (
    <div className="min-h-full bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
          <h1 className="text-xl font-semibold text-slate-800">Calendar</h1>
          <div className="flex items-center gap-1">
            <button onClick={() => setYear(year - 1)} aria-label="Previous year" className="rounded-full p-2 text-slate-600 hover:bg-slate-100">‹</button>
            <span className="w-14 text-center font-medium text-slate-800">{year}</span>
            <button onClick={() => setYear(year + 1)} aria-label="Next year" className="rounded-full p-2 text-slate-600 hover:bg-slate-100">›</button>
            <button onClick={() => setYear(today.getFullYear())} className="ml-2 rounded-full border border-slate-300 px-3 py-1 text-sm text-slate-700 hover:bg-slate-100">
              Today
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {MONTHS.map((_, m) => (
          <MonthGrid key={m} year={year} month={m} today={today} onOpen={setPending} />
        ))}
      </main>

      {pending !== null && (
        <PinModal
          month={pending}
          onClose={() => setPending(null)}
          onSuccess={() => { setUnlock(pending); router.push('/chat'); }}
        />
      )}
    </div>
  );
}
