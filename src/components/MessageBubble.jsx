import { useRef } from 'react';
import Ticks from './Ticks';
import MediaBubble from './MediaBubble';
import { TTL, FADE } from '../utils/constants';

const fmt = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

export const previewOf = (m) =>
  m.deleted_at ? 'Deleted message' : m.type === 'image' ? '📷 Photo' : m.type === 'voice' ? '🎤 Voice message' : m.content;

export default function MessageBubble({ m, mine, orig, partnerName, rx, now, onMenu, onView }) {
  const press = useRef(null);
  const gone = !!m.deleted_at;
  const fadeFrom = gone ? m.deleted_at : m.status === 'seen' ? m.seen_at : null;
  const fading = !!fadeFrom && now - new Date(fadeFrom).getTime() >= TTL - FADE;
  const interactive = !gone && !String(m.id).startsWith('tmp-');
  const clear = () => clearTimeout(press.current);

  const handlers = interactive ? {
    onContextMenu: (e) => { e.preventDefault(); onMenu(m); },          // right-click
    onTouchStart: () => { press.current = setTimeout(() => onMenu(m), 450); }, // long-press
    onTouchEnd: clear, onTouchMove: clear, onTouchCancel: clear,
  } : {};

  const groups = {};
  rx.forEach((e) => { groups[e] = (groups[e] || 0) + 1; });

  const footer = (
    <>
      {m.edited_at && <span className="mr-1 italic">edited</span>}
      {fmt(m.timestamp)}
      {mine && <Ticks status={m.status || 'sent'} />}
    </>
  );

  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`flex max-w-[80%] flex-col ${mine ? 'items-end' : 'items-start'} ${fading ? 'animate-fadeout' : ''}`}>
        <div
          {...handlers}
          className={
            'select-none rounded-lg px-3 py-1.5 text-[15px] shadow-sm [-webkit-touch-callout:none] ' +
            (mine
              ? 'rounded-tr-none bg-wa-bubble text-slate-900 dark:bg-[#005c4b] dark:text-[#e9edef]'
              : 'rounded-tl-none bg-gray-200 text-slate-900 dark:bg-[#202c33] dark:text-[#e9edef]')
          }
        >
          {gone ? (
            <span className="italic text-slate-500 dark:text-slate-400">🚫 This message was deleted</span>
          ) : (
            <>
              {m.reply_to && (
                <div className="mb-1 rounded border-l-4 border-wa-teal bg-black/5 px-2 py-1 text-xs dark:bg-white/10">
                  <div className="font-semibold text-wa-teal">{orig ? (orig.sender_id === m.sender_id ? (mine ? 'You' : partnerName) : (mine ? partnerName : 'You')) : 'Message'}</div>
                  <div className="max-w-[14rem] truncate text-slate-600 dark:text-slate-300">{orig ? previewOf(orig) : 'Original message'}</div>
                </div>
              )}
              {m.type && m.type !== 'text' ? (
                <>
                  <MediaBubble m={m} onOpen={onView} />
                  <div className="mt-1 flex items-center justify-end gap-1 text-[11px] text-slate-500 dark:text-slate-400">{footer}</div>
                </>
              ) : (
                <>
                  <span className="whitespace-pre-wrap break-words">{m.content}</span>
                  <span className="ml-2 inline-flex translate-y-1 items-center gap-1 align-bottom text-[11px] text-slate-500 dark:text-slate-400">{footer}</span>
                </>
              )}
            </>
          )}
        </div>
        {rx.length > 0 && (
          <div className={`z-10 -mt-2 flex gap-1 ${mine ? 'mr-2' : 'ml-2'}`}>
            {Object.entries(groups).map(([e, n]) => (
              <span key={e} className="rounded-full bg-white px-1.5 py-0.5 text-xs shadow dark:bg-[#233138]">
                {e}{n > 1 ? ` ${n}` : ''}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
