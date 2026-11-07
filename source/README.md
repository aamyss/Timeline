# Work timeline — stage 1

Automatic, evidence-backed log of your police work.

**What stage 1 does**
- **Google Calendar:** every hour, reads your **Work** and **Inquiry Copilot** calendars.
- **PC reporter:** every 5 minutes, a hidden script on your PC checks **#Police** (OneDrive) and **D:\Inquiry_Copilot_Storage** and reports files that were created, edited, renamed or deleted. Each file gets a SHA-256 fingerprint of its exact content. Google stamps every report when it arrives, which backs up your PC's clock.
- **Append-only log:** every record goes into a `Log 2026` tab. Rows are never edited; corrections are new rows.
- **Strength rating** on every row:
  - **Strong**: an outside clock (Google) confirms the time within 15 minutes.
  - **Medium**: the time comes only from your PC (a late report, a deletion, or the PC clock was off by more than 2 minutes).
  - **Self-reported**: your own notes and calendar entries.
- **Hash chain:** each row is chained to the one before it with SHA-256. Editing, inserting or deleting any row breaks the chain, and **Verify log** finds it.
- **Nightly seal:** at about 00:20, an email with the previous day's graphical timeline (shift, file activity, calendar, notes and gaps in 30-minute blocks, then every entry) plus the day's rows as a CSV, with the chain hash in the subject.
- **iPhone app:** a home-screen app (hosted on GitHub Pages, with its own icon) showing each day's records, your shift, gaps of 90+ minutes inside a shift, and a form to add notes. It holds no data itself; it reads from your Google script with a key stored only on your phone. Folders Inquiry Copilot creates automatically inside each case are hidden from the view (still logged).

No Microsoft setup is needed.

---

## Setup (about 15 minutes, on the PC)

### 1. Create the sheet and paste the code
1. In Google Drive (your Gmail), create a new Google Sheet named **Work timeline**.
2. **Extensions → Apps Script**.
3. **Project Settings** (gear) → tick **Show "appsscript.json" manifest file**.
4. Back in **Editor**, replace the contents of `appsscript.json` with the one from the `src` folder.
5. Add the other files with **+ → Script** (or **+ → HTML** for Index). Use exactly these names; Apps Script adds `.gs`/`.html` itself:
   `Core`, `Config`, `Log`, `Collect`, `WebApp`, `Report`, `Menu`, `Line` and `Index` (HTML). Paste each file's contents.
6. `Code.gs` is the empty file Google creates in every new project (it's not in this zip). Delete it.
7. Save, choose `setup` in the function dropdown, and click **Run**. Approve the permissions. Google will warn "Google hasn't verified this app". That's normal for your own script: **Advanced → Go to Work timeline**.
8. Reload the sheet. A **Work timeline** menu appears.

### 2. Deploy the web app
1. Apps Script: **Deploy → New deployment** → type **Web app**.
2. Execute as: **Me**. Who has access: **Anyone**. This has to be Anyone so your PC can send reports, and both doors are locked with long secret keys.
3. **Deploy**, then copy the **Web app URL** (ends in `/exec`).
4. Sheet menu: **Work timeline → Links and PC setup code**. Paste the URL when asked.
5. The dialog shows two things:
   - **iPhone app QR code**: scan it with the iPhone Camera → it opens the app page (`aamyss.github.io/Timeline`) in Safari → Share → **Add to Home Screen**. The key stays on your phone only. Don't share this QR or link.
   - **PC setup code**: you'll paste this in step 3.

After any later code change: **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. The URL stays the same.

Update **every** file you were given, not just some: a half-updated project fails in confusing ways (in Nov 2026 an old WebApp.gs made the iPhone get "bad token"). Note what's live and what isn't: the web app (iPhone app, PC reports, check-ins) runs the **deployed version**, while the hourly calendar collection and the nightly seal email run the **saved** code, so saving without deploying gives you a mix.

### 3. Install the PC reporter
1. Unzip this project anywhere (right-click → Extract All). Keeping it inside `#Police\Work Timeline` is fine; that folder is never logged.
2. Open the `pc` folder and double-click **install.cmd**.
3. Paste the **PC setup code** when asked and press Enter.
4. It checks the connection, shows "Connected. Google time: …", then installs a hidden task that runs every 5 minutes and when you sign in, on battery too.

The first scan reports everything since 1 Oct 2026 and is marked "first scan" (medium strength, since those files were found late). From then on, changes are reported within 5 minutes.

- **Photos:** for each new photo (JPEG or HEIC) the reporter also reads when and where it was taken from the photo itself and logs a "Photo taken" entry (medium, with a map link if it has GPS). Photos already in #Police are read once too. Check one photo: drag it onto `pc\test-photo.cmd`.
- **Log:** `%LOCALAPPDATA%\WorkTimeline\last-run.log`
- **Folders watched:** `%LOCALAPPDATA%\WorkTimeline\reporter.json`, which you can edit
- **Remove:** `pc\uninstall.cmd`

### 4. Enter your roster
Fill the **Roster** tab, one row per shift:

| date | start | end | label |
|---|---|---|---|
| 2026-11-05 | 08:00 | 16:00 | เวรสอบสวน |
| 2026-11-07 | 16:00 | 08:00 | เวรดึก |

End earlier than start means an overnight shift. Until a month's roster is entered, entries that month show no duty label and no gaps. (Or send me a photo of the paper roster and I'll fill it in.)

