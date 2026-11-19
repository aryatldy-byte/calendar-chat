// Deletes the caller's messages that have expired: seen more than TTL (15 min) ago, or "deleted for everyone" more than TTL ago.
// The chat calls this every minute while it is open, so expired messages (and their photo/voice files) really leave the database.
// (The daily cron in /api/cleanup does the same for everyone as a safety net.)
import { requireUser } from '../../src/utils/serverAuth';
import { deleteMessages } from '../../src/utils/purgeServer';
import { TTL } from '../../src/utils/constants';

export default async function handler(req, res) {
  const ctx = await requireUser(req, res);
  if (!ctx) return;
  const { admin, me } = ctx;
  try {
    const cutoff = new Date(Date.now() - TTL).toISOString();
    const out = await deleteMessages(admin, (q) =>
      q.or(`sender_id.eq.${me},receiver_id.eq.${me}`)
        .or(`and(status.eq.seen,seen_at.lt.${cutoff}),deleted_at.lt.${cutoff}`), 5);
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
