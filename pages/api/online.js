// "I just came online": the chat calls this when someone opens it. Every linked partner who has "online alerts" on
// gets a push notification. The text is generic on purpose ("Event reminder") so nothing is revealed on a lock screen.
// Limited to one alert per pair every ONLINE_COOLDOWN (5 min) so opening/closing the app can't spam anyone.
import { requireUser } from '../../src/utils/serverAuth';
import { sendToUser } from '../../src/utils/pushServer';
import { ONLINE_COOLDOWN } from '../../src/utils/constants';

export default async function handler(req, res) {
  const ctx = await requireUser(req, res, ['VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY']);
  if (!ctx) return;
  const { admin, me } = ctx;

  try {
    const { data: pairs, error: pe } = await admin.from('pairings').select('user_a,user_b').or(`user_a.eq.${me},user_b.eq.${me}`);
    if (pe) throw new Error(pe.message);
    const ids = (pairs || []).map((p) => (p.user_a === me ? p.user_b : p.user_a));
    if (!ids.length) return res.status(200).json({ notified: 0 });

    // Receivers must be approved and have online alerts on (column added by migration 008; tolerate it missing)
    let q = await admin.from('users').select('id,approved,rejected,online_alerts').in('id', ids);
    if (q.error && /online_alerts/.test(q.error.message)) q = await admin.from('users').select('id,approved,rejected').in('id', ids);
    if (q.error) throw new Error(q.error.message);
    const receivers = (q.data || []).filter((u) => u.approved && !u.rejected && u.online_alerts !== false).map((u) => u.id);

    const since = new Date(Date.now() - ONLINE_COOLDOWN).toISOString();
    let notified = 0;
    await Promise.all(receivers.map(async (rid) => {
      const { data: recent } = await admin.from('nudges').select('id')
        .eq('sender_id', me).eq('receiver_id', rid).eq('kind', 'online').gt('created_at', since).limit(1);
      if (recent?.length) return;
      await admin.from('nudges').insert({ sender_id: me, receiver_id: rid, kind: 'online' });
      const out = await sendToUser(admin, rid, 'Event reminder', { kind: 'online' }, 120);
      if (out.results.some((r) => r.ok)) notified += 1;
    }));
    await admin.from('nudges').delete().lt('created_at', new Date(Date.now() - 86400e3).toISOString()); // tidy old rows
    return res.status(200).json({ notified });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
