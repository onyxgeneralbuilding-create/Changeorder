// Email (SMTP via nodemailer).
const nodemailer = require('nodemailer');

function emailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
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

module.exports = { emailConfigured, sendEmail };
