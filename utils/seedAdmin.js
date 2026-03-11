import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';
import Location from '../models/Location.js';

dotenv.config();

const email = process.env.ADMIN_EMAIL || 'admin@kidsfitness.com';
const password = process.env.ADMIN_PASSWORD || 'Admin@12345';
const name = process.env.ADMIN_NAME || 'Admin User';

async function seedAdmin() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set');
  }

  await mongoose.connect(process.env.MONGO_URI);

  const locationSlug = process.env.DEFAULT_LOCATION_SLUG;
  const location = locationSlug
    ? await Location.findOne({ slug: locationSlug.toLowerCase() })
    : await Location.findOne().sort({ sortOrder: 1, name: 1 });

  const existing = await User.findOne({ email });
  const hashed = await bcrypt.hash(password, 10);

  if (existing) {
    existing.role = existing.role === 'superadmin' ? 'superadmin' : 'admin';
    if (process.env.ADMIN_PASSWORD) {
      existing.password = hashed;
    }
    if (process.env.ADMIN_NAME) {
      existing.name = name;
    }
    if (location && !existing.locationId) {
      existing.locationId = location._id;
    }
    await existing.save();
    console.log(`Admin updated: ${email}`);
  } else {
    await User.create({ name, email, password: hashed, role: 'admin', locationId: location?._id });
    console.log(`Admin created: ${email}`);
  }

  console.log(`Admin password: ${password}`);
  await mongoose.disconnect();
}

seedAdmin().catch((err) => {
  console.error(err);
  process.exit(1);
});
