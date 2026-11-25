# Onyx Contracts Hub: notes for future sessions

A web app for **Onyx General Building, Inc.**, a California general contractor.

It creates two kinds of documents:
- **Home Improvement Contracts**, numbered HIC-1001 and up.
- **Change Orders**, numbered 1001 and up.

It sends them to customers by email and text. Customers sign on their phone, and the signed PDF is emailed to both sides.

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
- PDFs are built with pdfkit, using Lato fonts from `assets/fonts` under the OFL license.
- Email goes through Gmail SMTP with an App Password (`lib/notify.js`). SMS goes through the Twilio REST API, which is **not configured yet**.
- Google reviews tile (`lib/reviews.js`) uses the Places API (New) with `GOOGLE_PLACES_API_KEY` (an env var) and a Place ID entered in Settings. It's cached for 6 hours and keeps one snapshot per day to show monthly and yearly gains. The business wasn't found by name in a search, so it may be a service-area listing.
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
  - **Change order PDF:** Inter Tight, the same typeface as the hub. ExtraLight (and ExtraLight italic) is used for text and filled-in values, Light for labels and the title, so the page is very thin with no bold. Blank lines are thin and gray (#6f6f6f, 0.45pt) and the navy border is 2.2pt, for a "sleek and breezy" look. The font files are static instances in `assets/fonts/InterTight-*.ttf`.
  - **Contract PDF:** still Lato, a "softer, sleeker" look than Times.
  - **All text is black**, including filled-in values. Only the legal citation notes on the contract stay red, as on the original.
  - The border is navy, #082A56, the brand color taken from the logo.
- **Contractor block:**
  - The contractor info is **printed permanently**, not a fill-in section.
  - **Change order:** the contractor box is style `c3`, an outlined card with a small "CONTRACTOR" label on its top edge, details on the left and the logo on the right.
  - **Contract:** the logo sits in the centered contractor block, not in a page corner.
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
- **Branding:** the app is named **"Onyx Contracts Hub"** (`appName`). Customers see only the company name.

## Deployment (Render)
- **Service:** `onyx-change-orders`, at https://onyx-change-orders.onrender.com.
- **Branch:** deployed from the `claude/customer-email-text-orders-79kttu` branch using `render.yaml`.
  - Don't rename the service in `render.yaml`. That can create a second service. Rename it in the Render dashboard instead.
- **Instance:** needs the **Starter** plan with a disk.
  - The Free plan loses data on restart and sleeps, which breaks reminders.
  - Memory is limited to 512 MB, so keep PDF generation light. The contract page text sizes are fixed in `FIXED_SCALE` for this reason. Measuring them on every request crashed the server.
- **Environment variables:**
  - `ADMIN_PASSWORD` and `SESSION_SECRET`.
  - Email: `SMTP_*`. `SMTP_PASS` is a Gmail App Password.
  - `NOTIFY_EMAIL`.
  - Texting: `TWILIO_*`.
  - `APP_URL` is optional; Render sets `RENDER_EXTERNAL_URL` automatically.
- **Browser caching:** CSS and JS links are versioned (`?v=hash`), so Safari picks up style changes right away.
- **Logs:** every request is logged; customer signing tokens are hidden in the logs.

## Testing
- Run the app locally with:
  `DATA_DIR=/tmp/x ADMIN_PASSWORD=t SESSION_SECRET=x PORT=3456 node server.js`
- Playwright with Chromium is used for end-to-end checks. To test email, point it at a local test mail server (the `smtp-server` package).
- Check PDFs visually with `pdftoppm`.

## Open to-dos
- **Google reviews:** create a Google Cloud API key for the Places API (New) and add it as `GOOGLE_PLACES_API_KEY` in Render. Then enter the Place ID in Settings.
- **Domain:** the owner owns onyxgeneralbuilding.com, a candidate for `hub.` as a custom domain.
- **Texting:** set up Twilio. It needs A2P 10DLC registration. Until then, use the "Text it from my phone" link.
- **Render plan:** confirm the service is on Starter with the `/var/data` disk and `DATA_DIR` set.
- **Domain:** optionally add a custom domain, e.g. `hub.onyxgeneralbuilding.com`.
- **Workers' comp renewal:** due 2027-01-26. Update the certificate and dates when it renews.
