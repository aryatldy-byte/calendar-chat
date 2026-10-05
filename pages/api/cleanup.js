// Daily cron (see vercel.json): removes photo/voice FILES that are no longer viewable –
// seen more than 1 hour ago, or never seen after 7 days. The message row stays; the media shows as unavailable.
// Needs CRON_SECRET in Vercel (Vercel sends it automatically as a Bearer token).
import crypto from 'crypto';
import { adminClient, missingEnv } from '../../src/utils/pushServer';

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
    return res.status(200).json({ files });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
