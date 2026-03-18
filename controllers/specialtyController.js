import asyncHandler from 'express-async-handler';
import Specialty from '../models/Specialty.js';

// @desc    Get all specialties
// @route   GET /api/specialties
// @access  Public
export const getSpecialties = asyncHandler(async (req, res) => {
  const specialties = await Specialty.find({}).sort({ name: 1 });
  res.json(specialties);
});

// @desc    Create a specialty
// @route   POST /api/specialties
// @access  Private/Admin
export const createSpecialty = asyncHandler(async (req, res) => {
  const { name, description } = req.body;

  if (!name) {
    res.status(400);
    throw new Error('Name is required');
  }

  const exists = await Specialty.findOne({ name });
  if (exists) {
    res.status(400);
    throw new Error('Specialty already exists');
  }

  const specialty = await Specialty.create({ name, description });
  res.status(201).json(specialty);
});

// @desc    Update a specialty
// @route   PUT /api/specialties/:id
// @access  Private/Admin
export const updateSpecialty = asyncHandler(async (req, res) => {
  const specialty = await Specialty.findById(req.params.id);

  if (!specialty) {
    res.status(404);
    throw new Error('Specialty not found');
  }

  specialty.name = req.body.name || specialty.name;
  specialty.description = req.body.description || specialty.description;
  specialty.status = req.body.status || specialty.status;

  const updated = await specialty.save();
  res.json(updated);
});

// @desc    Delete a specialty
// @route   DELETE /api/specialties/:id
// @access  Private/Admin
export const deleteSpecialty = asyncHandler(async (req, res) => {
  const specialty = await Specialty.findById(req.params.id);

  if (!specialty) {
    res.status(404);
    throw new Error('Specialty not found');
  }

  await specialty.deleteOne();
  res.json({ message: 'Specialty removed' });
});
