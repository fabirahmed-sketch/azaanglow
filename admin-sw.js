// Azaan Admin — ইনস্টলযোগ্য অ্যাপের জন্য ছোট service worker।
// কোনো ফাইল ক্যাশ করে না (যাতে অ্যাডমিন সবসময় সর্বশেষ কোডে চলে), শুধু অফলাইনে একটা বার্তা দেখায়।
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.mode !== 'navigate' || u.origin !== location.origin || !u.pathname.startsWith('/admin')) return;
  e.respondWith(fetch(e.request).catch(() => new Response('<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font-family:sans-serif;text-align:center;padding:3rem 1rem"><h2>ইন্টারনেট নেই</h2><p>নেট চালু করে আবার খুলুন।</p>', { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } })));
});
