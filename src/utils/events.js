// Decoy-calendar events: stored only in this browser (localStorage).
const KEY = 'cc_events';
export const keyOf = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
export function loadEvents() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (_) { return {}; }
}
export function saveEvents(e) {
  try { localStorage.setItem(KEY, JSON.stringify(e)); } catch (_) {}
}
