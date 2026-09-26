import nodemailer from 'nodemailer';
import { User } from '../models/User.js';

let transporter = null;

const smtpConfigured =
  Boolean(process.env.SMTP_HOST) &&
  Boolean(process.env.SMTP_USER) &&
  Boolean(process.env.SMTP_PASS);

if (smtpConfigured) {
  try {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT || 587) === 465,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    });
  } catch (err) {
    console.error(
      '[Email] Transporter setup failed:',
      err.message
    );
  }
} else {
  console.warn(
    '[Email] SMTP is not configured. Email notifications are disabled.'
  );
}

export const verifyEmailTransport = async () => {
  if (!transporter) {
    return false;
  }

  try {
    await transporter.verify();
    console.log('[Email] SMTP connection verified successfully.');
    return true;
  } catch (err) {
    console.error(
      '[Email] SMTP verification failed:',
      err.message
    );
    return false;
  }
};

export const sendEmail = async (
  userId,
  { subject, text, html }
) => {
  if (!transporter) {
    console.warn(
      '[Email] Email not sent because SMTP is not configured.'
    );
    return false;
  }

  const user = await User.findById(userId)
    .select('email name')
    .lean();

  if (!user?.email) {
    console.warn(
      `[Email] User ${userId} does not have an email address.`
    );
    return false;
  }

  try {
    const mailOptions = {
      from:
        process.env.SMTP_FROM ||
        `Acadova <${process.env.SMTP_USER}>`,
      to: user.email,
      subject: `Acadova — ${subject}`,
      text: text || '',
    };

    if (html) {
      mailOptions.html = html;
    }

    await transporter.sendMail(mailOptions);

    console.log(
      `[Email] Notification sent successfully to ${user.email}`
    );

    return true;
  } catch (err) {
    console.error(
      `[Email] Failed to send notification to ${user.email}:`,
      err.message
    );

    return false;
  }
};