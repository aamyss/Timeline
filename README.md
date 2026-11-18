# Timeline

A small home-screen web app that shows a personal work timeline kept in Google Sheets.

- This repository holds only the page and its icons. It has **no data and no keys**.
- The page reads from a private Google Apps Script web app. The address and access key are set on each device with a one-time setup link. The key travels in the link's `#fragment`, which browsers never send to GitHub, and is stored only in that device's local storage.
- Hosted with GitHub Pages.

`line/` is the LINE page (LIFF) for the work OA. It too holds no data or keys; the web app address comes from the LIFF endpoint URL set in the LINE console.

`cases/` is the งานคดี page (LIFF) for the Notify bot: case to-do lists, daily review and proof. It holds no data or keys either; the web app address comes from its LIFF endpoint URL (`?u=<deployment ID>`), and every request is checked against the owner's LINE sign-in by the bot's script.
