import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { supabase } from '../src/utils/supabaseClient';
import { MONTHS, readUnlock, clearUnlock } from '../src/utils/unlock';
import ChatWindow from '../src/components/ChatWindow';
import SignupForm from '../src/components/SignupForm';
import { disablePush } from '../src/utils/push';

export default function ChatPage() {
  const router = useRouter();
  const [month, setMonth] = useState(null);
  const [session, setSession] = useState(undefined); // undefined = still loading
  const [profile, setProfile] = useState(null);

  // Must have entered the PIN on the calendar
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

  const back = () => { clearUnlock(); router.push('/'); };
  const signOut = async () => {
    try { await disablePush(); } catch (_) {} // stop notifications for this device before leaving
    await supabase.auth.signOut();
  };

  if (month === null || session === undefined) return null;

  if (session && profile?.approved && !profile.rejected) {
    return <ChatWindow user={session.user} monthName={MONTHS[month]} onBack={back} onSignOut={signOut} />;
  }
  return <SignupForm session={session} profile={profile} onRefresh={loadProfile} onSignOut={signOut} onBack={back} />;
}
