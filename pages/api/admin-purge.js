// Admin purge: deletes messages AND their photo/voice files from Storage.
// (Deleting rows in SQL alone would leave the files behind.)
import { adminClient, missingEnv } from '../../src/utils/pushServer';

const BUCKET = 'chat-media';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  const missing = missingEnv(['SUPABASE_SERVICE_ROLE_KEY']);
  if (missing.length) return res.status(500).json({ error: `server is missing: ${missing.join(', ')}` });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'not signed in' });

  const minutes = Number(req.body?.minutes);
  if (!Number.isFinite(minutes) || minutes < 0) return res.status(400).json({ error: 'invalid minutes' });

  try {
    const admin = adminClient();
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u?.user) return res.status(401).json({ error: 'invalid session' });
    const { data: isAdmin } = await admin.from('admins').select('id').eq('id', u.user.id).maybeSingle();
    if (!isAdmin) return res.status(403).json({ error: 'not an admin' });

    const cutoff = new Date(Date.now() - minutes * 60000 + (minutes === 0 ? 1000 : 0)).toISOString();
    let messages = 0, files = 0;
    for (let round = 0; round < 50; round++) {
      const { data: rows, error } = await admin.from('messages').select('id,media_path')
        .lt('timestamp', cutoff).limit(500);
      if (error) throw new Error(error.message);
      if (!rows?.length) break;
      const paths = rows.map((r) => r.media_path).filter(Boolean);
      for (let i = 0; i < paths.length; i += 100) {
        const { error: re } = await admin.storage.from(BUCKET).remove(paths.slice(i, i + 100));
        if (!re) files += paths.slice(i, i + 100).length;
      }
      const { error: de } = await admin.from('messages').delete().in('id', rows.map((r) => r.id));
      if (de) throw new Error(de.message);
      messages += rows.length;
    }
    return res.status(200).json({ messages, files });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
