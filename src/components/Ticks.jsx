/** pending -> ✓ grey · sent/delivered (saved in Supabase) -> ✓✓ grey · seen -> ✓✓ blue */
export default function Ticks({ status }) {
  const double = status !== 'pending';
  const label = status === 'pending' ? 'Sending' : status === 'seen' ? 'Seen' : 'Delivered';
  return (
    <svg role="img" aria-label={label} width="18" height="12" viewBox="0 0 18 12" fill="none"
      stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"
      className={status === 'seen' ? 'text-[#53bdeb]' : 'text-slate-500 dark:text-slate-400'}>
      <path d="M1 6.5l3.5 3.5L11 2" />
      {double && <path d="M4.5 6.5l3.5 3.5L14.5 2" transform="translate(2.5 0)" />}
    </svg>
  );
}
