// Vercel Serverless Function: /api/lg-products
// ladyglamourwh.com-এর প্রোডাক্ট (দাম, শেড, ভ্যারিয়েন্টসহ) অ্যাডমিনের JSON ফরম্যাটে এনে দেয় (শুধু লগইন করা অ্যাডমিন পারবে)।
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


const SITE = 'https://ladyglamourwh.com/wp-json/wc/store/v1/products';
const HDR = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' };
const SHADE = /shade|colou?r|tone|রঙ|শেড/i, SIZE = /size|ml|gram|weight|volume|pack|qty|quantity|সাইজ|ওজন/i;

async function getJ(url, tries = 3) {
  let last = 'failed';
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url, { headers: HDR });
      if (r.ok) return { j: await r.json(), pages: +r.headers.get('x-wp-totalpages') || 1 };
      last = 'HTTP ' + r.status;
      if (![403, 429, 503].includes(r.status)) break;
    } catch (e) { last = e.message; }
    await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
  }
  throw new Error(last);
}
const clean = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#8211;/g, '-').replace(/&#038;/g, '&').replace(/&#8217;/g, "'").trim();
const money = (pr, k) => { try { const v = pr[k]; if (v === undefined || v === null || v === '') return 0; return Math.round(+v / Math.pow(10, +pr.currency_minor_unit || 0) * 100) / 100; } catch (e) { return 0; } };
const MAXI = 15;
function idx(images, src) { if (!src) return 0; const i = images.indexOf(src); if (i >= 0) return i + 1; if (images.length < MAXI) { images.push(src); return images.length; } return 0; }

async function convert(p) {
  const pr = p.prices || {};
  const images = (p.images || []).map((i) => i.src).filter(Boolean);
  const cats = (p.categories || []).map((c) => clean(c.name));
  let brands = (p.brands || []).map((b) => clean(b.name));
  if (!brands.length) (p.attributes || []).forEach((a) => { if (/brand|ব্র্যান্ড/i.test(a.name || '')) brands = (a.terms || []).map((t) => clean(t.name)); });
  const out = { id: p.id, name: clean(p.name), cat: cats[0] || 'Makeup', offer: money(pr, 'price'), regular: money(pr, 'regular_price') || money(pr, 'price'), stock: 50, active: true, brand: brands[0] || '', images };
  const vl = p.variations || [];
  if (p.type === 'variable' && vl.length) {
    const rows = [];
    for (let i = 0; i < vl.length; i += 5) {
      const part = await Promise.all(vl.slice(i, i + 5).map(async (v) => {
        try {
          const { j } = await getJ(SITE + '/' + v.id, 2);
          const vp = j.prices || {}, o = money(vp, 'price');
          const attrs = {}; (v.attributes || []).forEach((a) => { attrs[clean(a.name)] = clean(a.value); });
          return { attrs, offer: o, regular: money(vp, 'regular_price') || o, src: ((j.images || [])[0] || {}).src };
        } catch (e) { return null; }
      }));
      part.filter(Boolean).forEach((r) => { r.img = idx(images, r.src); rows.push(r); });
    }
    const keys = []; rows.forEach((r) => Object.keys(r.attrs).forEach((k) => { if (!keys.includes(k)) keys.push(k); }));
    let sk = null, zk = null;
    keys.forEach((k) => { if (SHADE.test(k) && !sk) sk = k; else if (SIZE.test(k) && !zk) zk = k; });
    if (!sk && !zk && keys.length) { sk = keys[0]; zk = keys[1] || null; }
    const lab = (r, k) => (k ? r.attrs[k] || '' : '');
    const V = (name, r) => ({ name, offer: r.offer, regular: r.regular, ...(r.img ? { img: r.img } : {}) });
    const Sh = (name, r) => ({ name, color: '', ...(r.img ? { img: r.img } : {}) });
    let variants = [], shades = [];
    if (sk && zk) {
      const bs = {}; rows.forEach((r) => { const s = lab(r, zk); if (s && (!bs[s] || r.offer < bs[s].offer)) bs[s] = r; });
      variants = Object.keys(bs).filter((s) => bs[s].offer > 0).map((s) => V(s, bs[s]));
      const seen = new Set(); rows.forEach((r) => { const s = lab(r, sk); if (s && !seen.has(s)) { seen.add(s); shades.push(Sh(s, r)); } });
    } else if (zk) {
      const seen = new Set(); rows.forEach((r) => { const s = lab(r, zk); if (s && !seen.has(s) && r.offer > 0) { seen.add(s); variants.push(V(s, r)); } });
    } else if (sk) {
      const distinct = new Set(rows.map((r) => r.offer)), seen = new Set();
      rows.forEach((r) => { const s = lab(r, sk); if (!s || seen.has(s)) return; if (distinct.size > 1) { if (r.offer > 0) { seen.add(s); variants.push(V(s, r)); } } else { seen.add(s); shades.push(Sh(s, r)); } });
    }
    if (variants.length) { const m = variants.reduce((a, b) => (b.offer < a.offer ? b : a)); out.offer = m.offer; out.regular = m.regular; out.variants = variants.slice(0, 30); }
    if (shades.length) out.shades = shades.slice(0, 40);
  }
  return out;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });
  const pid = process.env.FIREBASE_PROJECT_ID;
  if (!pid) return res.status(500).json({ error: 'সার্ভারে সেটিং বসানো হয়নি' });
  try {
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = await verifyFirebase(auth, pid);
    const allow = String(process.env.ADMIN_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (allow.length && !allow.includes(String(user.email || '').toLowerCase())) return res.status(403).json({ error: 'অনুমতি নেই' });
  } catch (e) { return res.status(401).json({ error: 'লগইন যাচাই হয়নি' }); }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const page = Math.max(1, Math.floor(+body.page || 1));
  try {
    const { j, pages } = await getJ(SITE + '?per_page=8&page=' + page);
    const products = [];
    for (const p of j) { const o = await convert(p); if (o.offer > 0 || (o.variants && o.variants.length)) products.push(o); }
    return res.status(200).json({ products, pages, page });
  } catch (e) { return res.status(502).json({ error: 'ladyglamour থেকে আনা যায়নি: ' + e.message }); }
};
