import nodemailer from 'nodemailer';

const createTransporter = () => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!user || !pass) {
    console.warn('SMTP credentials are missing - email features may not work');
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user, pass }
  });
};

const sendEmail = async ({ to, subject, html, text }) => {
  const transporter = createTransporter();
  if (!transporter) return false;

  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      html,
      text: text || 'This email requires HTML viewing support.'
    });
    console.log('Email sent:', info.messageId);
    return true;
  } catch (err) {
    console.error('Email error:', err.message);
    return false;
  }
};

// --- Templates ---

const baseStyles = `
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  line-height: 1.6;
  color: #333;
  max-width: 600px;
  margin: 0 auto;
  border: 1px solid #eee;
  border-radius: 12px;
  overflow: hidden;
`;

const headerStyles = `
  background-color: #29AAE2;
  color: #fff;
  padding: 30px;
  text-align: center;
`;

const contentStyles = `
  padding: 40px;
  background-color: #ffffff;
`;

const footerStyles = `
  padding: 20px;
  background-color: #f9f9f9;
  text-align: center;
  font-size: 11px;
  color: #888;
`;

const buttonStyles = `
  display: inline-block;
  padding: 14px 28px;
  background-color: #29AAE2;
  color: #ffffff;
  text-decoration: none;
  border-radius: 30px;
  font-weight: bold;
  margin: 20px 0;
`;

