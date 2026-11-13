// Server-only helpers for the /api routes that act on behalf of a signed-in user.
import { adminClient, missingEnv } from './pushServer';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Verifies the Bearer token and that the user is approved. Sends the error response itself and returns null on failure. */
export async function requireUser(req, res, extraEnv = []) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'method not allowed' }); return null; }
  const missing = missingEnv(['SUPABASE_SERVICE_ROLE_KEY', ...extraEnv]);
  if (missing.length) { res.status(500).json({ error: `server is missing: ${missing.join(', ')}` }); return null; }
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) { res.status(401).json({ error: 'not signed in' }); return null; }
  const admin = adminClient();
  const { data: u, error } = await admin.auth.getUser(token);
  if (error || !u?.user) { res.status(401).json({ error: 'invalid session' }); return null; }
  const { data: me } = await admin.from('users').select('id,approved,rejected').eq('id', u.user.id).maybeSingle();
  if (!me || !me.approved || me.rejected) { res.status(403).json({ error: 'not allowed' }); return null; }
  return { admin, me: me.id };
}

/** True when the admin has linked these two users. */
export async function arePaired(admin, a, b) {
  const [x, y] = [a, b].sort();
  const { data } = await admin.from('pairings').select('id').eq('user_a', x).eq('user_b', y).maybeSingle();
  return !!data;
}
