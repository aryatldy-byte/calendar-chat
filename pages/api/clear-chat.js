// "Clear chat": permanently deletes every message (and photo/voice file) between the caller and one linked partner.
// This removes the conversation for BOTH people. Only linked, approved users can do it.
import { requireUser, arePaired, UUID } from '../../src/utils/serverAuth';
import { deleteMessages } from '../../src/utils/purgeServer';

export default async function handler(req, res) {
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { admin, me } = ctx;
  const partnerId = req.body?.partnerId;
  if (typeof partnerId !== 'string' || !UUID.test(partnerId) || partnerId === me) return res.status(400).json({ error: 'bad request' });

  try {
    if (!(await arePaired(admin, me, partnerId))) return res.status(403).json({ error: 'not allowed' });
    const out = await deleteMessages(admin, (q) =>
      q.or(`and(sender_id.eq.${me},receiver_id.eq.${partnerId}),and(sender_id.eq.${partnerId},receiver_id.eq.${me})`));
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
