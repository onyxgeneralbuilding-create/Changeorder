// Email (SMTP via nodemailer) and text messages (Twilio REST API).
const nodemailer = require('nodemailer');

function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function smsConfigured() {
  return Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
}

let transporter;
function getTransporter() {
  if (!transporter) {
    const port = Number(process.env.SMTP_PORT || 465);
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    });
  }
  return transporter;
}

// Sender shown in the inbox. Built as { name, address } so a comma in the
// name (e.g. "…, Inc.") can't be misread as a second address.
function sender() {
  const raw = process.env.EMAIL_FROM || '';
  const addr = (/<([^>]+)>/.exec(raw) || [])[1] || (raw.includes('@') && !raw.includes(' ') ? raw : '') || process.env.SMTP_USER;
  return { name: process.env.EMAIL_FROM_NAME || 'Onyx General Building', address: addr };
}

async function sendEmail({ to, subject, text, html, attachments, replyTo }) {
  if (!emailConfigured()) throw new Error('Email is not set up yet. Add your SMTP settings to the .env file (see README).');
  const info = await getTransporter().sendMail({
    from: sender(),
    to,
    subject,
    text,
    html,
    attachments,
    replyTo,
  });
  return info.messageId;
}

// Turn "818-555-0142" / "(818) 555 0142" / "+18185550142" into E.164 (+18185550142).
function toE164(phone) {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

async function sendSms({ to, body }) {
  if (!smsConfigured()) throw new Error('Texting is not set up yet. Add your Twilio settings to the .env file (see README).');
  const num = toE164(to);
  if (!num) throw new Error(`"${to}" doesn't look like a valid phone number.`);
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: num, From: process.env.TWILIO_FROM_NUMBER, Body: body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Text message failed: ${data.message || res.statusText}`);
  return data.sid;
}

module.exports = { emailConfigured, smsConfigured, sendEmail, sendSms, toE164 };