### 5. Optional settings
**Project Settings → Script properties**:
- `SEAL_RECIPIENTS`: set to `your Gmail,your police mail` to also keep each daily seal on the police mail server (a second independent copy).
- `GAP_MINUTES`: default 90.
- `BACKFILL_FROM`: default 2026-10-01 (calendar). For files, edit `backfillFrom` in `reporter.json` before the first scan.
- `CALENDARS`: default `Work,Inquiry Copilot`.
- `EXCLUDE_PATHS`: never logged, default `#Police/Work Timeline`.
- `APP_URL`: the iPhone app page, default `https://aamyss.github.io/Timeline/`.
- `SEAL_RECIPIENTS`: empty means your own Gmail.
- Leave `PC_TOKEN` and `VIEW_KEY` as they are. Changing one locks out the PC or the day-view link until you redo step 2.4 and step 3.

- `NOTICE_WORDS`: default `แจ้งความคืบหน้า,คืบหน้า`. A file in a case folder whose name contains one of these counts as a progress notice sent on the day it first appeared.
- `PUBLIC_STATS`: `off` (default) or `on`. Set from **LINE page setup**.

The **Cases** tab fills itself every hour: one row per Inquiry Copilot case folder, each with a `line_code`.
- `case_no`: type the real case number, e.g. `2026-11-05_1510-ลักสายไฟ_โรงงาน_บริษัทตัวอย่าง` → `456/2569`. The app and the LINE page then show the number instead of the folder name.
- `closed`: the date the file went to the prosecutor or the case ended (e.g. `2026-12-01`). The last progress notice is due that day.
- `line_code`: give it only to the complainant of that case (for example, write it on the progress-notice letter). If a code leaks, clear the cell: the next hourly run makes a new code and everyone who followed with the old one loses access.

When a complainant asks for the dates you worked on their case or the next notice date, use **Work timeline → Case report**: enter their code or case number and copy the Thai text it gives you.

