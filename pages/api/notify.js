// Called by a Supabase Database Webhook on INSERT into public.messages.
// Sends a Web Push to the recipient's devices. The notification is deliberately generic
// (no message text) so nothing sensitive appears on a lock screen.
import crypto from 'crypto';
import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL } from '../../src/utils/supabaseClient';

function sameSecret(a = '', b = '') {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const { WEBHOOK_SECRET, VAPID_PRIVATE_KEY, SUPABASE_SERVICE_ROLE_KEY, VAPID_SUBJECT } = process.env;
  const vapidPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!WEBHOOK_SECRET || !VAPID_PRIVATE_KEY || !vapidPublic || !SUPABASE_SERVICE_ROLE_KEY) {
    return res.status(500).json({ error: 'push is not configured on the server' });
  }
  if (!sameSecret(req.headers['x-webhook-secret'], WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const { type, record } = req.body || {};
  if (type !== 'INSERT' || !record?.receiver_id) return res.status(200).json({ skipped: true });

  webpush.setVapidDetails(VAPID_SUBJECT || 'mailto:admin@example.com', vapidPublic, VAPID_PRIVATE_KEY);
  const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const { data: subs, error } = await admin
    .from('push_subscriptions').select('id,endpoint,p256dh,auth').eq('user_id', record.receiver_id);
  if (error) return res.status(500).json({ error: error.message });

  const payload = JSON.stringify({ title: 'Calendar', body: 'New event added' });
  let sent = 0;
  await Promise.all((subs || []).map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        payload,
        { TTL: 300, urgency: 'high' } // messages vanish after 5 min anyway
      );
      sent++;
    } catch (e) {
      if (e.statusCode === 404 || e.statusCode === 410) {
        await admin.from('push_subscriptions').delete().eq('id', s.id); // expired subscription
      }
    }
  }));
  return res.status(200).json({ sent });
}
