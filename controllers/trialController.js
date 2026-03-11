import asyncHandler from 'express-async-handler';
import Trial from '../models/Trial.js';
import { sendTrialEmail } from '../utils/mailer.js';
import { sendSms } from '../utils/sms.js';
import { toCsv } from '../utils/csv.js';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

export const createTrial = asyncHandler(async (req, res) => {
  const { parentName, parentEmail, parentPhone, childName, childAge, preferredClass, preferredTime } = req.body;
  if (!parentName || !parentEmail || !childName) {
    res.status(400);
    throw new Error('Parent name, parent email, and child name are required');
  }

  const locationId = resolveWriteLocationId(req);

  const created = await Trial.create({
    parentName,
    parentEmail,
    parentPhone,
    childName,
    childAge,
    preferredClass,
    preferredTime,
    locationId
  });

  let emailSent = false;
  let smsSent = false;
  if (process.env.ADMIN_EMAIL && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      await sendTrialEmail(created);
      emailSent = true;
    } catch (err) {
      console.error('Trial email failed', err.message);
    }
  }

  if (parentPhone) {
    try {
      const smsResult = await sendSms({
        to: parentPhone,
        body: `Thanks ${parentName}! We received your trial request for ${childName}. We'll confirm soon.`
      });
      smsSent = smsResult?.sent === true;
    } catch (err) {
      console.error('Trial SMS failed', err.message);
    }
  }

  res.status(201).json({ ...created.toObject(), emailSent, smsSent });
});

export const getTrials = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const trials = await Trial.find(filter).sort({ createdAt: -1 });
  res.json(trials);
});

export const updateTrialStatus = asyncHandler(async (req, res) => {
  const trial = await Trial.findById(req.params.id);
  if (!trial) {
    res.status(404);
    throw new Error('Trial request not found');
  }
  if (req.user?.role === 'admin' && req.user.locationId && trial.locationId?.toString() !== req.user.locationId.toString()) {
    res.status(403);
    throw new Error('Not allowed');
  }
  if (req.body.status) {
    trial.status = req.body.status;
  }
  const saved = await trial.save();
  res.json(saved);
});

export const exportTrialsCsv = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const trials = await Trial.find(filter).sort({ createdAt: -1 });
  const rows = trials.map((t) => ({
    parentName: t.parentName,
    parentEmail: t.parentEmail,
    parentPhone: t.parentPhone,
    childName: t.childName,
    childAge: t.childAge,
    preferredClass: t.preferredClass,
    preferredTime: t.preferredTime,
    status: t.status,
    createdAt: t.createdAt
  }));

  const csv = toCsv(rows, [
    { key: 'parentName', label: 'Parent Name' },
    { key: 'parentEmail', label: 'Parent Email' },
    { key: 'parentPhone', label: 'Parent Phone' },
    { key: 'childName', label: 'Child Name' },
    { key: 'childAge', label: 'Child Age' },
    { key: 'preferredClass', label: 'Preferred Class' },
    { key: 'preferredTime', label: 'Preferred Time' },
    { key: 'status', label: 'Status' },
    { key: 'createdAt', label: 'Created At' }
  ]);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="trials.csv"');
  res.send(csv);
});