## Summary card and progress notices (v9)
The top of the app and of the nightly email shows a summary of the day: shift, on-duty coverage (shift time minus gaps), work outside shifts (each record counts as 15 minutes; records close together join up; notes and place visits count their full span), cases, documents created/edited/deleted (not photos or Inquiry Copilot's own files), photos (and how many carry a location), places and calendar items.

Progress notices (แจ้งความคืบหน้า, คำสั่ง ตร.ที่ 419/2556 บทที่ 2 ข้อ 1.2) are worked out per Inquiry Copilot case:
- 1st: 30 days after the complaint (the date at the start of the case folder name).
- 2nd: 2 months after the 1st was actually sent.
- 3rd: when the file goes to the prosecutor (the `closed` date in the Cases tab).
- Extra notices on a warrant or arrest aren't tracked.

A notice counts as sent when a file whose name contains a `NOTICE_WORDS` word appears in the case folder. Cases that began before `BACKFILL_FROM` aren't judged. The card lists notices overdue or due within 7 days; the app also lists every open case.

## LINE page (v10)
`line/index.html` in the GitHub repo is a LIFF page for the work LINE OA, with two tabs:
- **ผลงาน**: totals only (on-duty hours, work outside shifts, cases, documents) for this month, last month and since the roster began. Off until you switch it on (ask your ผกก. first).
- **คดีของฉัน**: a complainant enters the case's `line_code` once. They then see the case number and type, the complaint date, the progress notices sent, the date the file went to the prosecutor and the last day worked. Not the list of work dates or the next due date (you give those on request with **Case report**), and never file names, names of people or times of day. Their LINE sign-in is checked with LINE's server; only a one-way hash of their LINE ID is kept (Links tab). Five wrong codes lock them out for an hour.

It sends no LINE messages, so it uses none of the free plan's 300 pushes.

Policy pages for the LINE Login channel (Basic settings): Privacy policy URL `https://aamyss.github.io/Timeline/line/privacy.html`, Terms of use URL `https://aamyss.github.io/Timeline/line/terms.html`.

Setup:
1. [LINE Developers console](https://developers.line.biz/console/) → **Create a new provider**. The work OA has no provider yet (an OA gets one only when its Messaging API is switched on), so this new provider is the one it will join later.
   - Name it as the public should see it: LINE shows the provider name on the sign-in screen the first time someone opens the page.
   - In the new provider: **Create a new channel → LINE Login**. App type: **Web app**. Publish it (status **Published**), or only you can sign in.
   - Later, when you switch on the OA's Messaging API (chat logging, nightly summary), pick **this same provider**. That can't be undone, and only then do the OA and the page share LINE user IDs.
2. Sheet menu **Work timeline → LINE page setup**: copy the **Endpoint URL**.
3. In the LINE Login channel → **LIFF → Add**: size **Full**, Endpoint URL from step 2, scope **openid** only, Add friend option (Bot link) **Off** for now (it needs the OA in the same provider), Scan QR off. Add.
4. Back in **LINE page setup**: paste the **LIFF ID** (from the LIFF tab) and the **Channel ID** (Basic settings tab). Save. Leave "Show work totals publicly" unticked until your ผกก. agrees.
5. LINE Official Account Manager → **Rich menus**: two buttons, action **Link**, using the two links the dialog now shows.

---

## iPhone check-ins (stage 2)
After updating the script, run **Work timeline → Set up** once more. It adds the **Places** tab and a phone key, and changes nothing else. Then follow `iPhone-setup.md`.
- **Hourly while on duty:** the phone asks the script whether you're on duty (Roster tab). Off duty it sends nothing, and the script also drops any hourly check-in that arrives off duty.
- **Arrived / left** at saved places, on or off duty. Time spent between arriving and leaving counts as accounted for in the gap check.
- Rated medium: the time is Google's, the position is the phone's.

## Honest limits
- You own the sheet, so Google can't stop *you* from editing it. The tabs show a warning, but the real protection is the hash chain plus the emailed seals: any later edit is detectable.
- File times come from your PC's clock. Google's arrival time is the outside check: it proves the file existed in that exact form (the fingerprint) by then.
- Changes are seen only while the PC is on and signed in. Changes made elsewhere (e.g. your phone into OneDrive) are reported when the PC next syncs, as medium.
- Deleted and renamed files are logged at the time the report reached Google.
- OneDrive "online-only" files are listed without a fingerprint, so they're never downloaded just to be checked.
- A calendar event is your own entry, so it counts as self-reported. Its "entered" time (from Google) shows when you wrote it.

## Menu reference
- **Links and PC setup code**: day view link and the code for the PC installer.
- **Change web app URL**: if you ever make a new deployment.
- **Collect calendars now**: run the hourly calendar check immediately.
- **Seal yesterday now**: send yesterday's seal if the nightly one didn't run.
- **Verify log**: recompute every hash and compare with the Seals tab.
- **Update Cases tab**: add new case folders now (it also runs every hour).
- **LINE page setup**: LIFF ID, LINE Login channel ID, public totals on/off.
- **Case report (for a complainant)**: work dates, notices and next due date for one case, as Thai text to copy.

## Files
| File | What it does |
|---|---|
| `src/Core.gs` | Pure logic: case numbers, calendar changes, PC reports, duty, gaps, summary card, progress notices, hashing |
| `src/Config.gs` | Settings, `setup`, triggers, secrets |
| `src/Log.gs` | Append-only log, hash chain, nightly seal, verify |
| `src/Collect.gs` | Hourly Google Calendar sync |
| `src/WebApp.gs` | App data API, notes, PC report endpoint |
| `src/Index.html` | Fallback day view inside Google (link with `?k=` key) |
| `src/Report.gs` | Graphical day timeline in the nightly email |
| `src/Menu.gs` | Sheet menu |
| `src/Line.gs` | LINE page API: public totals, case codes, LINE sign-in check |
| `../line/index.html` | The LINE page (LIFF), served by GitHub Pages |
| `pc/install.cmd` | Installs the PC reporter |
| `iPhone-setup.md` | Step-by-step iPhone Shortcuts setup |
| `pc/reporter.ps1` | The reporter itself (read-only scan, runs hidden via `run-reporter.vbs`) |
| `test/` | Offline tests: `node test/run-tests.js` (Apps Script logic), `node test/pc-e2e.js` (needs PowerShell `pwsh`), `node test/app-e2e.js` (iPhone app and LINE page in a browser; needs Playwright, set `PLAYWRIGHT`/`CHROME` if not on the default path), `node test/email-preview.js` (renders the nightly email to /tmp/email-phone.png) |
