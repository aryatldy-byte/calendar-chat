import { supabase } from './supabaseClient';

const VAPID_PUBLIC = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

export const pushSupported = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

function toKey(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function currentSub() {
  const reg = await navigator.serviceWorker.ready;
  return { reg, sub: await reg.pushManager.getSubscription() };
}

export async function isPushEnabled() {
  if (!pushSupported() || Notification.permission !== 'granted') return false;
  return !!(await currentSub()).sub;
}

export async function enablePush(userId) {
  if (!VAPID_PUBLIC) throw new Error('Notifications are not configured (missing NEXT_PUBLIC_VAPID_PUBLIC_KEY).');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notification permission was not granted.');
  const { reg, sub: existing } = await currentSub();
  const want = toKey(VAPID_PUBLIC);
  let sub = existing;
  if (sub) {
    // A subscription made with a different VAPID key can never receive pushes -> recreate it
    const k = sub.options?.applicationServerKey;
    const have = k ? new Uint8Array(k) : null;
    if (!have || have.length !== want.length || have.some((v, i) => v !== want[i])) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
  const j = sub.toJSON();
  const { error } = await supabase.from('push_subscriptions').upsert(
    { user_id: userId, endpoint: j.endpoint, p256dh: j.keys.p256dh, auth: j.keys.auth },
    { onConflict: 'endpoint' }
  );
  if (error) throw new Error(error.message);
}

export async function disablePush() {
  if (!pushSupported()) return;
  const { sub } = await currentSub();
  if (!sub) return;
  await supabase.from('push_subscriptions').delete().eq('endpoint', sub.endpoint);
  await sub.unsubscribe();
}

/** Asks the server to push a test notification to this account's devices; returns a human-readable result. */
export async function testPush() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const r = await fetch('/api/notify-test', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
  const j = await r.json().catch(() => ({}));
  if (j.missing?.length) return { ok: false, text: `Server is missing: ${j.missing.join(', ')}. Add in Vercel, then redeploy.` };
  if (!r.ok) return { ok: false, text: `Server error: ${j.error || r.status}` };
  if (!j.subscriptions) return { ok: false, text: 'No device is registered for this account. Turn the bell off, then on again.' };
  const bad = j.results.find((x) => !x.ok);
  if (bad) {
    const hint = bad.status === 403 ? 'Key mismatch: turn the bell off and on again.'
      : bad.status === 404 || bad.status === 410 ? 'This device registration expired: turn the bell on again.'
      : bad.status === 401 ? 'Server VAPID keys are wrong (public and private must be the same pair).'
      : bad.detail;
    return { ok: false, text: `Push rejected (${bad.status || 'error'}). ${hint}` };
  }
  return { ok: true, text: 'Test sent. If nothing appears, check phone settings (and on iPhone, use the home-screen app).' };
}
