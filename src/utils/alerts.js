// Decoy-calendar alerts (used by the fake-PIN "Add event / Set alert" window): stored only in this browser.
const KEY = 'cc_alerts';
export function loadAlerts() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch (_) { return []; }
}
export function saveAlerts(a) {
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (_) {}
}
