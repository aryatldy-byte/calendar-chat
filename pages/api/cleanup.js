// Daily cron (see vercel.json), safety net for everyone:
//  1) deletes expired messages (seen more than 15 min ago, or deleted-for-everyone more than 15 min ago) incl. their files;
//  2) removes photo/voice FILES never seen after 7 days (the message row stays; the media shows as unavailable).
// (While the chat is open, /api/purge-expired already does step 1 every minute.)
// Needs CRON_SECRET in Vercel (Vercel sends it automatically as a Bearer token).
import crypto from 'crypto';
import { adminClient, missingEnv } from '../../src/utils/pushServer';
import { deleteMessages } from '../../src/utils/purgeServer';
import { TTL } from '../../src/utils/constants';

const BUCKET = 'chat-media';
const same = (a = '', b = '') => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

export default async function handler(req, res) {
  const missing = missingEnv(['CRON_SECRET', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (missing.length) return res.status(500).json({ error: `not configured: ${missing.join(', ')}` });
  if (!same(req.headers.authorization, `Bearer ${process.env.CRON_SECRET}`)) return res.status(401).json({ error: 'unauthorized' });

  const admin = adminClient();
  const hour = new Date(Date.now() - 3600e3).toISOString();
  const week = new Date(Date.now() - 7 * 86400e3).toISOString();
  let files = 0;
  try {
    const cutoff = new Date(Date.now() - TTL).toISOString();
    const expired = await deleteMessages(admin, (q) => q.or(`and(status.eq.seen,seen_at.lt.${cutoff}),deleted_at.lt.${cutoff}`));
    files += expired.files;
    const queries = [
      admin.from('messages').select('id,media_path').not('media_path', 'is', null).eq('status', 'seen').lt('seen_at', hour).limit(500),
      admin.from('messages').select('id,media_path').not('media_path', 'is', null).lt('timestamp', week).limit(500),
    ];
    for (const q of queries) {
      const { data: rows, error } = await q;
      if (error) throw new Error(error.message);
      if (!rows?.length) continue;
      const paths = rows.map((r) => r.media_path);
      for (let i = 0; i < paths.length; i += 100) {
        await admin.storage.from(BUCKET).remove(paths.slice(i, i + 100));
      }
      await admin.from('messages').update({ media_path: null }).in('id', rows.map((r) => r.id));
      files += rows.length;
    }
    return res.status(200).json({ expiredMessages: expired.messages, files });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
