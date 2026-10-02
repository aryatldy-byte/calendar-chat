export default function ContactList({ partners, unreadFor, onOpen }) {
  if (partners.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 text-center text-sm text-slate-500">
        No contacts yet. An admin needs to link you with someone.
      </div>
    );
  }
  return (
    <ul className="flex-1 divide-y divide-slate-200 overflow-y-auto bg-white">
      {partners.map((p) => {
        const n = unreadFor(p.id);
        return (
          <li key={p.id}>
            <button onClick={() => onOpen(p.id)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-wa-teal text-lg font-semibold uppercase text-white">
                {p.email[0]}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-slate-900">{p.email}</span>
                <span className="block text-xs text-slate-500">{n ? `${n} new message${n > 1 ? 's' : ''}` : 'Tap to chat'}</span>
              </span>
              {n > 0 && (
                <span className="flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-wa-green px-1.5 text-xs font-semibold text-white">
                  {n}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
