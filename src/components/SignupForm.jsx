import { useState } from 'react';
import { supabase } from '../utils/supabaseClient';

/**
 * Not signed in  -> sign-in / sign-up form
 * Signed in, not approved yet -> "pending approval" screen
 */
export default function SignupForm({ session, profile, onRefresh, onSignOut, onBack }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true); setError(''); setNotice('');
    if (mode === 'signup') {
      const { data, error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else if (!data.session) setNotice('Account created. Confirm your email if asked, then sign in. An admin must approve you before you can chat.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
    }
    setBusy(false);
  }

  const shell = (children) => (
    <div className="flex min-h-full items-center justify-center wa-pattern p-4">
      <div className="w-full max-w-sm animate-pop rounded-2xl bg-white p-6 shadow-lg">{children}</div>
    </div>
  );

  if (session) {
    const rejected = profile?.rejected;
    return shell(
      <>
        <h2 className="text-lg font-semibold text-slate-800">
          {rejected ? 'Access denied' : 'Waiting for approval'}
        </h2>
        <p className="mt-2 text-sm text-slate-600">
          {rejected
            ? 'An admin has declined this account.'
            : `Signed in as ${session.user.email}. You can chat as soon as an admin approves your account.`}
        </p>
        <div className="mt-5 flex gap-2">
          {!rejected && (
            <button onClick={onRefresh} className="flex-1 rounded-lg bg-wa-teal py-2 font-medium text-white hover:bg-wa-dark">
              Check again
            </button>
          )}
          <button onClick={onSignOut} className="flex-1 rounded-lg border border-slate-300 py-2 font-medium text-slate-700 hover:bg-slate-50">
            Sign out
          </button>
        </div>
      </>
    );
  }

  return shell(
    <form onSubmit={submit}>
      <h2 className="text-lg font-semibold text-slate-800">{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
      <label className="mt-4 block text-sm text-slate-600">Email
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wa-teal" />
      </label>
      <label className="mt-3 block text-sm text-slate-600">Password
        <input type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-wa-teal" />
      </label>
      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      {notice && <p className="mt-3 text-sm text-emerald-700">{notice}</p>}
      <button disabled={busy} className="mt-5 w-full rounded-lg bg-wa-teal py-2.5 font-medium text-white hover:bg-wa-dark disabled:opacity-60">
        {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Sign up'}
      </button>
      <button type="button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError(''); setNotice(''); }}
        className="mt-3 w-full text-sm text-wa-teal hover:underline">
        {mode === 'login' ? 'New here? Create an account' : 'Have an account? Sign in'}
      </button>
      <button type="button" onClick={onBack} className="mt-1 w-full text-sm text-slate-500 hover:underline">
        Back to calendar
      </button>
    </form>
  );
}
