import nodemailer from 'nodemailer';

const createTransporter = () => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    throw new Error('SMTP credentials are missing');
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: false,
    auth: { user, pass }
  });
};

export async function sendTrialEmail(payload) {
  const {
    parentName,
    parentEmail,
    parentPhone,
    childName,
    childAge,
    preferredClass,
    preferredTime
  } = payload;

  const lines = [
    `Parent: ${parentName} (${parentEmail}) ${parentPhone || ''}`.trim(),
    `Child: ${childName}${childAge ? ` (Age ${childAge})` : ''}`,
    `Preferred class: ${preferredClass || 'N/A'}`,
    `Preferred time: ${preferredTime || 'N/A'}`
  ];

  const transporter = createTransporter();

  return transporter.sendMail({
    from: process.env.SMTP_FROM || process.env.SMTP_USER,
    to: process.env.ADMIN_EMAIL,
    subject: 'New Trial Request',
    text: `New trial request\n\n${lines.join('\n')}`
  });
}
