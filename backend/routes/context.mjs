import { createHash, randomBytes } from 'node:crypto';
import { db, json, verifyPassword, hashPassword } from '../database/database.mjs';

const SESSION_COOKIE = 'fmg_session';
const sha256 = text => createHash('sha256').update(text).digest('hex');
const reply = (res, status, body, headers = {}) => {
  res.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});
  res.end(JSON.stringify(body));
};
const fail = (res, status, message, details) => reply(res, status, {error:message,...(details ? {details} : {})});
const parseCookies = req => Object.fromEntries(String(req.headers.cookie || '').split(';').filter(Boolean).map(part => {
  const index = part.indexOf('=');
  return [part.slice(0,index).trim(), decodeURIComponent(part.slice(index+1))];
}));
const publicUser = row => row && ({id:row.id,role:row.role,name:row.name,email:row.email,phone:row.phone,status:row.status});
const cleanText = (value, max=500) => String(value ?? '').trim().slice(0,max);

async function body(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw Object.assign(new Error('Request too large'), {status:413});
  }
  if (!raw) return {};
  try { return JSON.parse(raw); }
  catch { throw Object.assign(new Error('Invalid JSON'), {status:400}); }
}

async function sessionUser(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  return await db.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at > datetime('now') AND u.status='active'`).get(sha256(token)) || null;
}

async function requireUser(req, res, roles = []) {
  const user = await sessionUser(req);
  if (!user) { fail(res,401,'Authentication required'); return null; }
  if (roles.length && !roles.includes(user.role)) { fail(res,403,'You do not have permission for this action'); return null; }
  return user;
}

async function createSession(res, userId) {
  const token = randomBytes(32).toString('base64url');
  await db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')").run();
  await db.prepare("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES(?,?,datetime('now','+7 days'))").run(userId,sha256(token));
  res.setHeader('Set-Cookie',`${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=604800`);
}

function guideDto(row) {
  return {id:row.id,name:row.display_name,location:row.primary_location,workLocations:json(row.work_locations_json),expertise:json(row.expertise_json),languages:json(row.languages_json),yearsExperience:row.years_experience,bio:row.bio,dailyRate:row.daily_rate,profilePhoto:row.profile_photo,workPhotos:json(row.work_photos_json),rating:row.rating,reviewCount:row.review_count,verificationStatus:row.verification_status};
}

function bookingDto(row) {
  return {id:row.id,reference:row.reference,travelerId:row.traveler_id,guideId:row.guide_id,guideName:row.guide_name,startDate:row.start_date,endDate:row.end_date,travelers:row.travelers,focus:row.focus,message:row.message,dailyRate:row.daily_rate,subtotal:row.subtotal,serviceFee:row.service_fee,total:row.total,status:row.status,paymentArrangement:'direct_with_guide',paymentRecordStatus:row.payment_record_status||'not_recorded',amountRecorded:row.amount_recorded||0,paymentNote:row.payment_note||'',createdAt:row.created_at};
}

export { body, bookingDto, cleanText, createSession, db, fail, guideDto, hashPassword, json, parseCookies, publicUser, randomBytes, reply, requireUser, sessionUser, sha256, verifyPassword, SESSION_COOKIE };
