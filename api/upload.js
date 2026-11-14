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
  if (!key || !pid) return res.
