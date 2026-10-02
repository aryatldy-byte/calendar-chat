import { useEffect, useState } from 'react';
import { supabase } from '../src/utils/supabaseClient';
import AdminPanel from '../src/components/AdminPanel';

export default function AdminPage() {
  const [session, setSession] = useState(undefined);
  const [isAdmin, setIsAdmin] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user?.id;
  useEffect(() => {
    if (!uid) return setIsAdmin(null);
    supabase.from('admins').select('id').eq('id', uid).maybeSingle()
      .then(({ data }) => setIsAdmin(!!data));
  }, [uid]);

  async function login(e) {
    e.preventDefault(); setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
  }

  if (session === undefined || (session && isAdmin === null)) return null;

  if (session && isAdmin) {
    return <AdminPanel user={session.user} onSignOut={() => supabase.auth.signOut()} />;
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-slate-50 p-4">
      <form onSubmit={login} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-lg">
        <h1 className="text-lg font-semibold text-slate-800">Admin sign in</h1>
        {session && <p className="mt-2 text-sm text-red-600">This account is not an admin.</p>}
        <input type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-4 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wa-teal" />
        <input type="password" required placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)}
          className="mt-3 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wa-teal" />
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <button className="mt-5 w-full rounded-lg bg-wa-teal py-2.5 font-medium text-white hover:bg-wa-dark">Sign in</button>
        {session && (
          <button type="button" onClick={() => supabase.auth.signOut()} className="mt-2 w-full text-sm text-slate-500 hover:underline">
            Sign out
          </button>
        )}
      </form>
    </div>
  );
}
