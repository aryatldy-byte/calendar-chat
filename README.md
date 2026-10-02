# Calendar Chat

A private 2‑person chat disguised as a calendar. To anyone glancing at it, it's a normal year calendar.
Click a **month name**, enter the **4‑digit password**, and a WhatsApp‑style chat opens.

**Stack:** Next.js (React) · TailwindCSS · Supabase (Auth, Postgres, Realtime) · Vercel

## How it works

| Piece | Behaviour |
|---|---|
| Calendar (`/`) | Real dates for any year. Clicking a month name opens a PIN modal (5 wrong tries → 30 s lockout). |
| Chat (`/chat`) | Needs the PIN, then a Supabase login. Only **approved** users get in; the DB allows **max 2 approved users**. |
| Auto‑hide | Messages fade out and disappear from the screen 5 minutes after they were sent (frontend only). |
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

Flow to test: both people sign up on `/chat` (after the PIN) → sign in at `/admin` → approve both → they chat.

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

## Weekly cleanup

Either click **Delete everything / Older than 7 days** in `/admin`, or enable `pg_cron` and uncomment the schedule at the bottom of `schema.sql`.

## Honest limitations

- The 4‑digit PIN is a **disguise, not security**: it's compiled into the browser bundle (`NEXT_PUBLIC_*`), so anyone who inspects the JS can read it. Real protection comes from Supabase login + admin approval + RLS.
- "Auto‑hide" is visual only. Messages remain in the database (readable by the two participants via the API) until purged.
- Hiding relies on the device clock; a badly wrong clock can hide messages early or late.
- Messages are not end‑to‑end encrypted; Supabase can technically read them.
- The anon key is public by design; never put the `service_role` key in this project.

## Structure

```
pages/            index.jsx (calendar) · chat.jsx · admin.jsx · _app.jsx
src/components/   CalendarView · ChatWindow · SignupForm · AdminPanel
src/utils/        supabaseClient.js · unlock.js
supabase/         schema.sql
```
