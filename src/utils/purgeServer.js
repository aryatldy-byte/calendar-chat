// Server-only: deletes messages AND their photo/voice files (deleting rows alone would leave files in Storage).
const BUCKET = 'chat-media';

/**
 * scope(query) must add the filters that pick which messages to delete, e.g.
 *   (q) => q.or('...')
 * Returns how many messages / files were removed.
 */
export async function deleteMessages(admin, scope, maxRounds = 50) {
  let messages = 0, files = 0;
  for (let round = 0; round < maxRounds; round++) {
    const { data: rows, error } = await scope(admin.from('messages').select('id,media_path').limit(500));
    if (error) throw new Error(error.message);
    if (!rows?.length) break;
    const paths = rows.map((r) => r.media_path).filter(Boolean);
    for (let i = 0; i < paths.length; i += 100) {
      const chunk = paths.slice(i, i + 100);
      const { error: re } = await admin.storage.from(BUCKET).remove(chunk);
      if (!re) files += chunk.length;
    }
    const { error: de } = await admin.from('messages').delete().in('id', rows.map((r) => r.id));
    if (de) throw new Error(de.message);
    messages += rows.length;
  }
  return { messages, files };
}
