# Onyx Contracts Hub: notes for future sessions

A web app for **Onyx General Building, Inc.**, a California general contractor.

It creates two kinds of documents:
- **Home Improvement Contracts**, numbered HIC-1001 and up.
- **Change Orders**, numbered 1001 and up.

It emails them to customers. The signing link can also be copied and shared by hand. Customers sign on their phone, and the signed PDF is emailed to both sides.

The owner works mostly from an **iPad in Safari** and is not a developer. Explain steps click by click, in plain language.

## Company (config/company.json)
- Onyx General Building, Inc. · 17715 Chatsworth St, Suite 209, Granada Hills, CA 91344
- Phone (818) 405-8515 · onyxgeneralbuilding@gmail.com
- CSLB License #1144758, which expires **2027-10-31**.
- **Insurance**, from the ACORD certificate in `assets/insurance-certificate.pdf`:
  - The agent is Progressive United Insurance Agency, (818) 908-1111.
  - **General liability:** Spinnaker Insurance Company, policy HBW5251752XB1, expires **2027-10-24**.
  - **Workers' comp:** NorGUARD Insurance Company, policy ONWC729176, expires **2027-01-26**.
- When the owner sends a new certificate: replace the PDF and update the dates in `company.json`.

## Stack
- Node 22 and Express, server-rendered HTML in `lib/views.js`, no front-end framework.
- Data is a JSON file store (`lib/store.js`). `DATA_DIR` sets its location; on Render that's `/var/data` on a persistent disk.
- PDFs are built with pdfkit, using Inter Tight fonts from `assets/fonts` under the OFL license. Lato is no longer used.
- Email goes through Gmail SMTP with an App Password (`lib/notify.js`).
- **No texting at all.** The owner decided against Twilio and also against the "Text it from my phone" link, and both were removed. Documents go by email; the detail page also has a **Copy** button for the signing link.
- Google reviews tile (`lib/reviews.js`) uses the Places API (New) with `GOOGLE_PLACES_API_KEY` (an env var) and a Place ID entered in Settings. It's cached for 6 hours and keeps one snapshot per day to show monthly and yearly gains. It was connected in November 2026 with the key restricted to Places API (New), and showed 5.0 stars and 7 reviews.
- Renewal reminder emails (`lib/reminders.js`) are checked hourly inside the app. They go out 60, 30, 7 and 1 days before, on the day, and once if lapsed.

## Files
- `lib/pdf.js`: the 1-page Change Order form.
- `lib/pdf-contract.js` and `lib/contract-text.js`: the 5-page legal-size Home Improvement Contract, plus Attachment A and the e-signature certificate.
- `server.js`: routes.
  - Admin pages are behind `ADMIN_PASSWORD`.
  - Customers sign at `/s/:token`.
  - `type: 'hic'` marks contracts; anything else is a change order.

## Design decisions the owner asked for (keep these)
- **Forms:**
  - Both forms closely match the owner's paper Builder's Book forms (206 and 203): the same wording, order and layout.
  - The owner was told Builder's Book's copyright notice says reproduction needs their permission.
