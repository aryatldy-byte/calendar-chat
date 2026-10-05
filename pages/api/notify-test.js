// Self-test: a signed-in user asks the server to push a test notification to their own devices.
// Reports exactly which step fails (missing env, no subscription, push service rejection).
import { adminClient, missingEnv, sendToUser } from '../../src/utils/pushServer';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const missing = missingEnv(['VAPID_PRIVATE_KEY', 'NEXT_PUBLIC_VAPID_PUBLIC_KEY', 'SUPABASE_SERVICE_ROLE_KEY']);
  if (missing.length) return res.status(500).json({ error: 'server is missing settings', missing });

  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return res.status(401).json({ error: 'not signed in' });

  try {
    const admin = adminClient();
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data?.user) return res.status(401).json({ error: 'invalid session' });
    const out = await sendToUser(admin, data.user.id, 'Test notification');
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
