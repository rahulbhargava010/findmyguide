CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('traveler','guide','admin')),
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  phone TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX users_email_lower_unique ON users (lower(email));

CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE traveler_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  home_location TEXT,
  interests_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE guide_profiles (
  id SERIAL PRIMARY KEY,
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
  rating NUMERIC(3,1) NOT NULL DEFAULT 0,
  review_count INTEGER NOT NULL DEFAULT 0,
  verification_status TEXT NOT NULL DEFAULT 'approved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE guide_applications (
  id SERIAL PRIMARY KEY,
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
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE availability (
  id SERIAL PRIMARY KEY,
  guide_id INTEGER NOT NULL REFERENCES guide_profiles(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('available','blocked','booked')),
  booking_id INTEGER,
  UNIQUE(guide_id, date)
);

CREATE TABLE bookings (
  id SERIAL PRIMARY KEY,
  reference TEXT UNIQUE,
  traveler_id INTEGER NOT NULL REFERENCES users(id),
  guide_id INTEGER NOT NULL REFERENCES guide_profiles(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  travelers INTEGER NOT NULL,
  focus TEXT NOT NULL,
  message TEXT,
  daily_rate INTEGER NOT NULL,
  subtotal INTEGER NOT NULL,
  service_fee INTEGER NOT NULL,
  total INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'payment_pending' CHECK(status IN ('payment_pending','confirmed','completed','cancelled','refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payments (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_session_id TEXT UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE reviews (
  id SERIAL PRIMARY KEY,
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE invitations (
  id SERIAL PRIMARY KEY,
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
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE booking_requests (
  id SERIAL PRIMARY KEY,
  reference TEXT UNIQUE,
  traveler_id INTEGER NOT NULL REFERENCES users(id),
  guide_id INTEGER NOT NULL REFERENCES guide_profiles(id),
  invitation_id INTEGER REFERENCES invitations(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  travelers INTEGER NOT NULL,
  focus TEXT NOT NULL,
  message TEXT,
  estimated_amount INTEGER NOT NULL DEFAULT 0,
  payment_arrangement TEXT NOT NULL DEFAULT 'direct_with_guide',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','accepted','declined','expired','withdrawn')),
  response_deadline TIMESTAMPTZ NOT NULL,
  guide_note TEXT,
  booking_id INTEGER REFERENCES bookings(id),
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE direct_payment_records (
  id SERIAL PRIMARY KEY,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'not_recorded' CHECK(status IN ('not_recorded','deposit_paid','paid_in_full','pay_on_arrival')),
  amount_recorded INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  recorded_by INTEGER REFERENCES users(id),
  recorded_at TIMESTAMPTZ
);

CREATE INDEX idx_availability_guide_date ON availability(guide_id,date);
CREATE INDEX idx_bookings_traveler ON bookings(traveler_id,status);
CREATE INDEX idx_bookings_guide ON bookings(guide_id,status);
CREATE INDEX idx_requests_guide_status ON booking_requests(guide_id,status,created_at);
CREATE INDEX idx_requests_traveler_status ON booking_requests(traveler_id,status,created_at);
CREATE INDEX idx_invitations_inviter ON invitations(inviter_user_id,status,created_at);

INSERT INTO users(id,role,name,email,phone,password_hash) VALUES
  (1,'admin','Platform Admin','admin@findmyguide.in','', '204e5650efe5cbfca84effc062bbe983:faa48ef027c16bac9b5437df786edc1ae7852598e4ad2624a69dfa8e589f938ba38589f84519aaf99620877fe6b352ec7c884a697f589e1844ff91fd40decd43'),
  (2,'traveler','Meera Shah','traveler@example.com','+91 98765 43210','602f30ada56dbaab7c2033a65f6909a2:695e2af732999ec07494e63e2c206614b8861c588fe4b86fd63eabdae447ea8ccbb108df274e4d28171117ef954f6ccfc2e3344ee3b1d2339cadc6a9a7d4cad7'),
  (3,'guide','Ravi Menon','guide@findmyguide.in','+91 98470 11223','d2e884bbfb578b82a6fd58dfef5c96c4:8c51f25767581ea0dda7e7d22fc98c1993dcafc075f47f3f8e2b7b711ed3051165f4b6b294cc2960ba7fb51fabebe287c24d1d081cf56500cd8ee669eee90d49');

SELECT setval('users_id_seq', 3, true);

INSERT INTO traveler_profiles(user_id,home_location,interests_json)
VALUES (2,'Bengaluru, Karnataka','["Birding","Wildlife","Hiking"]');

INSERT INTO guide_profiles(id,user_id,display_name,primary_location,work_locations_json,expertise_json,languages_json,years_experience,bio,daily_rate,profile_photo,rating,review_count) VALUES
  (1,3,'Ravi Menon','Thattekad, Kerala','["Thattekad Bird Sanctuary","Munnar","Periyar"]','["Birding","Natural history"]','["English","Hindi"]',15,'Ravi Menon is a verified local naturalist and guide.',5500,'https://images.unsplash.com/photo-1542909168-82c3e7fdca5c?auto=format&fit=crop&w=800&q=85',4.9,38),
  (2,NULL,'Meera Joshi','Bera, Rajasthan','["Bera","Jawai"]','["Wildlife tracking","Photography"]','["English","Hindi"]',12,'Meera Joshi is a verified local naturalist and guide.',7000,'https://images.unsplash.com/photo-1492562080023-ab3db95bfbce?auto=format&fit=crop&w=800&q=85',4.9,27),
  (3,NULL,'Tashi Norbu','Eaglenest, Arunachal Pradesh','["Eaglenest","Dirang"]','["Hiking","Birding"]','["English","Hindi"]',10,'Tashi Norbu is a verified local naturalist and guide.',6200,'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?auto=format&fit=crop&w=800&q=85',4.8,19),
  (4,NULL,'Ananya Rao','Agumbe, Karnataka','["Agumbe Rainforest"]','["Herping","Natural history"]','["English","Hindi"]',8,'Ananya Rao is a verified local naturalist and guide.',4800,'https://images.unsplash.com/photo-1531123897727-8f129e1688ce?auto=format&fit=crop&w=800&q=85',4.9,22),
  (5,NULL,'Kabir Singh','Satpura, Madhya Pradesh','["Satpura Tiger Reserve"]','["Wildlife tracking","Natural history"]','["English","Hindi"]',9,'Kabir Singh is a verified local naturalist and guide.',6800,'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=800&q=85',4.7,31),
  (6,NULL,'Lhamo Dolma','Sikkim','["Khangchendzonga","Yuksom"]','["Hiking","Natural history"]','["English","Hindi"]',7,'Lhamo Dolma is a verified local naturalist and guide.',5900,'https://images.unsplash.com/photo-1534751516642-a1af1ef26a56?auto=format&fit=crop&w=800&q=85',5.0,12);

SELECT setval('guide_profiles_id_seq', 6, true);

INSERT INTO availability(guide_id,date,status)
SELECT guide_id, day::date, 'available'
FROM generate_series(1,6) AS guide_id
CROSS JOIN generate_series(DATE '2026-10-01', DATE '2026-10-31', INTERVAL '1 day') AS day;

INSERT INTO bookings(id,reference,traveler_id,guide_id,start_date,end_date,travelers,focus,message,daily_rate,subtotal,service_fee,total,status)
VALUES (1,'FMG-1028',2,1,'2026-06-16','2026-06-18',2,'Birding','A slow-paced monsoon birding trip.',5500,16500,825,17325,'completed');

SELECT setval('bookings_id_seq', 1, true);

INSERT INTO guide_applications(name,email,phone,primary_location,states_json,work_locations_json,expertise_json,languages_json,years_experience,daily_rate,bio,status)
VALUES ('Neha Kapoor','neha@example.com','+91 98100 23456','Nainital, Uttarakhand','["Uttarakhand"]','["Pangot","Sattal","Corbett"]','["Birding","Hiking"]','["Hindi","English"]',9,6000,'Birding guide and naturalist working across Kumaon with a focus on ethical, small-group experiences.','pending');

