import dotenv from 'dotenv';
import mongoose from 'mongoose';
import ClassModel from '../models/Class.js';
import Plan from '../models/Plan.js';
import Trainer from '../models/Trainer.js';
import Session from '../models/Session.js';
import Location from '../models/Location.js';

dotenv.config();

const locations = [
  {
    name: 'Dubai Al Wasl',
    slug: 'alwasl',
    city: 'Dubai',
    country: 'UAE',
    phone: '+971 4 385 5100',
    email: 'dubai.alwasl@littlesparks.ae',
    imageUrl: 'https://images.unsplash.com/photo-1517836357463-d25dfeac3438?auto=format&fit=crop&w=900&q=80',
    sortOrder: 1
  },
  {
    name: 'My First Gym Online',
    slug: 'online',
    city: 'Online',
    country: 'UAE',
    phone: '+971 4 385 5101',
    email: 'online@littlesparks.ae',
    isOnline: true,
    imageUrl: 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=900&q=80',
    sortOrder: 2
  }
];

const classes = [
  {
    title: 'Baby Movers',
    description: 'Gentle sensory play for balance, rhythm, and parent bonding.',
    ageGroup: '6-24 months',
    duration: '30 min',
    trainer: 'Coach Maya',
    price: 150,
    capacity: 10
  },
  {
    title: 'Ballet Stars',
    description: 'Graceful movement, posture, and musical exploration.',
    ageGroup: '3-6 years',
    duration: '45 min',
    trainer: 'Coach Lina',
    price: 180,
    capacity: 12
  },
  {
    title: 'Combat Crew',
    description: 'Confidence-building martial arts with safe sparring drills.',
    ageGroup: '6-10 years',
    duration: '60 min',
    trainer: 'Coach Amir',
    price: 220,
    capacity: 14
  }
];

const plans = [
  {
    name: '1 Class',
    price: 150,
    validity: 'Drop-in',
    benefits: ['Any class', 'Trainer feedback', 'Flexible timing'],
    type: 'dropin',
    classesIncluded: 1
  },
  {
    name: '1 Active Play',
    price: 80,
    validity: 'Drop-in',
    benefits: ['Active play', 'Short format', 'Energy boost'],
    type: 'dropin',
    classesIncluded: 1
  },
  {
    name: '5 Classes',
    price: 690,
    validity: '4 weeks',
    benefits: ['Priority booking', 'Skill tracker', 'Family invites'],
    type: 'pack',
    classesIncluded: 5,
    durationWeeks: 4
  },
  {
    name: '12 Classes',
    price: 1290,
    validity: '8 weeks',
    benefits: ['Progress report', 'Coach consult', 'Buddy pass'],
    type: 'pack',
    classesIncluded: 12,
    durationWeeks: 8
  },
  {
    name: '24 Classes',
    price: 2290,
    validity: '10 weeks',
    benefits: ['Free uniform', 'VIP events', 'Nutrition tips'],
    type: 'pack',
    classesIncluded: 24,
    durationWeeks: 10
  }
];

const trainers = [
  {
    name: 'Coach Maya',
    bio: 'Early childhood movement specialist with a play-first focus.',
    specialties: ['Sensory play', 'Parent & child'],
    phone: '+971 50 123 0001',
    email: 'maya@littlesparks.ae'
  },
  {
    name: 'Coach Lina',
    bio: 'Classical ballet coach bringing grace and strength to every class.',
    specialties: ['Ballet', 'Flexibility'],
    phone: '+971 50 123 0002',
    email: 'lina@littlesparks.ae'
  },
  {
    name: 'Coach Amir',
    bio: 'Martial arts trainer helping kids build confidence and respect.',
    specialties: ['Combat sports', 'Discipline'],
    phone: '+971 50 123 0003',
    email: 'amir@littlesparks.ae'
  }
];

const buildSessions = (classDocs, trainerDocs, locationId) => {
  const today = new Date();
  const startBase = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0, 0);
  const sessions = [];
  for (let i = 0; i < 6; i += 1) {
    const day = new Date(startBase);
    day.setDate(startBase.getDate() + i);

    const sessionA = {
      classId: classDocs[0]._id,
      trainerId: trainerDocs[0]._id,
      startTime: new Date(day.getTime()),
      endTime: new Date(day.getTime() + 30 * 60000),
      capacity: 10,
      location: 'Studio A',
      locationId
    };

    const sessionB = {
      classId: classDocs[1]._id,
      trainerId: trainerDocs[1]._id,
      startTime: new Date(day.getTime() + 90 * 60000),
      endTime: new Date(day.getTime() + 135 * 60000),
      capacity: 12,
      location: 'Studio B',
      locationId
    };

    const sessionC = {
      classId: classDocs[2]._id,
      trainerId: trainerDocs[2]._id,
      startTime: new Date(day.getTime() + 240 * 60000),
      endTime: new Date(day.getTime() + 300 * 60000),
      capacity: 14,
      location: 'Studio C',
      locationId
    };

    sessions.push(sessionA, sessionB, sessionC);
  }
  return sessions;
};

async function seed() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI is not set');
  }
  await mongoose.connect(process.env.MONGO_URI);
  await ClassModel.deleteMany();
  await Plan.deleteMany();
  await Trainer.deleteMany();
  await Session.deleteMany();
  await Location.deleteMany();

  const locationDocs = await Location.insertMany(locations);
  const primaryLocation = locationDocs[0];

  const classDocs = await ClassModel.insertMany(classes.map((c) => ({ ...c, locationId: primaryLocation._id })));
  const trainerDocs = await Trainer.insertMany(trainers.map((t) => ({ ...t, locationId: primaryLocation._id })));
  await Plan.insertMany(plans.map((p) => ({ ...p, locationId: primaryLocation._id })));

  const sessions = buildSessions(classDocs, trainerDocs, primaryLocation._id);
  await Session.insertMany(sessions);

  console.log('Seed complete');
  await mongoose.disconnect();
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