export async function sendWelcomeEmail(user) {
  const html = `
    <div style="${baseStyles}">
      <div style="${headerStyles}">
        <h1 style="margin:0; font-size: 24px;">Welcome to Kids Fitness!</h1>
      </div>
      <div style="${contentStyles}">
        <p>Hi <strong>${user.firstName || user.name}</strong>,</p>
        <p>Thanks for joining the Kids Fitness family! We're thrilled to have you and your little explorers on board.</p>
        <p>You can now book classes, track progress, and manage your sessions directly from your dashboard.</p>
        <div style="text-align: center;">
          <a href="${process.env.CORS_ORIGIN || 'http://localhost:5173'}/dashboard" style="${buttonStyles}">Go to My Dashboard</a>
        </div>
        <p>If you have any questions, just reply to this email!</p>
        <p>Stay active,<br>The Kids Fitness Team</p>
      </div>
      <div style="${footerStyles}">
        &copy; ${new Date().getFullYear()} Kids Fitness. All rights reserved.
      </div>
    </div>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Welcome to Kids Fitness!',
    html
  });
}

export async function sendBookingConfirmationEmail(booking, classData, userData) {
  const isGuest = !booking.userId;
  const name = isGuest ? booking.guestDetails.name : (userData.firstName || userData.name);
  const email = isGuest ? booking.guestDetails.email : userData.email;

  const html = `
    <div style="${baseStyles}">
      <div style="${headerStyles}">
        <h1 style="margin:0; font-size: 24px;">Booking Confirmed!</h1>
        <p style="margin: 5px 0 0 0; opacity: 0.8;">Order #${booking.bookingNumber}</p>
      </div>
      <div style="${contentStyles}">
        <p>Hi <strong>${name}</strong>,</p>
        <p>Your booking for <strong>${classData.title}</strong> has been successfully placed!</p>
        
        <div style="background-color: #f8fbff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #29AAE2;">
          <p style="margin: 0 0 10px 0;"><strong>Class:</strong> ${classData.title}</p>
          <p style="margin: 0 0 10px 0;"><strong>Date:</strong> ${new Date(booking.date).toLocaleDateString()}</p>
          <p style="margin: 0 0 10px 0;"><strong>Status:</strong> <span style="color: ${booking.status === 'confirmed' ? '#28a745' : '#ffc107'}; font-weight: bold;">${booking.status.toUpperCase()}</span></p>
          <p style="margin: 0;"><strong>Total Paid:</strong> AED ${booking.totalAmount}</p>
        </div>

        <h3>Participants:</h3>
        <ul style="padding-left: 20px;">
          ${booking.participants.map(p => `<li>${p.name} (Age: ${p.age})</li>`).join('')}
        </ul>

        <div style="text-align: center;">
          <a href="${process.env.CORS_ORIGIN || 'http://localhost:5173'}/dashboard/bookings" style="${buttonStyles}">View All Bookings</a>
        </div>
        
        <p>Please arrive 10 minutes before the session starts.</p>
      </div>
      <div style="${footerStyles}">
        &copy; ${new Date().getFullYear()} Kids Fitness. All rights reserved.
      </div>
    </div>
  `;

  return sendEmail({
    to: email,
    subject: `Booking Confirmation - ${booking.bookingNumber}`,
    html
  });
}

export async function sendBookingUpdateEmail(booking, status, userData) {
  const html = `
    <div style="${baseStyles}">
      <div style="${headerStyles}">
        <h1 style="margin:0; font-size: 24px;">Booking Update</h1>
        <p style="margin: 5px 0 0 0; opacity: 0.8;">Order #${booking.bookingNumber}</p>
      </div>
      <div style="${contentStyles}">
        <p>Hi <strong>${userData.firstName || userData.name}</strong>,</p>
        <p>The status of your booking <strong>#${booking.bookingNumber}</strong> has been updated to:</p>
        
        <div style="text-align: center; margin: 30px 0;">
          <span style="font-size: 28px; font-weight: 800; color: #29AAE2; background-color: #f0f7ff; padding: 15px 40px; border-radius: 50px; border: 1px solid #ddecff;">
            ${status.toUpperCase()}
          </span>
        </div>

        <p>You can view the full details and manage your attendance in your dashboard.</p>
        
        <div style="text-align: center;">
          <a href="${process.env.CORS_ORIGIN || 'http://localhost:5173'}/dashboard/bookings" style="${buttonStyles}">My Bookings</a>
        </div>
      </div>
      <div style="${footerStyles}">
        &copy; ${new Date().getFullYear()} Kids Fitness. All rights reserved.
      </div>
    </div>
  `;

  return sendEmail({
    to: userData.email,
    subject: `Booking Status Update: ${status.toUpperCase()}`,
    html
  });
}

export async function sendTrialConfirmationEmail(trial) {
  const html = `
    <div style="${baseStyles}">
      <div style="${headerStyles}">
        <h1 style="margin:0; font-size: 24px;">Trial Request Received!</h1>
      </div>
      <div style="${contentStyles}">
        <p>Hi <strong>${trial.parentName}</strong>,</p>
        <p>Thank you for your interest in Kids Fitness!</p>
        <p>We've received your trial request for <strong>${trial.childName}</strong>. Our team is reviewing the schedule and will contact you shortly at <strong>${trial.parentPhone || 'your phone number'}</strong> to confirm the exact slot.</p>
        
        <div style="background-color: #f5f5f5; padding: 20px; border-radius: 8px; margin: 20px 0;">
          <p style="margin: 0 0 5px 0;"><strong>Preferred Class:</strong> ${trial.preferredClass || 'TBA'}</p>
          <p style="margin: 0;"><strong>Preferred Day/Time:</strong> ${trial.preferredTime || 'TBA'}</p>
        </div>

        <p>We can't wait to see you at the center!</p>
      </div>
      <div style="${footerStyles}">
        &copy; ${new Date().getFullYear()} Kids Fitness. All rights reserved.
      </div>
    </div>
  `;

  // Send to Parent
  await sendEmail({
    to: trial.parentEmail,
    subject: 'We received your trial request!',
    html
  });

  // Send to Admin
  return sendTrialEmail(trial);
}

export async function sendMembershipUpdateEmail(membership, userData, planData) {
  const html = `
    <div style="${baseStyles}">
      <div style="${headerStyles}">
        <h1 style="margin:0; font-size: 24px;">Membership Updated</h1>
      </div>
      <div style="${contentStyles}">
        <p>Hi <strong>${userData.firstName || userData.name}</strong>,</p>
        <p>Your membership details have been updated by the administrator.</p>
        
        <div style="background-color: #f8fbff; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #29AAE2;">
          <p style="margin: 0 0 10px 0;"><strong>Plan:</strong> ${planData.name}</p>
          <p style="margin: 0 0 10px 0;"><strong>Status:</strong> <span style="color: #29AAE2; font-weight: bold;">${membership.status.toUpperCase()}</span></p>
          <p style="margin: 0 0 10px 0;"><strong>Valid Until:</strong> ${new Date(membership.endDate).toLocaleDateString()}</p>
          <p style="margin: 0;"><strong>Classes Left:</strong> ${membership.classesRemaining !== undefined ? membership.classesRemaining : 'Unlimited'}</p>
        </div>

        <p>You can view your full membership details in your dashboard.</p>
        
        <div style="text-align: center;">
          <a href="${process.env.CORS_ORIGIN || 'http://localhost:5173'}/dashboard/membership" style="${buttonStyles}">My Membership</a>
        </div>
      </div>
      <div style="${footerStyles}">
        &copy; ${new Date().getFullYear()} Kids Fitness. All rights reserved.
      </div>
    </div>
  `;

  return sendEmail({
    to: userData.email,
    subject: `Membership Update: ${planData.name}`,
    html
  });
}

export async function sendPaymentConfirmationEmail(payment, userData, description = 'Your payment') {
  const html = `
    <div style="${baseStyles}">
      <div style="${headerStyles}">
        <h1 style="margin:0; font-size: 24px;">Payment Received!</h1>
      </div>
      <div style="${contentStyles}">
        <p>Hi <strong>${userData.firstName || userData.name}</strong>,</p>
        <p>This is a confirmation that we've received ${description}.</p>
        
        <div style="background-color: #fff9f0; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px solid #ffe8cc;">
          <p style="margin: 0 0 10px 0;"><strong>Amount:</strong> AED ${payment.amount}</p>
          <p style="margin: 0 0 10px 0;"><strong>Payment Method:</strong> ${payment.paymentMethod.toUpperCase()}</p>
          <p style="margin: 0 0 10px 0;"><strong>Reference:</strong> ${payment.reference || 'N/A'}</p>
          <p style="margin: 0;"><strong>Date:</strong> ${new Date(payment.createdAt).toLocaleDateString()}</p>
        </div>

        <p>Thank you for your payment. You can find your full transaction history in your dashboard.</p>
        
        <div style="text-align: center;">
          <a href="${process.env.CORS_ORIGIN || 'http://localhost:5173'}/dashboard/payments" style="${buttonStyles}">View Payment History</a>
        </div>
      </div>
      <div style="${footerStyles}">
        &copy; ${new Date().getFullYear()} Kids Fitness. All rights reserved.
      </div>
    </div>
  `;

  return sendEmail({
    to: userData.email,
    subject: `Payment Confirmation: AED ${payment.amount}`,
    html
  });
}

export async function sendAccountUpdateEmail(user, type = 'profile') {
  const html = `
    <div style="${baseStyles}">
      <div style="${headerStyles}">
        <h1 style="margin:0; font-size: 24px;">Account Security Update</h1>
      </div>
      <div style="${contentStyles}">
        <p>Hi <strong>${user.firstName || user.name}</strong>,</p>
        <p>This is an automated notification to let you know that your <strong>${type}</strong> has been updated by an administrator.</p>
        
        <p>If you did not request this change, please contact our support team immediately.</p>
        
        <div style="text-align: center;">
          <a href="${process.env.CORS_ORIGIN || 'http://localhost:5173'}/dashboard" style="${buttonStyles}">Go to My Dashboard</a>
        </div>
      </div>
      <div style="${footerStyles}">
        &copy; ${new Date().getFullYear()} Kids Fitness. All rights reserved.
      </div>
    </div>
  `;

  return sendEmail({
    to: user.email,
    subject: `Account Update: ${type.charAt(0).toUpperCase() + type.slice(1)}`,
    html
  });
}

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

  const html = `
    <div style="${baseStyles}">
      <div style="background-color: #333; color: #fff; padding: 30px; text-align: center;">
        <h1 style="margin:0; font-size: 24px;">NEW TRIAL REQUEST</h1>
      </div>
      <div style="${contentStyles}">
        <p><strong>Parent:</strong> ${parentName} (<a href="mailto:${parentEmail}">${parentEmail}</a>)</p>
        <p><strong>Phone:</strong> ${parentPhone || 'N/A'}</p>
        <p><strong>Child:</strong> ${childName} (Age: ${childAge || 'N/A'})</p>
        <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;">
        <p><strong>Preferred Class:</strong> ${preferredClass || 'N/A'}</p>
        <p><strong>Preferred Time:</strong> ${preferredTime || 'N/A'}</p>
      </div>
    </div>
  `;

  return sendEmail({
    to: process.env.ADMIN_EMAIL,
    subject: 'New Trial Request Received',
    html
  });
}

export async function sendPasswordResetEmail(user, resetUrl) {
  const html = `
    <div style="${baseStyles}">
      <div style="${headerStyles}">
        <h1 style="margin:0; font-size: 24px;">Reset Your Password</h1>
      </div>
      <div style="${contentStyles}">
        <p>Hi <strong>${user.firstName || user.name}</strong>,</p>
        <p>You are receiving this email because you (or someone else) have requested a password reset for your account.</p>
        <p>Please click the button below to complete the process. <strong>This link will expire in 1 hour.</strong></p>
        <div style="text-align: center;">
          <a href="${resetUrl}" style="${buttonStyles}">Reset Password</a>
        </div>
        <p>If you did not request this, please ignore this email and your password will remain unchanged.</p>
        <p>Best regards,<br>The Kids Fitness Team</p>
      </div>
      <div style="${footerStyles}">
        &copy; ${new Date().getFullYear()} Kids Fitness. All rights reserved.
      </div>
    </div>
  `;

  return sendEmail({
    to: user.email,
    subject: 'Password Reset Request',
    html
  });
}
