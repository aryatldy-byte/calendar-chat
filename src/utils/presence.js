import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabaseClient';

/**
 * Online status + typing indicator. One realtime channel per linked pair, named after the
 * (random, secret-to-outsiders) pairing id, so only the two people in a pair can find it.
 * pairs: [{ id, partnerId }]. If `share` is false we stop announcing ourselves but still see the other person.
 */
export function usePresence(userId, pairs, share) {
  const [online, setOnline] = useState({});
  const [typing, setTyping] = useState({});
  const chans = useRef({});
  const timers = useRef({});
  const key = pairs.map((p) => p.id).sort().join(',');

  useEffect(() => {
    const created = [];
    pairs.forEach(({ id, partnerId }) => {
      const ch = supabase.channel(`pair:${id}`, { config: { presence: { key: userId }, broadcast: { self: false } } });
      ch.on('presence', { event: 'sync' }, () => {
        const st = ch.presenceState();
        setOnline((o) => ({ ...o, [partnerId]: !!st[partnerId]?.length }));
      })
        .on('broadcast', { event: 'typing' }, ({ payload }) => {
          if (payload?.user !== partnerId) return;
          setTyping((t) => ({ ...t, [partnerId]: !!payload.typing }));
          clearTimeout(timers.current[partnerId]);
          if (payload.typing) {
            timers.current[partnerId] = setTimeout(() => setTyping((t) => ({ ...t, [partnerId]: false })), 4000);
          }
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

  return { online, typing, sendTyping };
}
