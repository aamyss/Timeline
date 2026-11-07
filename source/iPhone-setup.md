# iPhone check-ins: setup (about 20 minutes, once)

You'll make **3 shortcuts** and **30 automations** in the **Shortcuts** app:

- **24 hourly automations:** each hour, the phone asks your timeline "am I on duty?" (from the Roster tab). Only if yes does it send your location. Off duty it sends nothing.
- **6 place automations:** "arrived" and "left" at สภ.บางใหญ่, the Nonthaburi courts and พิสูจน์หลักฐาน. These are logged on or off duty.

**Before you start:** in the Google Sheet, open **Work timeline → Links and PC setup code** and copy two values into a note on your iPhone: the **Web app URL** and the **Phone key**. Don't share the key or the shortcuts that contain it.

Below, `URL` means your web app URL (ending in `/exec`) and `KEY` means your phone key.

---

## Shortcut 1: "WT Check-in" (hourly)

1. Shortcuts → **+** → name it **WT Check-in**.
2. Add **URL**: `URL?api=duty&t=KEY` (your URL, then `?api=duty&t=`, then your key, with no spaces).
3. Add **Get Contents of URL**. Leave it as GET.
4. Add **Get Dictionary Value**: Get **Value** for key `duty` in **Contents of URL**.
5. Add **If**: **Dictionary Value** **is** `yes`.
6. Inside the If, add **Get Current Location**.
7. Inside the If, add **Get Contents of URL**:
   - URL: your `URL` (just the URL, nothing added)
   - Method: **POST**, Request Body: **JSON**. Add these fields (all **Text**):
     - `action` → `checkin`
     - `t` → your `KEY`
     - `kind` → `checkin`
     - `lat` → tap the field, insert variable **Current Location**, tap it and choose **Latitude**
     - `lon` → same, choose **Longitude**
8. Leave **End If** as it is. Done.

**Test:** tap ▶. If you're off duty right now, nothing is sent, which is correct. To see an entry, test Shortcut 2 instead.

## Shortcut 2: "WT Arrive"

1. **+** → name **WT Arrive**. In the shortcut's settings (ⓘ), turn on **Receive input**, accepting **Text**. Under **If there's no input**, choose **Ask For Text**.
2. Add **Get Current Location**.
3. Add **Get Contents of URL** → URL: `URL`, Method **POST**, Request Body **JSON**:
   - `action` → `checkin`
   - `t` → `KEY`
   - `kind` → `arrive`
   - `place` → insert variable **Shortcut Input**
   - `lat` → **Current Location → Latitude**
   - `lon` → **Current Location → Longitude**

**Test:** tap ▶ and type `สภ.บางใหญ่`. Within a minute the app shows **Arrived สภ.บางใหญ่** with a map link.

## Shortcut 3: "WT Leave"

Long-press **WT Arrive** → **Duplicate** → rename it **WT Leave** → change `kind` to `leave`.

---

## Automations: hourly (24)

Shortcuts → **Automation** → **+** → **Time of Day**:
- Time: **00:00**, Repeat: **Daily**, choose **Run Immediately**, turn off **Notify When Run** → **Next**
- Action: **Run Shortcut → WT Check-in** → Done.

Repeat for **01:00, 02:00 … 23:00** (24 in all). Nothing is sent off duty, so it's fine that they run every day.

## Automations: places (6)

**+** → **Arrive** → **Location** → search the place → adjust the circle to cover the compound → **Run Immediately** → **Next**:
- Add **Text** with the place name **exactly** as below, then **Run Shortcut → WT Arrive** (its input is that Text).

| Place to search | Text (must match exactly) |
|---|---|
| สภ.บางใหญ่ | `สภ.บางใหญ่` |
| ศาลจังหวัดนนทบุรี (one circle for all three courts) | `ศาลนนทบุรี` |
| Forensic Police / พิสูจน์หลักฐาน | `พิสูจน์หลักฐาน` |

Then the same three again with **Leave** and **WT Leave**.

---

## Permissions and checks

- The first run asks for location access for Shortcuts. Allow it. If check-ins arrive as **"Location unavailable"**, go to **Settings → Privacy & Security → Location Services → Shortcuts** and choose **Always** if it's offered, otherwise **While Using the App**.
- iPhone sometimes runs a time automation a few minutes late, or skips it when the phone is off or in Low Power Mode. Each entry shows the time Google actually received it.
- To change places or their size, edit the **Places** tab in the sheet (name, lat, lon, radius in metres). The name in the automation's Text must match the sheet.
