import { useCallback, useEffect, useState } from 'react';

// Per-device preferences (stored in this browser only)
const KEY = 'cc_settings';
export const DEFAULTS = {
  theme: 'system',     // system | light | dark
  lockBgSec: 30,       // lock after this many seconds in the background
  lockIdleSec: 120,    // lock after this many seconds without touching the screen (0 = never)
  bioCred: null,       // enrolled Face ID / fingerprint credential id
  pinFallback: false,  // allow the 4-digit PIN even when biometrics are enrolled
  shareStatus: true,   // share my online status + typing indicator
};

export function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) {}
  window.dispatchEvent(new Event('cc-settings'));
}

export function useSettings() {
  const [s, setS] = useState(DEFAULTS);
  useEffect(() => {
    const sync = () => setS(loadSettings());
    sync();
    window.addEventListener('cc-settings', sync);
    return () => window.removeEventListener('cc-settings', sync);
  }, []);
  const update = useCallback((patch) => saveSettings({ ...loadSettings(), ...patch }), []);
  return [s, update];
}
