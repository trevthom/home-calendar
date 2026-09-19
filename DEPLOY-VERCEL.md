# Deploying to Vercel (public address + one login)

This guide puts your calendar on a public HTTPS URL that works from any
browser with no VPN. There is **one calendar** and **one login** — a string
of letters and numbers (up to 50 characters) that **you choose and set
yourself** in the Vercel dashboard. Anyone who types that string on the
login screen unlocks the calendar; anyone who doesn't know it gets nothing.

Three things to set up, all free:

1. **Vercel** — hosts the site and runs the backend.
2. **Upstash Redis** — stores the calendar data (Vercel can't keep a file on
   disk the way your desktop did, so the data lives here). Provisioned from
   inside Vercel in two clicks.
3. **Your login string** — one environment variable (`CALENDAR_PASSCODE`)
   you set in Vercel. This is where you choose your string.

Total cost: $0 on the free tiers. No credit card required for the hobby plan.

> Pick something not trivially guessable — it's the only thing standing
> between the public internet and your calendar. A phrase with a number,
> like `oakStreetKitchen2026`, is plenty for family use. Avoid `1234`,
> `password`, or your last name.

---

## Step 1 — Get the code onto GitHub

Vercel deploys from a Git repository. If you don't already have the project
on GitHub:

1. Create a free account at https://github.com if you don't have one.
2. Make a new repository (name it whatever, e.g. `home-calendar`). Keep it
   **private**.
3. Upload the project files. The easiest no-terminal way: on the new repo
   page, click **uploading an existing file**, then drag in everything from
   this folder. Make sure you include the `api/`, `css/`, and `js/` folders,
   plus `index.html`, `package.json`, and `vercel.json`.

(If you're comfortable with git, just `git init && git add . && git commit`
and push — there's a `.gitignore` already set up.)

---

## Step 2 — Import the project into Vercel

1. Create a free account at https://vercel.com — sign in with your GitHub
   account so it can see your repos.
2. Click **Add New… → Project**.
3. Find your `home-calendar` repo and click **Import**.
4. On the configuration screen, **don't change any build settings.** This is
   a static site with serverless functions; Vercel detects it automatically.
   Leave the Framework Preset as "Other" and the build/output fields empty.
5. **Don't click Deploy yet** — first add the database (next step). If you
   already clicked Deploy, that's fine; you'll just redeploy once at the end.

---

## Step 3 — Add the database (Upstash Redis)

1. In your new project, go to the **Storage** tab.
2. Click **Create Database**, choose **Upstash** → **Redis** (it may be
   labeled "Serverless DB (Redis)").
3. Accept the defaults — pick a region close to you, free plan — and create
   it. When it asks, **connect it to this project**.
4. That's it. Vercel automatically injects the database credentials into your
   project as environment variables (`UPSTASH_REDIS_REST_URL` and
   `UPSTASH_REDIS_REST_TOKEN`). You don't have to copy anything.

---

## Step 4 — Set your login string

This is where you choose your login. Any letters and numbers, up to 50
characters.

1. In your project, go to **Settings → Environment Variables**.
2. Add a new variable:
   - **Key:** `CALENDAR_PASSCODE`
   - **Value:** your chosen string, e.g. `oakStreetKitchen2026`
   - **Environments:** leave all three (Production, Preview, Development)
     checked.
3. Click **Save**.

**To change it later:** edit this variable, then redeploy (Deployments →
Redeploy). Every device is instantly logged out and must enter the new
string — exactly what you want if the old one ever leaks.

---

## Step 5 — Deploy

1. Go to the **Deployments** tab and click **Redeploy** on the latest
   deployment (or, if you never deployed, go back to the import screen and
   click **Deploy**). Redeploying is required after connecting the database
   and setting `CALENDAR_PASSCODE` so the running app picks both up.
2. Wait for the build to finish (about a minute). Vercel gives you a URL like
   `https://home-calendar-xxxx.vercel.app`.

---

## Step 6 — Open it and log in

1. Visit the URL. You'll see the **login screen**.
2. Type the string you set in Step 4. Tick **"Stay logged in on this
   device"** if it's your own phone or computer, then tap **Log in**. (A
   typo shows "Incorrect login" right there — nothing to get stuck on.)
3. On each phone: open the URL, log in once (with the box ticked), then use
   the browser's **Add to Home Screen** so it opens like an app.

**About "Stay logged in on this device":**
- **Ticked** — you stay logged in after closing the browser. You only log in
  again if you tap **Log out** (the ⇥ button in the sidebar) or clear the
  browser's site data. Best for your personal devices.
- **Unticked** — you're logged out automatically when the browser is fully
  closed. Best for a shared or public computer.

Tell your wife the URL and the login string (say it in person or over the
phone rather than putting both in the same text). She opens the URL and logs
in with the same string.

That's it. No Tailscale, no VPN, no battery drain. Edits made on either
device show up on the other within about 5 seconds, and immediately when you
switch back to the app.

---

## Moving your existing events over

If you've been using the desktop/Tailscale version and have events you want
to keep:

1. On the old setup, open the calendar, open the sidebar, and tap the **↑
   Export** button. This downloads an `.ics` file.
2. On the new Vercel site (after logging in), open the sidebar and tap **↓
   Import**, and choose that `.ics` file.

Your calendars and events transfer over.

---

## Optional: a nicer URL

Vercel's free `*.vercel.app` URL works fine. If you'd rather have something
like `calendar.yourname.com`, buy a domain (~$10/year from any registrar)
and add it under **Settings → Domains** in your Vercel project. Vercel walks
you through the DNS step. Purely cosmetic — the login works the same either
way.

---

## Troubleshooting

**"Incorrect login" but I'm sure it's right** — the login must match the
`CALENDAR_PASSCODE` value *exactly*, including capital letters. Also check
the env var for accidental leading/trailing spaces, and confirm you
redeployed after setting it (env changes only apply to new deployments).

**The login screen rejects what I type before checking** — logins must be
letters and numbers only, 1 to 50 characters. Spaces, dashes, and
punctuation aren't allowed. Make sure the value you set in
`CALENDAR_PASSCODE` follows the same rule.

**Every login attempt fails, even the right one** — `CALENDAR_PASSCODE` is
probably unset or empty. The server refuses everyone rather than letting
everyone in. Set it under Settings → Environment Variables and redeploy.

**Data isn't saving** — make sure the Upstash database is connected to the
project (Storage tab should show it linked), then redeploy.

**I want to log every device out right now** — change `CALENDAR_PASSCODE`
to a new value and redeploy. All devices immediately get logged out and
must enter the new string.

**Moving data from an older setup** — on the old setup, open the sidebar
and tap **↑ Export** to download an `.ics` file. On the new deployment
(after logging in), tap **↓ Import** and choose that file.

---

## How the login and "stay logged in" work (the short version)

There is one calendar, protected by one string that you set as the
`CALENDAR_PASSCODE` environment variable. The app sends the string you
typed with every request, always over HTTPS; the server compares it against
the variable and refuses anything that doesn't match. Change the variable
and every device is locked out until it logs in with the new string.

"Stay logged in on this device" controls only where the login is remembered
in *your* browser:
- **Ticked** → saved in the browser's persistent storage, so it survives
  closing the browser. It's forgotten only when you tap **Log out** (⇥ in
  the sidebar) or clear the browser's site data.
- **Unticked** → saved only for the current browser session, so fully
  closing the browser logs you out automatically.

Either way, locking your phone or switching apps does **not** log you out —
only fully closing the browser does, and only when the box was unticked.
