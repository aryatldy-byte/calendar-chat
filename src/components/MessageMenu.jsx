const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export default function MessageMenu({ m, mine, canEdit, myEmoji, onReact, onReply, onEdit, onDelete, onCopy, onClose }) {
  const item = 'flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left text-[15px] hover:bg-slate-100 dark:hover:bg-white/10';
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="w-full max-w-sm animate-pop rounded-t-2xl bg-white p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-xl dark:bg-[#233138] dark:text-[#e9edef] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog" aria-label="Message options"
      >
        <div className="flex justify-between px-1 pb-2">
          {EMOJIS.map((e) => (
            <button key={e} onClick={() => onReact(e)} aria-label={`React ${e}`}
              className={`rounded-full p-2 text-2xl ${myEmoji === e ? 'bg-slate-200 dark:bg-white/20' : 'hover:bg-slate-100 dark:hover:bg-white/10'}`}>
              {e}
            </button>
          ))}
        </div>
        <div className="border-t border-slate-100 pt-1 dark:border-white/10">
          <button className={item} onClick={onReply}>↩️ Reply</button>
          {m.type === 'text' && <button className={item} onClick={onCopy}>📋 Copy</button>}
          {mine && canEdit && <button className={item} onClick={onEdit}>✏️ Edit</button>}
          {mine && <button className={`${item} text-red-600 dark:text-red-400`} onClick={onDelete}>🗑️ Delete for everyone</button>}
        </div>
      </div>
    </div>
  );
}
