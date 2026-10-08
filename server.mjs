import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');
const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const SYSTEM_INSTRUCTION = `Bạn là Nexus, trợ lý AI tư duy và ra quyết định trong Decision Simulator. Trả lời bằng tiếng Việt tự nhiên, rõ ràng, có chiều sâu nhưng phù hợp với học sinh trung học. Không quyết định thay người dùng. Khi hữu ích, giúp họ xác định mục tiêu và giá trị, nêu các lựa chọn, phân tích lợi ích/rủi ro/hệ quả ngắn hạn và dài hạn, xác định thông tin còn thiếu, đề xuất một bước nhỏ có thể thực hiện và đặt câu hỏi làm rõ. Không khẳng định lựa chọn nào chắc chắn đúng khi thiếu dữ kiện. Với nội dung nguy hiểm hoặc khủng hoảng, ưu tiên an toàn và khuyến khích tìm người lớn đáng tin cậy/chuyên gia phù hợp.`;
const buckets = new Map();

function send(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function rateLimited(ip) {
  const now = Date.now();
  const old = buckets.get(ip) || { start: now, count: 0 };
  if (now - old.start > 10 * 60 * 1000) { old.start = now; old.count = 0; }
  old.count++;
  buckets.set(ip, old);
  return old.count > 30;
}
async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 24_000) throw new Error('Nội dung gửi lên quá dài.');
  }
  try { return JSON.parse(raw || '{}'); } catch { throw new Error('Dữ liệu gửi lên không hợp lệ.'); }
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, API_KEY ? 200 : 503, { ok: Boolean(API_KEY), configured: Boolean(API_KEY), model: MODEL, error: API_KEY ? undefined : 'Máy chủ chưa được cấu hình GEMINI_API_KEY.' });
  }
  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').toString().split(',')[0].trim();
    if (rateLimited(ip)) return send(res, 429, { error: 'Bạn đã gửi quá nhiều yêu cầu. Vui lòng đợi vài phút rồi thử lại.' });
    if (!API_KEY) return send(res, 503, { error: 'Máy chủ chưa được cấu hình API key. Quản trị viên cần đặt biến GEMINI_API_KEY trong môi trường triển khai.' });
    try {
      const body = await readJson(req);
      const message = typeof body.message === 'string' ? body.message.trim().slice(0, 2000) : '';
      if (!message) return send(res, 400, { error: 'Vui lòng nhập câu hỏi.' });
      const history = Array.isArray(body.history) ? body.history.slice(-12) : [];
      const contents = history.map(item => {
        const role = item?.role === 'assistant' || item?.role === 'model' ? 'model' : 'user';
        const text = typeof item?.text === 'string' ? item.text.slice(0, 3000) : '';
        return text ? { role, parts: [{ text }] } : null;
      }).filter(Boolean);
      contents.push({ role: 'user', parts: [{ text: message }] });
      const upstream = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          contents,
          generationConfig: { temperature: 0.7, maxOutputTokens: 1200 }
        }),
        signal: AbortSignal.timeout(60_000)
      });
      const data = await upstream.json().catch(() => ({}));
      if (!upstream.ok) {
        const detail = data?.error?.message || `HTTP ${upstream.status}`;
        const status = upstream.status === 429 ? 429 : 502;
        return send(res, status, { error: `Gemini API (${upstream.status}): ${detail}` });
      }
      const answer = (data?.candidates?.[0]?.content?.parts || []).map(part => part.text || '').join('').trim();
      if (!answer) return send(res, 502, { error: 'Gemini không trả về nội dung văn bản. Hãy kiểm tra quyền mô hình, hạn mức API hoặc thử lại.' });
      return send(res, 200, { answer, model: MODEL });
    } catch (error) {
      const message = error?.name === 'TimeoutError' ? 'Yêu cầu AI quá thời gian chờ. Hãy thử lại.' : (error.message || 'Lỗi máy chủ không xác định.');
      return send(res, 500, { error: message });
    }
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Phương thức không được hỗ trợ.' });
  let file = url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname.slice(1));
  const target = path.resolve(publicDir, file);
  if (!target.startsWith(publicDir + path.sep) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Not found');
  }
  const ext = path.extname(target);
  const mime = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(target).pipe(res);
});
server.listen(PORT, () => console.log(`Decision Simulator listening on port ${PORT}`));
