// Vercel Serverless Function: /api/upload
// অ্যাডমিন প্যানেল থেকে আসা ছবি ImageKit-এ জমা করে (শুধু লগইন করা অ্যাডমিন পারবে)।
// দরকারি Environment Variables:
//   IMAGEKIT_PRIVATE_KEY  = ImageKit-এর Private Key
//   FIREBASE_PROJECT_ID   = আপনার Firebase প্রজেক্ট আইডি (firebase-config.js-এর projectId)
//   ADMIN_EMAILS          = (ঐচ্ছিক) অ্যাডমিনের ইমেইল, একাধিক হলে কমা দিয়ে

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

async function verifyFirebase(token, projectId) {
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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const key = process.env.IMAGEKIT_PRIVATE_KEY, pid = process.env.FIREBASE_PROJECT_ID;
  if (!key || !pid) return res.status(500).json({ error: 'সার্ভারে সেটিং বসানো হয়নি' });

  try {
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = await verifyFirebase(auth, pid);
    const allow = String(process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) return res.status(403).json({ error: 'অনুমতি নেই' });
  } catch (e) {
    return res.status(401).json({ error: 'লগইন যাচাই হয়নি' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const name = String(body.fileName || 'img.jpg').replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 80);

  // ১) অন্য সাইটের লিংক দিলে ImageKit নিজেই সেটা ডাউনলোড করে নেবে (শুধু ladyglamourwh.com অনুমোদিত)
  // ২) নাহলে আগের মতো base64 ছবি
  let fileVal;
  if (body.url) {
    let u;
    try { u = new URL(String(body.url)); } catch (e) { return res.status(400).json({ error: 'লিংক ঠিক নেই' }); }
    if (u.protocol !== 'https:' || !/(^|\.)ladyglamourwh\.com$/i.test(u.hostname)) return res.status(400).json({ error: 'এই সাইটের লিংক অনুমোদিত নয়' });
    fileVal = u.href;
    // fetchOnly: সার্ভার ছবিটা ডাউনলোড করে ব্রাউজারকে দেয় (ব্রাউজার সেটা ৫০KB-তে কমপ্রেস করে আবার আপলোড করবে)
    if (body.fetchOnly) {
      try {
        const r = await fetch(u.href, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' } });
        if (!r.ok) return res.status(502).json({ error: 'ছবি ডাউনলোড হয়নি (' + r.status + ')' });
        const ct = String(r.headers.get('content-type') || '').split(';')[0].toLowerCase();
        const buf = Buffer.from(await r.arrayBuffer());
        if (!/^image\/(jpeg|png|webp)$/.test(ct)) return res.status(415).json({ error: 'ছবির ধরন সাপোর্ট করে না' });
        if (buf.length > 3000000) return res.status(413).json({ error: 'ছবি বেশি বড়' });
        return res.status(200).json({ data: 'data:' + ct + ';base64,' + buf.toString('base64') });
      } catch (e) { return res.status(502).json({ error: e.message }); }
    }
  } else {
    const m = String(body.file || '').match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!m || m[2].length > 1500000) return res.status(400).json({ error: 'ছবি ঠিক নেই বা বড়' });
    fileVal = m[2];
  }

  const form = new FormData();
  form.append('file', fileVal);
  form.append('fileName', name);
  form.append('folder', '/azaan');
  form.append('useUniqueFileName', 'true');
  const headers = { Authorization: 'Basic ' + Buffer.from(key + ':').toString('base64') };

  let last = 'upload failed';
  for (const ep of ['https://upload.imagekit.io/api/v1/files/upload', 'https://api.imagekit.io/api/v1/files/upload']) {
    try {
      const r = await fetch(ep, { method: 'POST', headers, body: form });
      const j = await r.json().catch(() => ({}));
      if (r.ok && j.url) return res.status(200).json({ url: j.url });
      last = j.message || last;
      if (r.status === 401 || r.status === 403) break;
    } catch (e) { last = e.message; }
  }
  return res.status(502).json({ error: last });
};
