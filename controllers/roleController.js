import asyncHandler from 'express-async-handler';
import Role from '../models/Role.js';

// @desc    Get all roles
// @route   GET /api/roles
// @access  Private/Admin
export const getRoles = asyncHandler(async (req, res) => {
  const roles = await Role.find({});
  res.json(roles);
});

// @desc    Create a role
// @route   POST /api/roles
// @access  Private/Admin
export const createRole = asyncHandler(async (req, res) => {
  const { name, permissions, description, status } = req.body;

  const roleExists = await Role.findOne({ name });
  if (roleExists) {
    res.status(400);
    throw new Error('Role already exists');
  }

  const role = await Role.create({
    name,
    permissions,
    description,
    status
  });

  res.status(201).json(role);
});

// @desc    Update a role
// @route   PUT /api/roles/:id
// @access  Private/Admin
export const updateRole = asyncHandler(async (req, res) => {
  const role = await Role.findById(req.params.id);

  if (role) {
    role.name = req.body.name || role.name;
    role.permissions = req.body.permissions || role.permissions;
    role.description = req.body.description || role.description;
    role.status = req.body.status || role.status;

    const updatedRole = await role.save();
    res.json(updatedRole);
  } else {
    res.status(404);
    throw new Error('Role not found');
  }
});

// @desc    Delete a role
// @route   DELETE /api/roles/:id
// @access  Private/Admin
export const deleteRole = asyncHandler(async (req, res) => {
  const role = await Role.findById(req.params.id);

  if (role) {
    await Role.deleteOne({ _id: req.params.id });
    res.json({ message: 'Role removed' });
  } else {
    res.status(404);
    throw new Error('Role not found');
  }
});
