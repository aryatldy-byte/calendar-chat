// "Let them know I'm online": pushes a generic reminder to the other person's devices.
// Only linked, approved users can nudge each other; limited to 1 per minute per pair.
import { adminClient, missingEnv, sendToUser } from '../../src/utils/pushServer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const missing = missingEnv(['VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (missing.length) return res.status(500).json({ error: `server is missing: ${missing.join(', ')}` });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const partnerId = req.body?.partnerId;
  if (!token || typeof partnerId !== 'string') return res.status(400).json({ error: 'bad request' });

  try {
    const admin = adminClient();
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u?.user) return res.status(401).json({ error: 'invalid session' });
    const me = u.user.id;

    // both approved + linked by the admin
    const { data: people } = await admin.from('users').select('id,approved,rejected').in('id', [me, partnerId]);
    if ((people || []).length !== 2 || people.some((p) => !p.approved || p.rejected)) return res.status(403).json({ error: 'not allowed' });
    const [a, b] = [me, partnerId].sort();
    const { data: pair } = await admin.from('pairings').select('id').eq('user_a', a).eq('user_b', b).maybeSingle();
    if (!pair) return res.status(403).json({ error: 'not allowed' });

    // rate limit: 1 per 60 s
    const since = new Date(Date.now() - 60000).toISOString();
    const { data: recent } = await admin.from('nudges').select('id').eq('sender_id', me).eq('receiver_id', partnerId)
      .gt('created_at', since).limit(1);
    if (recent?.length) return res.status(429).json({ error: 'Please wait a minute before nudging again.' });
    await admin.from('nudges').insert({ sender_id: me, receiver_id: partnerId });
    admin.from('nudges').delete().lt('created_at', new Date(Date.now() - 86400e3).toISOString()); // tidy old rows

    const out = await sendToUser(admin, partnerId, 'Event reminder', { kind: 'nudge' });
    return res.status(200).json({ sent: out.results.filter((r) => r.ok).length, devices: out.subscriptions });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
