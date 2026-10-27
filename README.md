# Caerulean Website

Pre-launch landing page for Caerulean, a marketplace connecting influencers/creators with sponsors. Static HTML/CSS/JS deployed via GitHub Pages, with a signed-in app (`app.html`) backed by [Supabase](https://supabase.com).

## Structure

- `index.html` — landing page
- `app.html` — signed-in app: profiles, discover, connection requests, messaging
- `css/styles.css` — shared styles
- `css/app.css` — app-only styles
- `js/main.js` — mobile nav toggle, footer year, waitlist form
- `js/app.js` — app logic (Supabase auth, data, realtime)
- `js/config.js` — Supabase project URL and anon key
- `supabase/schema.sql` — database tables and security rules
- `img/` — logo and favicons
- `.nojekyll` — tells GitHub Pages to serve files as-is (no Jekyll processing)

## Local preview

Open `index.html` directly in a browser, or serve it locally:

```
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## Waitlist form

The form in `#waitlist` posts JSON to the URL in its `data-endpoint` attribute
(e.g. a [Formspree](https://formspree.io) endpoint like `https://formspree.io/f/xxxxxxx`).
While `data-endpoint` is empty, submitting opens a prefilled email to `hello@caerulean.co` instead.

## App setup (Supabase)

The app lets creators and brands sign in with Google, build a profile, send
connection requests, and message each other once a request is accepted.
Messages arrive live via Supabase Realtime.

1. Create a free project at [supabase.com](https://supabase.com).
2. **Database:** SQL Editor → New query → paste `supabase/schema.sql` → Run.
3. **Keys:** Project Settings → API. Copy the Project URL and the `anon` public
   key into `js/config.js`. (The anon key is safe to commit; row level security
   in the schema is what protects the data. Never commit the `service_role` key.)
4. **Google sign-in:**
   - In [Google Cloud Console](https://console.cloud.google.com/apis/credentials),
     create an OAuth client ID (type: Web application). Add
     `https://<your-project>.supabase.co/auth/v1/callback` as an authorized
     redirect URI.
   - In Supabase: Authentication → Providers → Google → enable, and paste the
     client ID and secret.
5. **Redirect URLs:** Authentication → URL Configuration. Set Site URL to the live
   site and add both of these under Redirect URLs:
   - `http://localhost:8000/app.html`
   - `https://agm2004.github.io/Caerulean/app.html` (or your custom domain)

How it works:

- `profiles` — one per user, `creator` or `brand`. Any signed-in user can view them.
- `connections` — a pending request from one person to another. Only the
  recipient can accept; either side can decline, cancel or remove (deletes the row,
  along with its messages).
- `messages` — readable and sendable only by the two people in an accepted connection.
- Unread dots are tracked per browser (localStorage).

## Deployment

Served via GitHub Pages from the `main` branch. Push to `main` to update the live site.

## TODO

- [ ] Fill in `js/config.js` and finish the Supabase setup above
- [ ] Set the waitlist form's `data-endpoint` to a real form service URL
- [ ] Swap `hello@caerulean.co` for the real contact address
