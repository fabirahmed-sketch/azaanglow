const tg = async (token, method, params) => {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) throw new Error(d.description || method + ' failed');
  return d;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ ok: false });
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return res.status(500).json({ ok: false, error: 'not configured' });

  const origin = req.headers.origin || '';
  if (origin && !origin.includes(req.headers.host || '@@')) return res.status(403).json({ ok: false });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const text = String(body.text || '').slice(0, 3800);
  if (!text.startsWith('🛍️')) return res.status(400).json({ ok: false, error: 'bad payload' });
  const photos = (Array.isArray(body.photos) ? body.photos : [])
    .filter((p) => p && typeof p.url === 'string' && /^https:\/\//.test(p.url) && p.url.length < 600)
    .slice(0, 10)
    .map((p) => ({ url: p.url, caption: String(p.caption || '').slice(0, 200) }));

  try {
    await tg(token, 'sendMessage', { chat_id: chat, text });
  } catch (e) {
    return res.status(502).json({ ok: false, error: e.message });
  }
  let photosSent = false;
  if (photos.length) {
    try {
      if (photos.length === 1) await tg(token, 'sendPhoto', { chat_id: chat, photo: photos[0].url, caption: photos[0].caption });
      else await tg(token, 'sendMediaGroup', { chat_id: chat, media: photos.map((p) => ({ type: 'photo', media: p.url, caption: p.caption })) });
      photosSent = true;
    } catch (e) {}
  }
  return res.status(200).json({ ok: true, photosSent });
};
