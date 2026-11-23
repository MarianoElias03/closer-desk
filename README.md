# Closer Desk

A sales tracker for SDRs and closers who are tired of typing dial counts into a spreadsheet mid-session.

I built it for my own appointment-setting and closing work at a fitness coaching business. It replaces the Google Sheet I used to log every day. It also connects the parts the sheet never could: my calendar, my call recordings and my numbers.

Built with an AI coding agent, then deployed to my homelab in a container of its own.

![Today: tap a plate after every dial, and see today's calls](docs/today.png)

## What it does

- **One-tap dial counter.** Five big buttons for the outcome of each dial: no answer, booked, not interested, callback, wrong number. Keys 1 to 5 work mid-session, and Z undoes. Totals, spoken-with and pick-up rate update as you go.
- **Daily logs for dialling and closing.** One editable row per day, in the same layout as the spreadsheet it replaced. Totals and rates are worked out with the same formulas the sheet used, so the numbers match.
- **Calls pulled from Google Calendar.** Any event whose title matches your keywords (for example "Discovery Call") becomes a call, with the lead's name, phone, email and join link.
- **Fathom recordings attached to each call.** Recordings are matched by meeting link, title or guest email. Each call shows the AI summary and action items, with a link to watch.
- **Outcomes per call, rolled into the day.** Log no-show, closed, not interested, callback or unqualified on each call. One click copies them into that day's closing tally.
- **Week calendar.** Each call is coloured by its outcome, so you can see at a glance which calls are still unlogged.

![Call drawer with the Fathom summary](docs/call-recording.png)

| Closing (dark mode) | Calendar (dark mode) |
| --- | --- |
| ![Closing](docs/closing-dark.png) | ![Calendar](docs/calendar-dark.png) |

## The numbers it tracks

| Dialling | Closing |
| --- | --- |
| Total leads = no answer + booked + not interested + callback + wrong number | Calls = no show + closed + not interested + callback + unqualified |
| Pick-up rate = spoken with ÷ total leads | Conversion = closed ÷ calls |
| Booking rate = booked ÷ total leads | No-show rate = no shows ÷ calls |
| Bookings per lead spoken to | Close rate on calls that showed |
| Bookings and dials per day worked | Cash collected, cash per day and sales per day |

"Days worked" defaults to the days with something logged. You can override it for each month.

## Stack

- SvelteKit 2 and Svelte 5 with runes, served by `adapter-node`
- SQLite through `better-sqlite3`
- Google Calendar API (OAuth refresh token, read only) and the Fathom external API
- No UI framework. The design is "bumper plates on chalk": one variable font (Archivo, using its width axis for the scoreboard numbers), with outcome colours borrowed from competition weight plates.
- Light and dark themes, works on a phone, and respects reduced-motion settings

## Run it

```bash
npm install
cp .env.example .env   # optional: add Google + Fathom credentials
npm run dev
```

Try it with made-up data and no accounts connected:

```bash
DATA_DIR=demo-data node scripts/demo-seed.js
DATA_DIR=demo-data NO_SYNC=1 npm run dev
```

Production build: `npm run build`, then `node build`. Set `PORT`, `HOST` and `DATA_DIR` as needed. `deploy/` has the systemd unit and the script I use to ship it to a Proxmox LXC container.

## Configuration

| Variable | Purpose |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` | Read your primary Google Calendar |
| `FATHOM_API_KEY` | Pull recordings, summaries and action items |
| `OWNER_NAME` | Name used in the greeting on the Today page |
| `DATA_DIR` | Where the SQLite database lives (default `./data`) |
| `NO_SYNC` | Set to turn off the 10-minute background sync |
| `CLOSER_MCP_TOKEN` | Turns on the MCP endpoint for AI assistants (at least 24 characters) |

The keywords that decide which calendar events count as sales calls are set in the app, under Settings.

## Sign-in

Every page and API needs a sign-in. The first time you open Closer Desk it asks you to create the
account (only possible while there are none). Settings > Account lists every signed-in device, signs
one out, and changes the password (which signs the others out). `/mcp` keeps its own Bearer token.

## Android app

`android/` is a native app (Kotlin, Jetpack Compose) for the same account:

- **Dashboard across every offer**, each offer's leads with search, and the full Closer Desk pages
  inside the app for everything else.
- **Caller matching, like a CRM dialler.** When a lead rings, or you ring one, a card floats over the
  call with the offer, status, reason, follow-up, last contact and note. Numbers are matched on the
  phone (last 9 digits, the same rule as the server) against a copy of every lead, so it shows before
  the network wakes up. Booked calls with a phone number match too.
- **After the call**, a notification opens the outcome pad (reason required, callback and booking
  times), which logs exactly like the lead page does.

Setup on the phone (Call matching screen): make it the Caller ID app, allow phone and call log, allow
"Display over other apps", and notifications. Android blocks call log and overlay access for apps
installed outside the Play Store until you choose **Allow restricted settings** in the app's App info.

Builds: `.github/workflows/android.yml` signs a release on every change under `android/` and publishes
it as a GitHub Release, so Obtainium can install and update it. Local compile:
`cd android && gradle :app:assembleDebug`.

## For AI assistants (MCP)

Closer Desk serves an [MCP](https://modelcontextprotocol.io) endpoint at `/mcp` (Streamable HTTP), so an assistant can read and update the CRM. Set `CLOSER_MCP_TOKEN` and connect with the header `Authorization: Bearer <token>`. The tools are part of the app, so they change with the code on every deploy, and the server reports the commit it was built from.

| Tool | What it does |
| --- | --- |
| `crm_overview` | Offers, lead counts per list, rules |
| `search_leads` | Find leads by list, text, channel or missing field |
| `get_lead` | One lead with notes, research columns, booked call and history |
| `update_lead`, `update_leads` | Change fields on one or many leads (bulk fills only fill blanks by default) |
| `add_lead`, `import_leads` | Add leads, with duplicate checks |
| `log_contact` | Add a call, SMS or email to a lead's history |
| `dialling_stats` | A month's Dialling numbers |
| `recent_changes` | What was changed through the endpoint |

Only calls you made can count on the Dialling numbers, and only when the assistant is told to count them. There is no delete tool. Every write is recorded in the `api_log` table.

All names, phone numbers and figures in the screenshots are made up.