- **Typography:**
  - **Both PDFs use Inter Tight**, the same typeface as the hub.
    - **Change order:** Regular throughout, with Light only for tiny captions. This is the weight the owner approved.
    - **Contract:** Regular text, with **SemiBold** for headings and the notices B&P 7159 requires in boldface. Don't drop the boldface on those.
    - Blank lines are thin and gray (#6f6f6f, 0.45pt) and the navy border is 2.2pt.
    - **Font files:** `assets/fonts/InterTight-*.ttf` are static instances made with `fonttools varLib.instancer --update-name-table`. Each weight **must have a unique PostScript name**. pdfkit dedupes fonts by name, and without unique names every weight silently renders as the first one loaded.
  - **All text is black**, including filled-in values. Only the legal citation notes on the contract stay red, as on the original.
  - The border is navy, #082A56, the brand color taken from the logo.
- **Contractor block:**
  - The contractor info is **printed permanently**, not a fill-in section.
  - **Change order:** the contractor box is style `c3`, an outlined card with a small "CONTRACTOR" label on its top edge, details on the left and the logo on the right.
  - **Contract:** the same outlined card in the left "DIRECT CONTRACTOR" column, with details on the left and the logo on the right.
  - The change-order # and date stay fillable.
- **Never** put the logo next to signature lines.
- **Change order:**
  - The Owner/Architect/Contractor/Field/Other box at the top is selectable.
  - Price and time choices are circled.
- **Contract:**
  - The customer enters initials, age(s) and an arbitration choice (voluntary).
  - If any owner is 65 or older, the 5-day right to cancel applies; otherwise the 3-day one.
  - The cancellation deadline is calculated in business days, which skip Sundays and holidays.
  - A second owner can sign, at the same time or later.
- **Dashboard:**
  - A row of yearly totals, with a year picker that defaults to the current year in Pacific time.
  - A row of renewal tiles: green when more than 60 days are left, amber at 60 or fewer, red when expired.
- **Hub look:** the web app's style follows ndstudio.gov, toned down at the owner's request.
  - A light gray #F2F2F2 background with near-black text, in the Inter Tight font.
  - Hairline rules and no shadows. Figures sit in columns divided by vertical rules; status shows as dots; links carry ↗ arrows; labels are small uppercase gray.
  - Pill buttons in Onyx navy, which is the only accent color.
- **Team members:** the owner adds users in **Settings → Team**: a name, a username, an optional email and a password. Passwords are stored as scrypt hashes in `db.users`.
  - **Logging in:** a member logs in with username and password. The owner leaves the username blank and uses `ADMIN_PASSWORD`. Failed logins are throttled to 10 per IP per 15 minutes.
  - **What a member sees:** only documents with `createdBy === their id`, including the dashboard totals and the "same customer" dropdown. No Settings, no renewal or Google reviews tiles, and no contractor signature. The owner's saved signature is never auto-applied to members' documents; the owner signs those.
  - **Notifications:** signed and declined emails also go to the member who created the document.
  - **Owner's view:** sees everything, with "· Name" shown on members' documents. Documents created before Team existed have no `createdBy` and count as the owner's.
  - **Code:** `lib/context.js` (AsyncLocalStorage) exposes the logged-in user to the views.
- **Top menu:** Documents · Leads · Estimates · + New · Settings · Log out. The current page is underlined.
  - **Leads** (`/leads`) and **Estimates** (`/estimates`) are "Coming soon" placeholder pages (`views.comingSoon`) until they're built.
- **Branding:** the app is named **"Onyx Contracts Hub"** (`appName`). Customers see only the company name.

## Deployment (Render)
- **Service:** the dashboard name is `onyx-contracts-hub` (the owner renamed it). The address is still https://onyx-change-orders.onrender.com.
- **Branch:** deployed from the `claude/customer-email-text-orders-79kttu` branch using `render.yaml`.
  - Don't rename the service in `render.yaml`. That can create a second service. Rename it in the Render dashboard instead.
- **Instance:** the **Starter** plan with a disk, confirmed in November 2026. Each deploy causes about 1–2 minutes of downtime, because services with a disk can't do zero-downtime deploys, so batch changes when possible.
  - The Free plan loses data on restart and sleeps, which breaks reminders.
  - Memory is limited to 512 MB, so keep PDF generation light. The contract page text sizes are fixed in `FIXED_SCALE` for this reason. Measuring them on every request crashed the server.
- **Environment variables:**
  - `ADMIN_PASSWORD` and `SESSION_SECRET`.
  - Email: `SMTP_*`. `SMTP_PASS` is a Gmail App Password. The sender name comes from `EMAIL_FROM_NAME` (default "Onyx General Building"). It is built as {name, address} because a comma in "…, Inc." once made Gmail show the sender as just "Inc.".
  - `NOTIFY_EMAIL`.
  - `APP_URL` is optional; Render sets `RENDER_EXTERNAL_URL` automatically.
- **Browser caching:** CSS and JS links are versioned (`?v=hash`), so Safari picks up style changes right away.
- **Logs:** every request is logged; customer signing tokens are hidden in the logs.

## Testing
- Run the app locally with:
  `DATA_DIR=/tmp/x ADMIN_PASSWORD=t SESSION_SECRET=x PORT=3456 node server.js`
- Playwright with Chromium is used for end-to-end checks. To test email, point it at a local test mail server (the `smtp-server` package).
- Check PDFs visually with `pdftoppm`.

## Open to-dos
- **Domain:** the owner owns onyxgeneralbuilding.com, a candidate for `hub.` as a custom domain.
- **Workers' comp renewal:** due 2027-01-26. Update the certificate and dates when it renews.
