// Called by a Supabase Database Webhook on INSERT into public.messages.
// Sends a Web Push to the recipient's devices. The notification is deliberately generic
// (no message text) so nothing sensitive appears on a lock screen.
import crypto from 'crypto';
import { adminClient, missingEnv, sendToUser } from '../../src/utils/pushServer';

function sameSecret(a = '', b = '') {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const missing = missingEnv(['WEBHOOK_SECRET', 'VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (missing.length) return res.status(500).json({ error: 'push is not configured on the server', missing });
  if (!sameSecret(req.headers['x-webhook-secret'], process.env.WEBHOOK_SECRET)) {
    return res.status(401).json({ error: 'unauthorized (x-webhook-secret does not match WEBHOOK_SECRET)' });
  }

  const { type, record } = req.body || {};
  if (type !== 'INSERT' || !record?.receiver_id) return res.status(200).json({ skipped: true });

  try {
    const out = await sendToUser(adminClient(), record.receiver_id);
    console.log('notify', { receiver: record.receiver_id, subscriptions: out.subscriptions, results: out.results });
    return res.status(200).json(out);
  } catch (e) {
    console.error('notify error', e.message);
    return res.status(500).json({ error: e.message });
  }
}
