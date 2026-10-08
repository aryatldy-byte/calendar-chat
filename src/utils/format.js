export function lastSeenText(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return `last seen today at ${t}`;
  if (d.toDateString() === new Date(Date.now() - 864e5).toDateString()) return `last seen yesterday at ${t}`;
  return `last seen ${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} at ${t}`;
}
