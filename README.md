# Onyx Contracts Hub

Create **Home Improvement Contracts** and **Change Orders** on your company forms. Send them to customers by **email and text**, and have customers **sign on their phone**. Signed copies are emailed to you and the customer automatically.

## Home Improvement Contract (5 pages, California)

- **You fill in:** the owner, the job address, the description, dates, the price, the down payment (checked against the lesser of $1,000 or 10%) and the progress payments (checked against the contract price). A long description or more than 5 payments continues on **Attachment A** automatically.
- **The customer:** enters their **initials** and **age(s)**, chooses whether to agree to **arbitration** (it's voluntary), and signs. A second owner can sign too.
- **Filled in automatically:**
  - If any owner is 65 or older, the **5-day** right to cancel is initialed. Otherwise the **3-day** one is.
  - The Notice of Cancellation is dated, and its deadline is calculated. Sundays and holidays don't count as business days.
  - The arbitration and receipt initials, and the Customer Acknowledgment checklist.
  - The insurance disclosure on page 4. It comes from the certificate of insurance in `config/company.json`, and you can change it in **Settings**.
- **Insurance certificate:** `assets/insurance-certificate.pdf` is attached to every contract email. When your policy renews, replace that file and update the dates in `config/company.json`.

## How it works

1. **New change order:** fill in the project, owner, work, price and days. You can pick a past customer to fill in their info.
2. **Review:** the PDF shows your form with everything filled in.
3. **Send:** email it (PDF attached plus a "Review & sign" button), text it (with a signing link), or copy the link and send it yourself.
4. **Customer signs:** they open the link, read the summary or full PDF, type their name, sign with a finger and agree. They can also decline and say why.
5. **Done:**
   - The signed PDF is locked so it can't change. It includes an electronic signature certificate with the time, IP address and device.
   - The signed PDF is emailed to you and to the customer.
   - The dashboard shows each change order as Draft, Sent, Viewed, Signed or Declined, with its full history.

Your own signature is saved once in **Settings** and added to the contractor line automatically when you send.

## Run it on a computer

You need Node.js 20 or newer.

```bash
npm install
cp .env.example .env     # then edit .env (see below)
npm start                # opens on http://localhost:3000
```

## Settings (`.env`)

| Setting | What it is |
|---|---|
| `APP_URL` | The public web address of the app. Signing links use it, so customers must be able to open it. |
| `ADMIN_PASSWORD` | Password you use to log in |
| `SESSION_SECRET` | Any long random text |
| `SMTP_*`, `EMAIL_FROM`, `NOTIFY_EMAIL` | Email sending (see below) |
| `TWILIO_*` | Text messages (see below) |
| `DATA_DIR` | Optional. Folder where change orders and signed PDFs are saved. The default is `./data`. |

### Email through Gmail
1. In your Google Account, turn on **2-Step Verification**.
2. Go to **Security → App passwords**, create one called "Change Orders" and copy the 16-letter password.
3. Put it in `SMTP_PASS`. Keep `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465` and `SMTP_USER=onyxgeneralbuilding@gmail.com`.

### Text messages through Twilio
1. Create an account at twilio.com and buy a phone number (about $1–2 a month; each text costs about 1¢).
2. Complete **A2P 10DLC** registration. US carriers require it for business texting, and approval takes a few days.
3. Copy the Account SID, Auth Token and your Twilio number into the `TWILIO_*` settings.

Until texting is set up, you can still use **"Text it from my phone"** on each change order. It opens your phone's messaging app with the link already filled in.

## Putting it online

Customers need to reach the signing link, so the app has to run on a server. One easy option is **Render.com**:
1. Choose **New → Blueprint** and pick this GitHub repository. `render.yaml` sets everything up. Or create a **Web Service** by hand:
2. Set the build command to `npm install` and the start command to `npm start`.
3. Add a **Persistent Disk** mounted at `/var/data`, and set `DATA_DIR=/var/data`. Without it, your change orders are erased whenever the app restarts.
4. Add the `.env` settings as environment variables. Set `APP_URL` to your Render address or your own domain, for example `https://sign.onyxgeneralbuilding.com`.

The total cost is about $7–10 a month.

## Company info and form

- Company name, address, phone, email and license number are in `config/company.json`.
- The logo is `public/logo.png`.
- The form layout is in `lib/pdf.js`.
- The font is Lato, under the SIL Open Font License; see `assets/fonts/OFL.txt`.
