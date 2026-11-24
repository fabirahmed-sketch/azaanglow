// Vercel Serverless Function: /api/usage
// ImageKit ও Cloudinary-র বান্ডউইথ/স্টোরেজ ইউসেজ ফেরত দেয়। শুধু লগইন করা অ্যাডমিন (Firebase টোকেন) দেখতে পারবে।
//
// Vercel → Settings → Environment Variables এ লাগবে:
//   FIREBASE_PROJECT_ID, IMAGEKIT_PRIVATE_KEY, ADMIN_EMAILS (ঐচ্ছিক): /api/upload এ যেগুলো আছে, সেগুলোই
//   CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET
// ঐচ্ছিক: CLOUDINARY_CLOUD_NAME (ডিফল্ট vapfnr6g), ADMIN_EMAILS (কমা দিয়ে, শুধু এই ইমেইল পারবে),
//         IMAGEKIT_BW_LIMIT_GB (ডিফল্ট 20), IMAGEKIT_STORAGE_LIMIT_GB (ডিফল্ট 3), IMAGEKIT_CYCLE_DAY (ডিফল্ট 1)

const basic = (u, p) => 'Basic ' + Buffer.from(u + ':' + p).toString('base64');
const pad = n => String(n).padStart(2, '0');
const ymd = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

const crypto = require('crypto');
let certCache = { at: 0, certs: null };
async function getCerts() {
  if (certCache.certs && Date.now() - certCache.at < 3600e3) return certCache.certs;
  const r = await fetch('https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com');
  if (!r.ok) throw new Error('certs unavailable');
  certCache = { at: Date.now(), certs: await r.json() };
  return certCache.certs;
}
const b64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
async function verifyFirebase(token, projectId) {   // /api/upload এর মতোই একই যাচাই
  const [h, p, sg] = String(token || '').split('.');
  if (!h || !p || !sg) throw new Error('bad token');
  const head = JSON.parse(b64u(h).toString()), pay = JSON.parse(b64u(p).toString());
  if (head.alg !== 'RS256') throw new Error('bad alg');
  const cert = (await getCerts())[head.kid];
  if (!cert) throw new Error('unknown key');
  if (!crypto.createVerify('RSA-SHA256').update(h + '.' + p).verify(cert, b64u(sg))) throw new Error('bad signature');
  const now = Math.floor(Date.now() / 1000);
  if (pay.aud !== projectId || pay.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('wrong project');
  if (!pay.sub || pay.exp <= now) throw new Error('expired');
  return pay;
}
async function verifyAdmin(req) {
  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid) return false;
  try {
    const user = await verifyFirebase(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''), pid);
    const allow = String(process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    return !allow.length || allow.includes(String(user.email || '').toLowerCase());
  } catch (e) { return false; }
}

async function imagekit() {
  const pk = process.env.IMAGEKIT_PRIVATE_KEY;
  if (!pk) return { error: 'IMAGEKIT_PRIVATE_KEY সেট করা নেই' };
  const now = new Date(), cd = Math.min(28, Math.max(1, +process.env.IMAGEKIT_CYCLE_DAY || 1));
  let start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), cd));
  if (now.getUTCDate() < cd) start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, cd));
  const r = await fetch(`https://api.imagekit.io/v1/accounts/usage?startDate=${ymd(start)}&endDate=${ymd(now)}`, { headers: { Authorization: basic(pk, '') } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: j.message || ('ImageKit HTTP ' + r.status) };
  return {
    since: ymd(start),
    bandwidthBytes: j.bandwidthBytes || 0,
    storageBytes: (j.mediaLibraryStorageBytes || 0) + (j.originalCacheStorageBytes || 0),
    bwLimitGB: +process.env.IMAGEKIT_BW_LIMIT_GB || 20,
    storageLimitGB: +process.env.IMAGEKIT_STORAGE_LIMIT_GB || 3
  };
}

async function cloudinary() {
  const k = process.env.CLOUDINARY_API_KEY, s = process.env.CLOUDINARY_API_SECRET, c = process.env.CLOUDINARY_CLOUD_NAME || 'vapfnr6g';
  if (!k || !s) return { error: 'CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET সেট করা নেই' };
  const r = await fetch(`https://api.cloudinary.com/v1_1/${c}/usage`, { headers: { Authorization: basic(k, s) } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) return { error: j.error?.message || ('Cloudinary HTTP ' + r.status) };
  return {
    plan: j.plan || '',
    creditsUsed: j.credits?.usage ?? 0, creditsLimit: j.credits?.limit ?? 0, creditsPct: j.credits?.used_percent ?? 0,
    bandwidthBytes: j.bandwidth?.usage ?? 0, storageBytes: j.storage?.usage ?? 0, transformations: j.transformations?.usage ?? 0
  };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!(await verifyAdmin(req))) return res.status(401).json({ error: 'অনুমতি নেই (লগইন করুন / FIREBASE_PROJECT_ID দিন)' });
    const [ik, cl] = await Promise.all([imagekit().catch(e => ({ error: e.message })), cloudinary().catch(e => ({ error: e.message }))]);
    res.status(200).json({ imagekit: ik, cloudinary: cl });
  } catch (e) { res.status(500).json({ error: e.message || 'server error' }); }
};
