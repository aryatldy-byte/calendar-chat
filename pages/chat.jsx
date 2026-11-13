import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../src/utils/supabaseClient';
import { MONTHS, readUnlock, clearUnlock } from '../src/utils/unlock';
import { useSettings } from '../src/utils/settings';
import { useAutoLock } from '../src/utils/autoLock';
import ChatWindow from '../src/components/ChatWindow';
import SignupForm from '../src/components/SignupForm';
import { disablePush } from '../src/utils/push';

export default function ChatPage() {
  const router = useRouter();
  const [settings] = useSettings();
  const [month, setMonth] = useState(null);
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(null);

  // Must have unlocked on the calendar
  useEffect(() => {
    const m = readUnlock();
    if (m === null) router.replace('/');
    else setMonth(m);
  }, [router]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const uid = session?.user?.id;
  const loadProfile = useCallback(async () => {
    if (!uid) return setProfile(null);
    const { data } = await supabase.from('users').select('*').eq('id', uid).maybeSingle();
    setProfile(data);
  }, [uid]);
  useEffect(() => { loadProfile(); }, [loadProfile]);

  const lock = useCallback(() => { clearUnlock(); router.replace('/'); }, [router]);
  const shield = useAutoLock({
    enabled: month !== null, bgSec: settings.lockBgSec, idleSec: settings.lockIdleSec, onLock: lock,
  });

  const signOut = async () => {
    try { await disablePush(); } catch (_) {} // stop notifications for this device before leaving
    await supabase.auth.signOut();
  };

  if (month === null || session === undefined) return null;

  const body = session && profile?.approved && !profile.rejected ? (
    <ChatWindow user={session.user} monthName={MONTHS[month]} onBack={lock} onLock={lock} onSignOut={signOut} />
  ) : (
    <SignupForm session={session} profile={profile} onRefresh={loadProfile} onSignOut={signOut} onBack={lock} />
  );

  return (
    <>
      {body}
      {/* Cover shown when the app is in the background / app switcher */}
      {shield && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-900 text-sm text-slate-500" aria-hidden="true">
          Calendar
        </div>
      )}
    </>
  );
}
