import { supabase } from './supabaseClient';

/** POST JSON to one of our /api routes with the signed-in user's token. */
export async function postApi(path, body = {}) {
  const { data } = await supabase.auth.getSession();
  const r = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, json };
}
