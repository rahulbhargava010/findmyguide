import { mkdirSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const isNetlify = typeof globalThis.Netlify !== 'undefined' || Boolean(process.env.NETLIFY || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.LAMBDA_TASK_ROOT);
const dbPath = process.env.FMG_DB_PATH || (isNetlify ? '/tmp/findmyguide.sqlite' : join(process.cwd(), 'data', 'findmyguide.sqlite'));
mkdirSync(dirname(dbPath), { recursive: true });
export let db = openDatabase();
export const withDatabaseContext = work => work();

function openDatabase() {
  const connection = new DatabaseSync(dbPath);
  connection.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return connection;
}

export async function loadDatabaseSnapshot(snapshot) {
  db.close();
  await rm(`${dbPath}-wal`, { force: true });
  await rm(`${dbPath}-shm`, { force: true });
  if (snapshot) await writeFile(dbPath, new Uint8Array(snapshot));
  else await rm(dbPath, { force: true });
  db = openDatabase();
  migrate();
  seed();
}

export async function createDatabaseSnapshot() {
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  const bytes = await readFile(dbPath);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

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
    CREATE TABLE IF NOT EXISTS guide_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guide_id INTEGER NOT NULL REFERENCES guide_profiles(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      location TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      start_date TEXT,
      end_date TEXT,
      status TEXT NOT NULL DEFAULT 'published' CHECK(status IN ('draft','published','cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guide_id, title)
    );
    CREATE TABLE IF NOT EXISTS availability (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guide_id INTEGER NOT NULL REFERENCES guide_profiles(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('available','blocked','booked')),
      booking_id INTEGER,
      UNIQUE(guide_id, date)
    );
    CREATE TABLE IF NOT EXISTS availability_slots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guide_id INTEGER NOT NULL REFERENCES guide_profiles(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      label TEXT NOT NULL DEFAULT 'Full day',
      start_time TEXT,
      end_time TEXT,
      capacity INTEGER NOT NULL DEFAULT 1 CHECK(capacity BETWEEN 1 AND 50),
      booked_count INTEGER NOT NULL DEFAULT 0 CHECK(booked_count >= 0),
      visibility TEXT NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','private')),
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','blocked')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(guide_id,date,label)
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
    CREATE TABLE IF NOT EXISTS booking_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_request_id INTEGER REFERENCES booking_requests(id) ON DELETE CASCADE,
      booking_id INTEGER REFERENCES bookings(id) ON DELETE CASCADE,
      sender_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      message_type TEXT NOT NULL DEFAULT 'text' CHECK(message_type IN ('text','system')),
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK((booking_request_id IS NOT NULL) != (booking_id IS NOT NULL))
    );
    CREATE TABLE IF NOT EXISTS booking_quotes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_request_id INTEGER NOT NULL UNIQUE REFERENCES booking_requests(id) ON DELETE CASCADE,
      version INTEGER NOT NULL DEFAULT 1,
      title TEXT NOT NULL,
      meeting_location TEXT NOT NULL,
      meeting_time TEXT,
      itinerary_json TEXT NOT NULL DEFAULT '[]',
      inclusions_json TEXT NOT NULL DEFAULT '[]',
      exclusions_json TEXT NOT NULL DEFAULT '[]',
      guide_notes TEXT,
      currency TEXT NOT NULL DEFAULT 'INR',
      amount INTEGER NOT NULL,
      valid_until TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'sent' CHECK(status IN ('draft','sent','accepted','declined','expired','superseded')),
      accepted_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS booking_lifecycle_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
      actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_type TEXT NOT NULL,
      from_status TEXT,
      to_status TEXT NOT NULL,
      note TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS promotion_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      guide_id INTEGER NOT NULL REFERENCES guide_profiles(id) ON DELETE CASCADE,
      event_id INTEGER REFERENCES guide_events(id) ON DELETE SET NULL,
      code TEXT NOT NULL UNIQUE,
      campaign_name TEXT NOT NULL,
      location_label TEXT,
      channel TEXT NOT NULL DEFAULT 'direct',
      click_count INTEGER NOT NULL DEFAULT 0,
      booking_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS promotion_clicks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      promotion_link_id INTEGER NOT NULL REFERENCES promotion_links(id) ON DELETE CASCADE,
      referrer TEXT,
      user_agent TEXT,
      clicked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS behavior_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      anonymous_id TEXT NOT NULL,
      session_id TEXT NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      event_name TEXT NOT NULL,
      page_type TEXT,
      page_slug TEXT,
      entity_type TEXT,
      entity_id TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      referrer_host TEXT,
      utm_source TEXT,
      utm_medium TEXT,
      utm_campaign TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS marketplace_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      state TEXT NOT NULL,
      country TEXT NOT NULL DEFAULT 'India',
      type TEXT NOT NULL DEFAULT 'city' CHECK(type IN ('city','town','district','region')),
      description TEXT NOT NULL DEFAULT '',
      cover_image TEXT,
      featured INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','draft','archived')),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name,state,country)
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      target_url TEXT,
      read_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_availability_guide_date ON availability(guide_id,date);
    CREATE INDEX IF NOT EXISTS idx_bookings_traveler ON bookings(traveler_id,status);
    CREATE INDEX IF NOT EXISTS idx_bookings_guide ON bookings(guide_id,status);
    CREATE INDEX IF NOT EXISTS idx_requests_guide_status ON booking_requests(guide_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_requests_traveler_status ON booking_requests(traveler_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_invitations_inviter ON invitations(inviter_user_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_guide_events_guide_status ON guide_events(guide_id,status,start_date);
    CREATE INDEX IF NOT EXISTS idx_messages_request ON booking_messages(booking_request_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_booking ON booking_messages(booking_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id,read_at,created_at);
    CREATE INDEX IF NOT EXISTS idx_quotes_request_status ON booking_quotes(booking_request_id,status);
    CREATE INDEX IF NOT EXISTS idx_slots_guide_date ON availability_slots(guide_id,date,status,visibility);
    CREATE INDEX IF NOT EXISTS idx_lifecycle_booking ON booking_lifecycle_events(booking_id,created_at,id);
    CREATE INDEX IF NOT EXISTS idx_promotion_guide ON promotion_links(guide_id,status,created_at);
    CREATE INDEX IF NOT EXISTS idx_promotion_clicks ON promotion_clicks(promotion_link_id,clicked_at);
    CREATE INDEX IF NOT EXISTS idx_behavior_event_time ON behavior_events(event_name,created_at);
    CREATE INDEX IF NOT EXISTS idx_behavior_session ON behavior_events(session_id,created_at);
    CREATE INDEX IF NOT EXISTS idx_marketplace_locations ON marketplace_locations(status,state,name);
  `);
  const requestColumns=new Set(db.prepare('PRAGMA table_info(booking_requests)').all().map(row=>row.name));
  if(!requestColumns.has('slot_label'))db.exec("ALTER TABLE booking_requests ADD COLUMN slot_label TEXT NOT NULL DEFAULT 'Full day'");
  if(!requestColumns.has('slot_start_time'))db.exec('ALTER TABLE booking_requests ADD COLUMN slot_start_time TEXT');
  if(!requestColumns.has('slot_end_time'))db.exec('ALTER TABLE booking_requests ADD COLUMN slot_end_time TEXT');
  if(!requestColumns.has('promotion_link_id'))db.exec('ALTER TABLE booking_requests ADD COLUMN promotion_link_id INTEGER REFERENCES promotion_links(id)');
  const eventColumns=new Set(db.prepare('PRAGMA table_info(guide_events)').all().map(row=>row.name));
  if(!eventColumns.has('capacity'))db.exec('ALTER TABLE guide_events ADD COLUMN capacity INTEGER NOT NULL DEFAULT 6');
  if(!eventColumns.has('price'))db.exec('ALTER TABLE guide_events ADD COLUMN price INTEGER NOT NULL DEFAULT 0');
  if(!eventColumns.has('meeting_location'))db.exec('ALTER TABLE guide_events ADD COLUMN meeting_location TEXT');
  const applicationColumns=new Set(db.prepare('PRAGMA table_info(guide_applications)').all().map(row=>row.name));
  if(!applicationColumns.has('service_areas_json'))db.exec("ALTER TABLE guide_applications ADD COLUMN service_areas_json TEXT NOT NULL DEFAULT '[]'");
  if(!applicationColumns.has('government_documents_json'))db.exec("ALTER TABLE guide_applications ADD COLUMN government_documents_json TEXT NOT NULL DEFAULT '[]'");
  if(!applicationColumns.has('document_verification_status'))db.exec("ALTER TABLE guide_applications ADD COLUMN document_verification_status TEXT NOT NULL DEFAULT 'pending'");
  if(!applicationColumns.has('documents_verified_by'))db.exec('ALTER TABLE guide_applications ADD COLUMN documents_verified_by INTEGER REFERENCES users(id)');
  if(!applicationColumns.has('documents_verified_at'))db.exec('ALTER TABLE guide_applications ADD COLUMN documents_verified_at TEXT');
  const guideColumns=new Set(db.prepare('PRAGMA table_info(guide_profiles)').all().map(row=>row.name));
  if(!guideColumns.has('service_areas_json'))db.exec("ALTER TABLE guide_profiles ADD COLUMN service_areas_json TEXT NOT NULL DEFAULT '[]'");
  if(!guideColumns.has('government_verified'))db.exec('ALTER TABLE guide_profiles ADD COLUMN government_verified INTEGER NOT NULL DEFAULT 0');
  if(!guideColumns.has('verification_level'))db.exec("ALTER TABLE guide_profiles ADD COLUMN verification_level TEXT NOT NULL DEFAULT 'unverified'");
  db.exec("UPDATE guide_profiles SET verification_level='identity_verified' WHERE government_verified=1 AND verification_level='unverified'");
  db.exec("CREATE TRIGGER IF NOT EXISTS set_guide_identity_verification AFTER INSERT ON guide_profiles WHEN NEW.government_verified=1 BEGIN UPDATE guide_profiles SET verification_level='identity_verified' WHERE id=NEW.id; END");
  const bookingColumns=new Set(db.prepare('PRAGMA table_info(bookings)').all().map(row=>row.name));
  if(!bookingColumns.has('operational_status'))db.exec("ALTER TABLE bookings ADD COLUMN operational_status TEXT NOT NULL DEFAULT 'confirmed'");
  if(!bookingColumns.has('pending_start_date'))db.exec('ALTER TABLE bookings ADD COLUMN pending_start_date TEXT');
  if(!bookingColumns.has('pending_end_date'))db.exec('ALTER TABLE bookings ADD COLUMN pending_end_date TEXT');
  if(!bookingColumns.has('change_requested_by'))db.exec('ALTER TABLE bookings ADD COLUMN change_requested_by INTEGER REFERENCES users(id)');
  if(!bookingColumns.has('change_reason'))db.exec('ALTER TABLE bookings ADD COLUMN change_reason TEXT');
  db.exec("UPDATE bookings SET operational_status=CASE status WHEN 'completed' THEN 'completed' WHEN 'cancelled' THEN 'cancelled' WHEN 'refunded' THEN 'cancelled' ELSE 'confirmed' END WHERE operational_status IS NULL OR operational_status='confirmed'");
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
  const events = [
    ['Ravi Menon','Thattekad Dawn Bird Walk','Thattekad Bird Sanctuary, Kerala','Birding','A sunrise birdwatching walk focused on calls, endemics and rainforest ecology.','2026-10-12','2026-10-12'],
    ['Ravi Menon','Western Ghats Endemic Birding','Munnar, Kerala','Birding','A multi-day search for endemic birds across shola forest and high-elevation grassland.','2026-11-05','2026-11-08'],
    ['Meera Joshi','Bera Leopard Tracking Weekend','Bera, Rajasthan','Wildlife tracking','Track leopards ethically across the granite hills with photography-friendly field sessions.','2026-10-23','2026-10-25'],
    ['Meera Joshi','Jawai Wildlife Photography Safari','Jawai, Rajasthan','Photography','Small-group wildlife photography safari for leopards, pastoral landscapes and birds.','2026-12-04','2026-12-06'],
    ['Tashi Norbu','Eaglenest Birding Expedition','Eaglenest, Arunachal Pradesh','Birding','Eastern Himalayan birding expedition with forest walks and high-altitude field sessions.','2026-11-14','2026-11-19'],
    ['Tashi Norbu','Dirang Himalayan Forest Trek','Dirang, Arunachal Pradesh','Hiking','A guided mountain trek through temperate forest, village trails and alpine habitats.','2026-10-17','2026-10-20'],
    ['Ananya Rao','Agumbe Night Herping Trail','Agumbe, Karnataka','Herping','A responsible night walk for snakes, frogs and other rainforest life.','2026-08-15','2026-08-15'],
    ['Ananya Rao','Monsoon Amphibian Walk','Agumbe Rainforest, Karnataka','Natural history','A slow monsoon nature walk focused on frogs, calls and rainforest ecology.','2026-08-22','2026-08-22'],
    ['Kabir Singh','Satpura Canoe Safari','Satpura Tiger Reserve, Madhya Pradesh','Wildlife tracking','A family-friendly canoe and forest safari exploring mammals, tracks and river ecology.','2026-10-09','2026-10-11'],
    ['Kabir Singh','Family Wildlife Tracking Camp','Satpura, Madhya Pradesh','Wildlife tracking','An accessible family camp covering animal signs, forest safety and natural history.','2026-11-20','2026-11-22'],
    ['Lhamo Dolma','Sikkim Rhododendron Trek','Yuksom, Sikkim','Hiking','A small-group trek through rhododendron forest with alpine flora and village stays.','2027-04-10','2027-04-14'],
    ['Lhamo Dolma','Khangchendzonga Alpine Flora Walk','Khangchendzonga, Sikkim','Natural history','A guided botanical hike for alpine flowers, mountain ecology and slow travel.','2027-05-08','2027-05-09']
  ];
  const addEvent = db.prepare(`INSERT OR IGNORE INTO guide_events(guide_id,title,location,category,description,start_date,end_date) SELECT id,?,?,?,?,?,? FROM guide_profiles WHERE display_name=?`);
  for (const [guideName,title,location,category,description,startDate,endDate] of events) addEvent.run(title,location,category,description,startDate,endDate,guideName);
  const ravi = db.prepare("SELECT id FROM guide_profiles WHERE display_name='Ravi Menon'").get();
  const allGuides = db.prepare("SELECT id FROM guide_profiles WHERE verification_status='approved'").all();
  const addAvailability = db.prepare('INSERT OR IGNORE INTO availability(guide_id,date,status) VALUES(?,?,?)');
  for (const guide of allGuides) for (let day=1;day<=31;day++) {
    const unavailable = [3,7,8,9,18,19,20,21,22,27,28].map(d=>((d+guide.id*2-1)%31)+1);
    if (!unavailable.includes(day)) addAvailability.run(guide.id, `2026-10-${String(day).padStart(2,'0')}`, 'available');
  }
  db.exec(`INSERT OR IGNORE INTO availability_slots(guide_id,date,label,start_time,end_time,capacity,booked_count,visibility,status) SELECT guide_id,date,'Full day','06:00','17:00',12,CASE WHEN status='booked' THEN 12 ELSE 0 END,'public',CASE WHEN status='blocked' THEN 'blocked' ELSE 'open' END FROM availability`);
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
