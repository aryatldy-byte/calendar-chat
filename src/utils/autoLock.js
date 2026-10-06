import { useEffect, useRef, useState } from 'react';

// Temporarily disable auto-lock (e.g. while the photo picker, camera or microphone prompt is open)
let holdUntil = 0;
export const holdLock = (ms = 60000) => { holdUntil = Math.max(holdUntil, Date.now() + ms); };

/**
 * - Returns `shield` = true whenever the app is in the background / unfocused (render a cover over the chat so
 *   the app-switcher preview shows nothing).
 * - Calls onLock() after `bgSec` seconds in the background, or `idleSec` seconds without interaction.
 */
export function useAutoLock({ enabled, bgSec, idleSec, onLock }) {
  const [shield, setShield] = useState(false);
  const lockRef = useRef(onLock);
  lockRef.current = onLock;

  useEffect(() => {
    if (!enabled) return undefined;
    let hiddenAt = null;
    let last = Date.now();
    const lock = () => {
      if (Date.now() < holdUntil) return false;
      lockRef.current();
      return true;
    };
    const hide = () => {
      setShield(true);
      if (hiddenAt === null && document.visibilityState === 'hidden') hiddenAt = Date.now();
    };
    const show = () => {
      if (document.visibilityState !== 'visible') return;
      if (hiddenAt !== null && bgSec > 0 && Date.now() - hiddenAt >= bgSec * 1000 && lock()) return;
      hiddenAt = null; last = Date.now(); setShield(false);
    };
    const onVis = () => (document.visibilityState === 'hidden' ? hide() : show());
    const touch = () => { last = Date.now(); };
    const idle = setInterval(() => {
      if (idleSec > 0 && document.visibilityState === 'visible' && Date.now() - last > idleSec * 1000) {
        last = Date.now();
        lock();
      }
    }, 5000);

    const acts = ['pointerdown', 'keydown', 'touchstart', 'scroll'];
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', hide);
    window.addEventListener('blur', hide);
    window.addEventListener('focus', show);
    acts.forEach((a) => window.addEventListener(a, touch, { passive: true }));
    return () => {
      clearInterval(idle);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('blur', hide);
      window.removeEventListener('focus', show);
      acts.forEach((a) => window.removeEventListener(a, touch));
    };
  }, [enabled, bgSec, idleSec]);

  return shield;
}
