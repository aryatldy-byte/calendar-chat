// Round avatar with a colour picked from the person's name (stable) and an optional green "online" dot.
const TONES = [
  'from-teal-500 to-emerald-600', 'from-sky-500 to-indigo-600', 'from-fuchsia-500 to-purple-600',
  'from-amber-500 to-orange-600', 'from-rose-500 to-pink-600', 'from-lime-500 to-green-600',
  'from-cyan-500 to-blue-600', 'from-violet-500 to-purple-700',
];
const hash = (s) => [...String(s || '?')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export default function Avatar({ name, online = false, size = 'h-10 w-10 text-base', ring = 'border-white dark:border-[#111b21]' }) {
  return (
    <span className={`relative flex shrink-0 items-center justify-center rounded-full bg-gradient-to-br font-semibold uppercase text-white shadow-sm ${TONES[hash(name) % TONES.length]} ${size}`}>
      {String(name || '?')[0]}
      {online && <span className={`absolute bottom-0 right-0 h-3 w-3 rounded-full border-2 bg-wa-green ${ring}`} aria-label="online" />}
    </span>
  );
}
