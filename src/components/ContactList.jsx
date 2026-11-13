import { lastSeenText } from '../utils/format';
import Avatar from './Avatar';

export default function ContactList({ partners, unreadFor, online = {}, typing = {}, onOpen }) {
  if (partners.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 bg-slate-50 p-8 text-center dark:bg-[#0b141a]">
        <span className="text-4xl">💬</span>
        <p className="text-sm text-slate-500 dark:text-slate-400">No contacts yet. An admin needs to link you with someone.</p>
      </div>
    );
  }
  return (
    <ul className="flex-1 space-y-2 overflow-y-auto bg-slate-50 p-3 dark:bg-[#0b141a]">
      {partners.map((p) => {
        const n = unreadFor(p.id);
        return (
          <li key={p.id}>
            <button onClick={() => onOpen(p.id)}
              className="flex w-full items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left shadow-sm transition hover:shadow-md active:scale-[0.99] dark:bg-[#111b21] dark:hover:bg-[#162229]">
              <Avatar name={p.email} online={online[p.id]} size="h-12 w-12 text-lg" />
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-slate-900 dark:text-[#e9edef] ${n ? 'font-semibold' : 'font-medium'}`}>{p.email}</span>
                <span className={`block truncate text-xs ${typing[p.id] || online[p.id] ? 'text-wa-teal dark:text-wa-green' : 'text-slate-500 dark:text-slate-400'}`}>
                  {typing[p.id] ? 'typing…' : n ? `${n} new message${n > 1 ? 's' : ''}` : online[p.id] ? 'online' : lastSeenText(p.last_seen_at) || 'Tap to chat'}
                </span>
              </span>
              {n > 0 && (
                <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-wa-green px-1.5 text-xs font-semibold text-white shadow">{n}</span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
