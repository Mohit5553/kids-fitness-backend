import twilio from 'twilio';

export const sendSms = async ({ to, body }) => {
  const provider = process.env.SMS_PROVIDER || 'twilio';

  if (provider === 'webhook') {
    const url = process.env.SMS_WEBHOOK_URL;
    if (!url) return { sent: false, reason: 'SMS webhook not configured' };

    const payload = {
      to,
      body,
      apiKey: process.env.SMS_WEBHOOK_TOKEN || ''
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      return { sent: false, reason: 'Webhook error' };
    }

    return { sent: true };
  }

  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;

  if (!sid || !token || !from) {
    return { sent: false, reason: 'Twilio not configured' };
  }

  const client = twilio(sid, token);
  await client.messages.create({ from, to, body });
  return { sent: true };
};
