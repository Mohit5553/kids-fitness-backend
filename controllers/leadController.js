import asyncHandler from 'express-async-handler';
import Lead from '../models/Lead.js';
import { resolveReadLocationId, resolveWriteLocationId } from '../utils/locationScope.js';

export const createLead = asyncHandler(async (req, res) => {
  const { name, email, phone, message, locationId: bodyLocationId } = req.body;
  
  if (!name || !email || !message) {
    res.status(400);
    throw new Error('Name, email, and message are required');
  }

  const locationId = bodyLocationId || resolveWriteLocationId(req);

  const created = await Lead.create({
    name,
    email,
    phone,
    message,
    locationId
  });

  res.status(201).json(created);
});

export const getLeads = asyncHandler(async (req, res) => {
  const locationId = resolveReadLocationId(req);
  const filter = locationId ? { locationId } : {};
  const leads = await Lead.find(filter).sort({ createdAt: -1 });
  res.json(leads);
});

export const updateLeadStatus = asyncHandler(async (req, res) => {
  const lead = await Lead.findById(req.params.id);
  if (!lead) {
    res.status(404);
    throw new Error('Lead not found');
  }

  // Admin and SuperAdmin check or matching locationId
  const canUpdate = req.user.role === 'superadmin' || 
                    (req.user.role === 'admin' && lead.locationId?.toString() === req.user.locationId?.toString());
                    
  if (!canUpdate) {
    res.status(403);
    throw new Error('Not allowed to manage leads for this location');
  }

  if (req.body.status) {
    lead.status = req.body.status;
  }
  
  const saved = await lead.save();
  res.json(saved);
});

export const deleteLead = asyncHandler(async (req, res) => {
    const lead = await Lead.findById(req.params.id);
    if (!lead) {
        res.status(404);
        throw new Error('Lead not found');
    }

    const canDelete = req.user.role === 'superadmin' || 
                      (req.user.role === 'admin' && lead.locationId?.toString() === req.user.locationId?.toString());
                      
    if (!canDelete) {
        res.status(403);
        throw new Error('Not allowed to manage leads for this location');
    }

    await lead.deleteOne();
    res.json({ message: 'Lead removed' });
});
