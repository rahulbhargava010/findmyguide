import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const isNetlify = Boolean(process.env.NETLIFY);
let db;
let withDatabaseContext = work => work();

if (isNetlify) {
  const postgres = await import('./postgres.mjs');
  db = postgres.db;
  withDatabaseContext = postgres.withDatabaseContext;
} else {
  const dbPath = process.env.FMG_DB_PATH || join(process.cwd(), 'data', 'findmyguide.sqlite');
  mkdirSync(dirname(dbPath), { recursive: true });
  db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
}

export { db, withDatabaseContext };

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hex] = String(stored || '').split(':');
  if (!salt || !hex) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function migrate() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL CHECK(role IN ('traveler','guide','admin')),
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE COLLATE NOCASE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS traveler_profiles (
      user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      home_location TEXT,
      interests_json TEXT NOT NULL DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS guide_profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      primary_location TEXT NOT NULL,
      work_locations_json TEXT NOT NULL DEFAULT '[]',
      expertise_json TEXT NOT NULL DEFAULT '[]',
      languages_json TEXT NOT NULL DEFAULT '[]',
      years_experience INTEGER NOT NULL DEFAULT 0,
      bio TEXT,
      daily_rate INTEGER NOT NULL DEFAULT 0,
      profile_photo TEXT,
      work_photos_json TEXT NOT NULL DEFAULT '[]',
      rating REAL NOT NULL DEFAULT 0,
      review_count INTEGER NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL DEFAULT 'approved',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS guide_applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      applicant_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      whatsapp TEXT,
      primary_location TEXT NOT NULL,
      states_json TEXT NOT NULL DEFAULT '[]',
      work_locations_json TEXT NOT NULL DEFAULT '[]',
      expertise_json TEXT NOT NULL DEFAULT '[]',
      languages_json TEXT NOT NULL DEFAULT '[]',
      years_experience INTEGER NOT NULL,
      daily_rate INTEGER NOT NULL DEFAULT 0,
      bio TEXT NOT NULL,
      profile_photo TEXT,
      work_photos_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','needs_information','approved','rejected')),
      admin_note TEXT,
      reviewed_by INTEGER REFERENCES users(id),
      reviewed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guide_id INTEGER NOT NULL REFERENCES guide_profiles(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('available','blocked','booked')),
      booking_id INTEGER,
      UNIQUE(guide_id, date)
    );
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT UNIQUE,
      traveler_id INTEGER NOT NULL REFERENCES users(id),
      guide_id INTEGER NOT NULL REFERENCES guide_profiles(id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      travelers INTEGER NOT NULL,
      focus TEXT NOT NULL,
      message TEXT,
      daily_rate INTEGER NOT NULL,
      subtotal INTEGER NOT NULL,
      service_fee INTEGER NOT NULL,
      total INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'payment_pending' CHECK(status IN ('payment_pending','confirmed','completed','cancelled','refunded')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      provider_session_id TEXT UNIQUE,
      amount INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'pending',
      paid_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
      traveler_id INTEGER NOT NULL REFERENCES users(id),
      guide_id INTEGER NOT NULL REFERENCES guide_profiles(id),
      overall INTEGER NOT NULL CHECK(overall BETWEEN 1 AND 5),
      knowledge INTEGER NOT NULL CHECK(knowledge BETWEEN 1 AND 5),
      communication INTEGER NOT NULL CHECK(communication BETWEEN 1 AND 5),
      organisation INTEGER NOT NULL CHECK(organisation BETWEEN 1 AND 5),
      value INTEGER NOT NULL CHECK(value BETWEEN 1 AND 5),
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      photos_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'published',
      guide_reply TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS invitations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      kind TEXT NOT NULL CHECK(kind IN ('guide_onboarding','client_booking')),
      token_hash TEXT NOT NULL UNIQUE,
      inviter_user_id INTEGER NOT NULL REFERENCES users(id),
      guide_id INTEGER REFERENCES guide_profiles(id) ON DELETE CASCADE,
      recipient_name TEXT,
      recipient_email TEXT,
      recipient_phone TEXT,
      message TEXT,
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('sent','opened','accepted','expired','revoked')),
      accepted_user_id INTEGER REFERENCES users(id),
      expires_at TEXT NOT NULL,
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS booking_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reference TEXT UNIQUE,
      traveler_id INTEGER NOT NULL REFERENCES users(id),
      guide_id INTEGER NOT NULL REFERENCES guide_profiles(id),
      invitation_id INTEGER REFERENCES invitations(id),
      start_date TEXT NOT NULL,
      end_date TEXT NOT NULL,
      travelers INTEGER NOT NULL,
      focus TEXT NOT NULL,
      message TEXT,
      estimated_amount INTEGER NOT NULL DEFAULT 0,
      payment_arrangement TEXT NOT NULL DEFAULT 'direct_with_guide',
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','expired','withdrawn')),
      response_deadline TEXT NOT NULL,
      guide_note TEXT,
      booking_id INTEGER REFERENCES bookings(id),
      responded_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS direct_payment_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'not_recorded' CHECK(status IN ('not_recorded','deposit_paid','paid_in_full','pay_on_arrival')),
      amount_recorded INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      recorded_by INTEGER REFERENCES users(id),
      recorded_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_availability_guide_date ON availability(guide_id,date);
    CREATE INDEX IF NOT EXISTS idx_bookings_traveler ON bookings(traveler_id,status);
    CREATE INDEX IF NOT EXISTS idx_bookings_guide ON bookings(guide_id,status);
    CREATE INDEX IF NOT EXISTS idx_requests_guide_status ON booking_requests(guide_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_requests_traveler_status ON booking_requests(traveler_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON invitations(inviter_user_id,status,created_at);
  `);
}

function insertUser({ role, name, email, phone = '', password }) {
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (existing) return existing.id;
  return Number(db.prepare('INSERT INTO users(role,name,email,phone,password_hash) VALUES(?,?,?,?,?)')
    .run(role, name, email, phone, hashPassword(password)).lastInsertRowid);
}

export function seed() {
  const adminId = insertUser({ role: 'admin', name: 'Platform Admin', email: 'admin@findmyguide.in', password: 'Admin123!' });
  const travelerId = insertUser({ role: 'traveler', name: 'Meera Shah', email: 'traveler@example.com', phone: '+91 98765 43210', password: 'Traveler123!' });
  db.prepare('INSERT OR IGNORE INTO traveler_profiles(user_id,home_location,interests_json) VALUES(?,?,?)')
    .run(travelerId, 'Bengaluru, Karnataka', JSON.stringify(['Birding','Wildlife','Hiking']));

  const guides = [
    ['Ravi Menon','Thattekad, Kerala',['Thattekad Bird Sanctuary','Munnar','Periyar'],['Birding','Natural history'],15,5500,4.9,38,'https://images.unsplash.com/photo-1542909168-82c3e7fdca5c?auto=format&fit=crop&w=800&q=85'],
    ['Meera Joshi','Bera, Rajasthan',['Bera','Jawai'],['Wildlife tracking','Photography'],12,7000,4.9,27,'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=800&q=85'],
    ['Tashi Norbu','Eaglenest, Arunachal Pradesh',['Eaglenest','Dirang'],['Hiking','Birding'],10,6200,4.8,19,'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=85'],
    ['Ananya Rao','Agumbe, Karnataka',['Agumbe Rainforest'],['Herping','Natural history'],8,4800,4.9,22,'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=800&q=85'],
    ['Kabir Singh','Satpura, Madhya Pradesh',['Satpura Tiger Reserve'],['Wildlife tracking','Natural history'],9,6800,4.7,31,'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=85'],
    ['Lhamo Dolma','Sikkim',['Khangchendzonga','Yuksom'],['Hiking','Natural history'],7,5900,5.0,12,'https://images.unsplash.com/photo-1534751516642-a1af1ef26a56?auto=format&fit=crop&w=800&q=85']
  ];
  for (let i = 0; i < guides.length; i++) {
    const [name, location, work, expertise, years, rate, rating, reviews, photo] = guides[i];
    let userId = null;
    if (i === 0) userId = insertUser({ role: 'guide', name, email: 'guide@findmyguide.in', phone: '+91 98470 11223', password: 'Guide123!' });
    const exists = db.prepare('SELECT id FROM guide_profiles WHERE display_name = ?').get(name);
    if (!exists) db.prepare(`INSERT INTO guide_profiles(user_id,display_name,primary_location,work_locations_json,expertise_json,languages_json,years_experience,bio,daily_rate,profile_photo,rating,review_count) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(userId, name, location, JSON.stringify(work), JSON.stringify(expertise), JSON.stringify(['English','Hindi']), years, `${name} is a verified local naturalist and guide.`, rate, photo, rating, reviews);
  }
  const ravi = db.prepare("SELECT id FROM guide_profiles WHERE display_name='Ravi Menon'").get();
  const allGuides = db.prepare("SELECT id FROM guide_profiles WHERE verification_status='approved'").all();
  const addAvailability = db.prepare('INSERT OR IGNORE INTO availability(guide_id,date,status) VALUES(?,?,?)');
  for (const guide of allGuides) for (let day=1;day<=31;day++) {
    const unavailable = [3,7,8,9,18,19,20,21,22,27,28].map(d=>((d+guide.id*2-1)%31)+1);
    if (!unavailable.includes(day)) addAvailability.run(guide.id, `2026-10-${String(day).padStart(2,'0')}`, 'available');
  }
  if (!db.prepare("SELECT id FROM bookings WHERE reference='FMG-1028'").get()) {
    db.prepare(`INSERT INTO bookings(reference,traveler_id,guide_id,start_date,end_date,travelers,focus,message,daily_rate,subtotal,service_fee,total,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('FMG-1028', travelerId, ravi.id, '2026-06-16', '2026-06-18', 2, 'Birding', 'A slow-paced monsoon birding trip.', 5500, 16500, 825, 17325, 'completed');
  }
  if (!db.prepare('SELECT id FROM guide_applications LIMIT 1').get()) {
    db.prepare(`INSERT INTO guide_applications(name,email,phone,primary_location,states_json,work_locations_json,expertise_json,languages_json,years_experience,daily_rate,bio,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run('Neha Kapoor','neha@example.com','+91 98100 23456','Nainital, Uttarakhand',JSON.stringify(['Uttarakhand']),JSON.stringify(['Pangot','Sattal','Corbett']),JSON.stringify(['Birding','Hiking']),JSON.stringify(['Hindi','English']),9,6000,'Birding guide and naturalist working across Kumaon with a focus on ethical, small-group experiences.','pending');
  }
  return { adminId, travelerId, raviId: ravi.id };
}

export const json = value => {
  try { return JSON.parse(value || '[]'); } catch { return []; }
};
// SQLite schema, migrations, seed data, and password helpers.
