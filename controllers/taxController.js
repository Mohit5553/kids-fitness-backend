import Tax from '../models/Tax.js';

export const createTax = async (req, res) => {
  try {
    const tax = new Tax(req.body);
    await tax.save();
    res.status(201).json({ success: true, data: tax });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getTaxes = async (req, res) => {
  try {
    const { locationId } = req.query;
    const filter = {};
    if (locationId) filter.locationId = locationId;
    
    const taxes = await Tax.find(filter).populate('locationId', 'name');
    res.status(200).json({ success: true, data: taxes });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const getTaxById = async (req, res) => {
  try {
    const tax = await Tax.findById(req.params.id).populate('locationId', 'name');
    if (!tax) return res.status(404).json({ success: false, message: 'Tax not found' });
    res.status(200).json({ success: true, data: tax });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const updateTax = async (req, res) => {
  try {
    const tax = await Tax.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!tax) return res.status(404).json({ success: false, message: 'Tax not found' });
    res.status(200).json({ success: true, data: tax });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteTax = async (req, res) => {
  try {
    const tax = await Tax.findByIdAndDelete(req.params.id);
    if (!tax) return res.status(404).json({ success: false, message: 'Tax not found' });
    res.status(200).json({ success: true, message: 'Tax deleted' });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
