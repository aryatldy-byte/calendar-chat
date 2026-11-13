import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

/**
 * Online status + typing indicator. One realtime channel per linked pair, named after the
 * (random, secret-to-outsiders) pairing id, so only the two people in a pair can find it.
 * pairs: [{ id, partnerId }]. If `share` is false we stop announcing ourselves but still see the other person.
 *
 * handlers: { onNudge(partnerId), onOnline(partnerId), onCleared(partnerId) }
 *   onNudge   – they tapped the 👋 button
 *   onOnline  – they just came online while we have the chat open
 *   onCleared – they cleared the whole chat (we drop it from our screen too)
 */
export function usePresence(userId, pairs, share, handlers = {}) {
  const [online, setOnline] = useState({});
  const [typing, setTyping] = useState({});
  const chans = useRef({});
  const timers = useRef({});
  const hRef = useRef(handlers);
  hRef.current = handlers;
  const key = pairs.map((p) => p.id).sort().join(',');

  useEffect(() => {
    const created = [];
    const was = {};      // last known online state per partner
    const startedAt = {}; // presence that arrives right after subscribing is "already online", not "just came online"
    pairs.forEach(({ id, partnerId }) => {
      startedAt[partnerId] = Date.now();
      const ch = supabase.channel(`pair:${id}`, { config: { presence: { key: userId }, broadcast: { self: false } } });
      ch.on('presence', { event: 'sync' }, () => {
        const st = ch.presenceState();
        const on = !!st[partnerId]?.length;
        setOnline((o) => ({ ...o, [partnerId]: on }));
        if (on && !was[partnerId] && Date.now() - startedAt[partnerId] > 4000) hRef.current.onOnline?.(partnerId);
        was[partnerId] = on;
      })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if (payload?.user !== partnerId) return;
          setTyping((t) => ({ ...t, [partnerId]: !!payload.typing }));
          clearTimeout(timers.current[partnerId]);
          if (payload.typing) {
            timers.current[partnerId] = setTimeout(() => setTyping((t) => ({ ...t, [partnerId]: false })), 4000);
          }
        })
        .on('broadcast', { event: 'nudge' }, ({ payload }) => {
          if (payload?.user === partnerId) hRef.current.onNudge?.(partnerId);
        })
        .on('broadcast', { event: 'cleared' }, ({ payload }) => {
          if (payload?.user === partnerId) hRef.current.onCleared?.(partnerId);
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED' && share && document.visibilityState === 'visible') await ch.track({ at: Date.now() });
        });
      chans.current[partnerId] = ch;
      created.push(ch);
    });

    const onVis = () => created.forEach((ch) => {
      if (document.visibilityState === 'visible' && share) ch.track({ at: Date.now() }); else ch.untrack();
    });
    document.addEventListener('visibilitychange', onVis);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      created.forEach((ch) => supabase.removeChannel(ch));
      chans.current = {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, key, share]);

  const sendTyping = useCallback((partnerId, isTyping) => {
    if (!share) return;
    chans.current[partnerId]?.send({ type: 'broadcast', event: 'typing', payload: { user: userId, typing: isTyping } });
  }, [userId, share]);

  const sendNudge = useCallback((partnerId) => {
    chans.current[partnerId]?.send({ type: 'broadcast', event: 'nudge', payload: { user: userId } });
  }, [userId]);

  const sendCleared = useCallback((partnerId) => {
    chans.current[partnerId]?.send({ type: 'broadcast', event: 'cleared', payload: { user: userId } });
  }, [userId]);

  return { online, typing, sendTyping, sendNudge, sendCleared };
}
