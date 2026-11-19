import { useEffect, useState } from 'react';
import { loadAlerts, saveAlerts } from '../utils/alerts';

const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const field = 'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-sky-500';

// Shown when the decoy PIN is entered. Looks like a normal "quick add" window; never opens the chat.
export default function DecoyPanel({ onAddEvent, onClose }) {
  const [tab, setTab] = useState('event');
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(todayStr());
  const [time, setTime] = useState('');
  const [alerts, setAlerts] = useState([]);
  const [note, setNote] = useState('');

  useEffect(() => { setAlerts(loadAlerts().filter((a) => !a.fired)); }, []);

  const pending = alerts.slice().sort((a, b) => a.at - b.at);

  function submit(e) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return setNote('Please enter a title.');
    if (!date) return setNote('Please pick a date.');
    if (tab === 'event') {
      onAddEvent({ date, title: t, time });
      setNote('Event added to your calendar.');
    } else {
      const at = new Date(`${date}T${time || '09:00'}`).getTime();
      if (!Number.isFinite(at) || at <= Date.now()) return setNote('Pick a time in the future.');
      const all = loadAlerts();
      const next = [...all, { id: `${Date.now()}`, title: t, at, fired: false }];
      saveAlerts(next);
      setAlerts(next.filter((a) => !a.fired));
      setNote('Alert set. It will show while the calendar is open.');
    }
    setTitle('');
    setTime('');
  }

  function removeAlert(id) {
    const next = loadAlerts().filter((a) => a.id !== id);
    saveAlerts(next);
    setAlerts(next.filter((a) => !a.fired));
  }

  const tabBtn = (id, label) => (
    <button type="button" onClick={() => { setTab(id); setNote(''); }}
      className={'flex-1 rounded-lg py-2 text-sm font-medium ' +
        (tab === id ? 'bg-sky-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10')}>
      {label}
    </button>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Add event or set alert">
      <div className="w-full max-w-sm animate-pop rounded-2xl bg-white p-5 shadow-xl dark:bg-slate-800" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Quick add</h2>
        <div className="mt-3 flex gap-2 rounded-xl bg-slate-100 p-1 dark:bg-slate-900">
          {tabBtn('event', 'Add event')}
          {tabBtn('alert', 'Set alert')}
        </div>

        <form className="mt-4 space-y-2" onSubmit={submit}>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80}
            placeholder={tab === 'event' ? 'Event title' : 'Alert message'} className={field} />
          <div className="flex gap-2">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} aria-label="Date" />
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={field} aria-label="Time" />
          </div>
          <button className="w-full rounded-lg bg-sky-600 py-2 text-sm font-medium text-white hover:bg-sky-700">
            {tab === 'event' ? 'Add event' : 'Set alert'}
          </button>
        </form>
        <p className="mt-2 h-5 text-sm text-slate-500 dark:text-slate-400" aria-live="polite">{note}</p>

        {tab === 'alert' && pending.length > 0 && (
          <ul className="mt-1 max-h-40 space-y-2 overflow-y-auto">
            {pending.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-sky-50 px-3 py-2 text-sm dark:bg-sky-900/30">
                <span className="min-w-0 truncate text-slate-800 dark:text-slate-100">
                  <b className="mr-2">{new Date(a.at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</b>{a.title}
                </span>
                <button onClick={() => removeAlert(a.id)} aria-label="Delete alert" className="text-slate-500 hover:text-red-600">✕</button>
              </li>
            ))}
          </ul>
        )}

        <button onClick={onClose} className="mt-3 w-full rounded-lg py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/10">Close</button>
      </div>
    </div>
  );
}
