# Calendar Chat

A private 2‑person chat disguised as a calendar. To anyone glancing at it, it's a normal year calendar.
Click a **month name**, enter the **4‑digit password**, and a WhatsApp‑style chat opens.

**Stack:** Next.js (React) · TailwindCSS · Supabase (Auth, Postgres, Realtime) · Vercel

## How it works

| Piece | Behaviour |
|---|---|
| Calendar (`/`) | Real dates for any year. Clicking a month name opens a PIN modal (5 wrong tries → 30 s lockout). |
| Chat (`/chat`) | Needs the PIN, then a Supabase login. Only **approved** users get in. The admin decides who may chat with whom (many users, private 1‑to‑1 chats). |
| Auto‑hide | A message fades out and disappears from the screen **5 minutes after the recipient has seen it** (blue ticks). Unseen messages stay until they're seen. Frontend only. |
| Admin (`/admin`) | Approve / reject / revoke users, see message count, purge messages. |
| Security | Row Level Security: only the two participants can read messages; admins can purge but **cannot read** content. |

## 1. Set up Supabase (once)

1. Open your project → **SQL Editor** → paste all of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
2. **Authentication → Providers → Email**: keep enabled. (Optional: turn off "Confirm email" for faster testing.)
3. Create the admin: **Authentication → Users → Add user** (email + password, tick *Auto confirm*), then run:
   ```sql
   insert into public.admins (id, email)
   select id, email from auth.users where email = 'you@example.com';
   ```
4. **Authentication → URL Configuration**: add your Vercel URL as *Site URL* (needed for email‑confirmation links).

> The brief's schema lists a `password_hash` column on `users`/`admins`. Supabase Auth already stores salted password hashes in `auth.users`, so those columns exist but stay empty; `users.id` is the Auth user id.

### Already ran `schema.sql` before the ticks update?
Run [`supabase/migration_001_message_status.sql`](supabase/migration_001_message_status.sql) once. (Fresh installs get this from `schema.sql` already.)

### Message ticks
| Ticks | Meaning |
|---|---|
| ✓ grey | Sending – not yet confirmed by Supabase |
| ✓✓ grey | Saved in Supabase (`status = 'sent'`) |
| ✓✓ blue | Recipient opened the chat and saw it (`status = 'seen'`) |

"Seen" is set by the recipient's open chat (tab visible) through the `mark_messages_seen()` function, and the sender's screen updates live via Realtime.

## 2. Run locally

```bash
npm install
npm run dev        # http://localhost:3000
```

`.env.local` is included with your Supabase URL + anon key and the PIN:

```
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
NEXT_PUBLIC_CHAT_PIN=1234
```

**Change `NEXT_PUBLIC_CHAT_PIN` (default `1234`).**

Flow to test: people sign up on `/chat` (after the PIN) → sign in at `/admin` → approve them → **link** pairs under "Who can chat with whom" → they chat.

## 3. Push to GitHub

A git repo with an initial commit is already included.

```bash
git remote add origin https://github.com/<you>/calendar-chat.git
git branch -M main
git push -u origin main
```

`.env.local` is git‑ignored (standard practice), so Vercel gets the variables from its dashboard instead.

## 4. Deploy on Vercel

