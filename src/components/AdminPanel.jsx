import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../utils/supabaseClient';

const PURGES = [
  { label: 'Sent over 5 minutes ago', minutes: 5 },
  { label: 'Sent over 7 days ago', minutes: 7 * 24 * 60 },
  { label: 'Delete everything', minutes: 0 },
];

export default function AdminPanel({ user, onSignOut }) {
  const [users, setUsers] = useState([]);
  const [count, setCount] = useState(null);
  const [pairs, setPairs] = useState([]);
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const [msg, setMsg] = useState('');

  const load = useCallback(async () => {
    const [u, ad, c, pr] = await Promise.all([
      supabase.from('users').select('*').order('created_at', { ascending: false }),
      supabase.from('admins').select('id'),
      supabase.rpc('admin_message_count'),
      supabase.from('pairings').select('*').order('created_at', { ascending: false }),
    ]);
    const adminIds = new Set((ad.data || []).map((x) => x.id));
    setUsers((u.data || []).filter((x) => !adminIds.has(x.id)));
    setPairs(pr.data || []);
    setCount(c.error ? null : Number(c.data));
  }, []);

  useEffect(() => { load(); }, [load]);

  async function setStatus(id, approved, rejected) {
    setMsg('');
    const { error } = await supabase.from('users').update({ approved, rejected }).eq('id', id);
    if (error) setMsg(error.message);
    load();
  }

  async function link() {
    setMsg('');
    const { error } = await supabase.rpc('admin_pair_users', { a, b });
    setMsg(error ? error.message : 'Linked.');
    if (!error) { setA(''); setB(''); }
    load();
  }

  async function unlink(id) {
    const { error } = await supabase.from('pairings').delete().eq('id', id);
    if (error) setMsg(error.message);
    load();
  }

  async function purge({ label, minutes }) {
    if (!confirm(`Delete messages: ${label.toLowerCase()}?`)) return;
    const { data, error } = await supabase.rpc('admin_purge_messages', { older_than_minutes: minutes });
    setMsg(error ? error.message : `Deleted ${data} message(s).`);
    load();
  }

  const group = (title, list, actions) => (
    <section className="rounded-xl border border-slate-200 bg-white">
      <h2 className="border-b border-slate-100 px-4 py-3 font-semibold text-slate-800">{title} ({list.length})</h2>
      {list.length === 0 && <p className="px-4 py-3 text-sm text-slate-500">None.</p>}
      <ul className="divide-y divide-slate-100">
        {list.map((u) => (
          <li key={u.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-slate-800">{u.email}</div>
              <div className="text-xs text-slate-500">Signed up {new Date(u.created_at).toLocaleString()}</div>
            </div>
            <div className="flex gap-2">{actions(u)}</div>
          </li>
        ))}
      </ul>
    </section>
  );

  const btn = 'rounded-lg px-3 py-1.5 text-sm font-medium';
  const pending = users.filter((u) => !u.approved && !u.rejected);
  const approved = users.filter((u) => u.approved);
  const rejected = users.filter((u) => u.rejected);
  const emailOf = (id) => users.find((u) => u.id === id)?.email || 'unknown';

  return (
    <div className="min-h-full bg-slate-50">
      <header className="flex items-center justify-between bg-wa-dark px-4 py-3 text-white">
        <div>
          <div className="font-semibold">Admin</div>
          <div className="text-xs text-white/70">{user.email}</div>
        </div>
        <button onClick={onSignOut} className="rounded-full px-3 py-1 text-sm hover:bg-white/10">Sign out</button>
      </header>

      <main className="mx-auto max-w-2xl space-y-4 p-4">
        {msg && <p className="rounded-lg bg-amber-100 px-3 py-2 text-sm text-amber-900">{msg}</p>}

        {group('Pending approval', pending, (u) => (
          <>
            <button onClick={() => setStatus(u.id, true, false)} className={`${btn} bg-wa-teal text-white hover:bg-wa-dark`}>Approve</button>
            <button onClick={() => setStatus(u.id, false, true)} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Reject</button>
          </>
        ))}
        {group('Approved', approved, (u) => (
          <button onClick={() => setStatus(u.id, false, false)} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Revoke</button>
        ))}
        {group('Rejected', rejected, (u) => (
          <button onClick={() => setStatus(u.id, false, false)} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Reconsider</button>
        ))}

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-800">Who can chat with whom ({pairs.length})</h2>
          <p className="mt-1 text-sm text-slate-500">Approved users can only message people they are linked with.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {[[a, setA], [b, setB]].map(([val, set], i) => (
              <select key={i} value={val} onChange={(e) => set(e.target.value)}
                className="min-w-0 flex-1 rounded-lg border border-slate-300 px-2 py-2 text-sm">
                <option value="">Choose user…</option>
                {approved.map((u) => <option key={u.id} value={u.id}>{u.email}</option>)}
              </select>
            ))}
            <button onClick={link} disabled={!a || !b || a === b}
              className={`${btn} bg-wa-teal text-white hover:bg-wa-dark disabled:opacity-50`}>Link</button>
          </div>
          <ul className="mt-3 divide-y divide-slate-100">
            {pairs.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 py-2 text-sm text-slate-800">
                <span className="min-w-0 truncate">{emailOf(p.user_a)} ↔ {emailOf(p.user_b)}</span>
                <button onClick={() => unlink(p.id)} className={`${btn} border border-slate-300 text-slate-700 hover:bg-slate-50`}>Unlink</button>
              </li>
            ))}
            {pairs.length === 0 && <li className="py-2 text-sm text-slate-500">No links yet.</li>}
          </ul>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-4">
          <h2 className="font-semibold text-slate-800">Messages in database: {count ?? '—'}</h2>
          <p className="mt-1 text-sm text-slate-500">Messages are hidden in the chat after 5 minutes, but stay in the database until purged.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {PURGES.map((p) => (
              <button key={p.label} onClick={() => purge(p)} className={`${btn} border border-red-300 text-red-700 hover:bg-red-50`}>
                {p.label}
              </button>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
