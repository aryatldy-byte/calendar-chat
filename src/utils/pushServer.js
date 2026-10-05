// Server-side helpers shared by /api/notify (webhook) and /api/notify-test (self-test).
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from './supabaseClient';

export const missingEnv = (names) => names.filter((n) => !process.env[n]);

export const adminClient = () =>
  createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

export async function sendToUser(admin, userId, body = 'New event added') {
  webpush.setVapidDetails(
    (process.env.VAPID_SUBJECT || 'mailto:admin@example.com').trim(),
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY.trim(),
    process.env.VAPID_PRIVATE_KEY.trim()
  );
  const { data: subs, error } = await admin
    .from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', userId);
  if (error) throw new Error(error.message);

  const payload = JSON.stringify({ title: 'Calendar', body });
  const results = await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 300, urgency: 'high' }
      );
      return { ok: true };
    } catch (e) {
      console.error('push failed', e.statusCode, String(e.body || e.message).slice(0, 200));
      if (e.statusCode === 404 || e.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', s.id); // expired subscription
      }
      return { ok: false, status: e.statusCode, detail: String(e.body || e.message).slice(0, 200) };
    }
  }));
  return { subscriptions: (subs || []).length, results };
}