1. [vercel.com/new](https://vercel.com/new) → import the GitHub repo (framework auto‑detected: Next.js).
2. **Settings → Environment Variables** – add for Production/Preview/Development:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_CHAT_PIN`
3. **Deploy**. Then add the Vercel URL to Supabase *Site URL* (step 1.4).

## Message ticks (✓ ✓✓)

**Upgrading for the "delete after seen" timer:** run `supabase/migration_004_seen_timer.sql` (adds `messages.seen_at`, stamped by the database when a message becomes seen).

| Tick | Meaning |
|---|---|
| ✓ grey | Sending – not yet confirmed by Supabase |
| ✓✓ grey | Delivered – saved in Supabase (`status = 'sent'`) |
| ✓✓ blue | Seen – the recipient has the chat open and visible (`status = 'seen'`) |

**Upgrading an existing database:** run `supabase/migration_002_ticks_and_push.sql` in the SQL Editor (fresh installs get it from `schema.sql`). It adds `messages.status` and lets only the *receiver* change that one column.

## Notifications when the chat isn't open

Uses Web Push, so it works with the app closed. Setup:

1. Run the migration above (creates `push_subscriptions`).
2. **Vercel → Environment Variables** – add these (values are in `.env.local`):
   `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `WEBHOOK_SECRET`, and
   `SUPABASE_SERVICE_ROLE_KEY` (Supabase → Settings → API → *service_role*). Redeploy.
   (New VAPID keys: `npx web-push generate-vapid-keys`.)
3. **Supabase → Database → Webhooks → Create**: table `messages`, event **Insert**, type *HTTP Request*,
   method `POST`, URL `https://YOUR-APP.vercel.app/api/notify`, and add the HTTP header
   `x-webhook-secret: <your WEBHOOK_SECRET>`.
4. Each person opens the chat and taps the **bell** in the header, then allows notifications.

**Android (Chrome):** works in the browser; installing to the home screen is optional.
**iPhone (iOS 16.4+):** push only works for a home-screen app: Safari → Share → *Add to Home Screen*, open it from the icon, then tap the bell.
Signing out turns notifications off for that device, so the next person on a shared phone isn't notified.
Tapping a notification opens the calendar, so the PIN is needed again.

## Multiple users (private 1‑to‑1 chats)

Run `supabase/migration_003_multi_user.sql` (fresh installs get it from `schema.sql`). It removes the 2‑user limit and adds a `pairings` table. Users already approved are linked automatically so your current chat keeps working.

- **Admin → "Who can chat with whom"**: pick two approved users and click **Link** (or **Unlink**).
- A user sees only the people they're linked with. One contact opens straight into the chat; several show a contact list with unread counts.
- Ticks, "seen" and notifications work per conversation. A message only turns blue when that specific chat is open.
- Unlinking someone immediately cuts off access to that conversation (messages are enforced in the database, not just the UI).

### Notifications not arriving? Diagnose in this order

1. In the chat, tap the bell (on), then tap **Test**. It pushes a test notification to your own devices and tells you which step fails:
   - *Server is missing: …* → add those variables in Vercel and **redeploy**.
   - *No device is registered* → turn the bell off and on again (and make sure `push_subscriptions` exists – run migration 002).
   - *Push rejected 403* → key mismatch; turn the bell off/on. *401* → `VAPID_PRIVATE_KEY` doesn't belong to `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.
   - *Test sent* but nothing shows → phone settings (Do Not Disturb, battery saver, iPhone needs the home‑screen app).
2. If **Test works but real messages don't**, the Supabase webhook is the problem: check Database → Webhooks → logs. The URL must be your *production* domain, the header must be exactly `x-webhook-secret` with the `WEBHOOK_SECRET` value, and the other person must have enabled the bell on **their** phone.

## Photos and voice messages

Run `supabase/migration_005_media.sql` (creates the private `chat-media` bucket, 10 MB limit, images + audio only, and the access rules).

- **Photo:** tap the picture icon (camera or gallery). Photos are resized to max 1600 px and re‑encoded, which also strips location/EXIF data.
- **Voice:** when the text box is empty the button is a microphone – tap to record (max 2 min), then tap send or the bin to cancel. Needs HTTPS and microphone permission.
- Files live in a **private** bucket; only the two linked participants can open them (short‑lived signed links).
- **Admin purge** now deletes the files too (via `/api/admin-purge`, which needs `SUPABASE_SERVICE_ROLE_KEY`).
- **Daily cleanup** (`/api/cleanup`, scheduled in `vercel.json`) deletes files seen more than 1 hour ago, or unseen after 7 days. To enable it add an env var `CRON_SECRET` (any long random string) in Vercel and redeploy.
- Voice recorded on Chrome/Android is WebM/Opus; very old iPhones (before iOS 17.4 or so) may not play it. Voice recorded on iPhone is M4A and plays everywhere.

## Security, privacy and chat features (migration 006)

Run `supabase/migration_006_chat_features.sql` (fresh installs get it from `schema.sql`). Earlier migrations (002–005) must already be applied.

**Lock & privacy (per device, ⚙ Settings in the chat)**
- **Auto-lock:** returns to the calendar after 15 s–5 min in the background, or after 1–5 min idle. The 🔒 button locks instantly.
- **App-switcher cover:** the chat is covered whenever the app is backgrounded or unfocused. This is best-effort; some phones snapshot the screen before a web page can react.
- **Face ID / fingerprint:** Settings → *Face ID / fingerprint* → Turn on. The calendar then asks for biometrics instead of the 4-digit code. The 4-digit code works as a backup only if you tick *Also allow the 4-digit code*. If the phone's biometric registration is ever deleted, clear this site's data to go back to the PIN.
- This lock is a **device-level screen lock** (like the PIN); real account security is still Supabase login + admin approval + database rules.

**Chat**
- **Reply, react, edit, delete for everyone:** long-press a message (right-click on desktop). Edits are allowed for 15 minutes; deleting removes the text/file and leaves "This message was deleted". The database enforces who may change what (a recipient can only mark seen).
- **Typing indicator + online status:** shown in the header and contact list. Turn off sharing in Settings. Status uses a realtime channel named after your private pairing id.
- **Dark mode:** Settings → Theme (Auto / Light / Dark). The admin page stays light.
- **Working decoy calendar:** tap any date to add events (stored only in that browser). Today's events show at the top.

## Last seen, "seen at" and the 👋 online ping (migration 007)

Run `supabase/migration_007_last_seen_nudge.sql` (fresh installs get it from `schema.sql`).

- **Last seen:** the header shows *typing…*, *online*, or *last seen today at 2:32 PM* (also in the contact list). It updates while the chat is open and records the moment someone leaves. Turning off **Online status & typing** in Settings also hides your last-seen time (and you still see theirs).
- **Seen at:** a small "Seen 2:32 PM" line sits under your latest message once the other person has opened it. It disappears with the message, 5 minutes after it's seen; the header's last seen stays.
- **👋 button (in a chat's header):** pings the other person. If their chat is open they get a green "… is online" banner and a buzz; otherwise they get a push notification reading "Event reminder" (kept generic on purpose, so it reveals nothing on a lock screen). Limited to one per minute per pair, and only between linked users. Needs the notification setup already described above.

## Weekly cleanup

Either click **Delete everything / Older than 7 days** in `/admin`, or enable `pg_cron` and uncomment the schedule at the bottom of `schema.sql`.

## Honest limitations

- The 4‑digit PIN is a **disguise, not security**: it's compiled into the browser bundle (`NEXT_PUBLIC_*`), so anyone who inspects the JS can read it. Real protection comes from Supabase login + admin approval + RLS.
- "Auto‑hide" is visual only. Messages remain in the database (readable by the two participants via the API) until purged, and **unseen messages never expire** until the recipient opens the chat.
- The 5‑minute timer starts at a server‑stamped `seen_at`, but is compared with each device's clock; a badly wrong clock can hide messages early or late.
- Messages are not end‑to‑end encrypted; Supabase can technically read them.
- The anon key is public by design. The `service_role` key is used **only** by the server route `/api/notify`; set it as a Vercel env var, never commit it and never prefix it with `NEXT_PUBLIC_`.
- Push notifications show a generic "New event added" – never the message text.

## Structure

```
pages/            index.jsx (calendar) · chat.jsx · admin.jsx · _app.jsx
src/components/   CalendarView · ChatWindow · SignupForm · AdminPanel
src/utils/        supabaseClient.js · unlock.js · push.js
pages/api/        notify.js · notify-test.js · admin-purge.js · cleanup.js
public/           sw.js · manifest.json · icons
supabase/         schema.sql
```
