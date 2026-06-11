// server.js — Hỗ trợ chạy local và Vercel (chỉ dùng built-in Node.js)
const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

// Xác định môi trường chạy
const isVercel  = process.env.VERCEL === '1' || process.env.VERCEL_ENV;
const PORT      = process.env.PORT || 3000;

const PUBLIC    = path.join(__dirname, 'public');

// Vercel chỉ cho phép ghi vào /tmp, ở local giữ nguyên cấu trúc
const DATA_DIR   = isVercel ? '/tmp/data' : path.join(__dirname, 'data');
const UPLOAD_DIR = isVercel ? '/tmp/uploads' : path.join(__dirname, 'public', 'uploads');
const DATA_FILE  = path.join(DATA_DIR, 'wishes.json');

// Đảm bảo thư mục tồn tại
if (!fs.existsSync(UPLOAD_DIR))  fs.mkdirSync(UPLOAD_DIR,  { recursive: true });
if (!fs.existsSync(DATA_DIR))    fs.mkdirSync(DATA_DIR,    { recursive: true });
if (!fs.existsSync(DATA_FILE))   fs.writeFileSync(DATA_FILE, '[]');

// MIME types
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.ico':  'image/x-icon',
};

// Đọc wishes
function readWishes() {
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch(e) { return []; }
}

// Ghi wishes
function writeWishes(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// Parse multipart/form-data
function parseMultipart(buffer, boundary) {
  const fields = {};
  const files  = {};
  const sep    = Buffer.from('--' + boundary);
  const parts  = [];

  let start = 0;
  let limit = 0; // Fail-safe: Chống vòng lặp vô hạn
  while (start < buffer.length && limit < 1000) {
    limit++;
    const idx = buffer.indexOf(sep, start);
    if (idx === -1) break;
    const end = buffer.indexOf(sep, idx + sep.length);
    if (end === -1) break;

    // Đảm bảo con trỏ luôn tiến lên
    if (end <= start) break;

    const part = buffer.slice(idx + sep.length + 2, end - 2);
    parts.push(part);
    start = end;
  }

  parts.forEach(part => {
    const headerEnd = part.indexOf('\r\n\r\n');
    if (headerEnd === -1) return;
    const headerStr = part.slice(0, headerEnd).toString();
    const body      = part.slice(headerEnd + 4);

    const nameMatch     = headerStr.match(/name="([^"]+)"/);
    const filenameMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch       = headerStr.match(/Content-Type:\s*(\S+)/i);

    if (!nameMatch) return;
    const fieldName = nameMatch[1];

    if (filenameMatch) {
      files[fieldName] = {
        filename: filenameMatch[1],
        contentType: ctMatch ? ctMatch[1] : 'application/octet-stream',
        data: body,
      };
    } else {
      fields[fieldName] = body.toString('utf8').trim();
    }
  });

  return { fields, files };
}

// Server
const server = http.createServer((req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');

  // ── GET /api ──────────────────────────────────────────────────
  if (req.method === 'GET' && pathname === '/api') {
    const wishes = readWishes();
    const safe   = wishes.map(w => ({
      id:    w.id,
      name:  w.name,
      wish:  w.wish,
      photo: w.photo,
      time:  w.time,
    })).sort((a, b) => b.time.localeCompare(a.time));

    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ wishes: safe, total: safe.length }));
    return;
  }

  // ── POST /submit ──────────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/submit') {
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
      const buffer      = Buffer.concat(body);
      const contentType = req.headers['content-type'] || '';
      const boundaryMatch = contentType.match(/boundary=(.+)$/);

      if (!boundaryMatch) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Bad request' }));
        return;
      }

      const { fields, files } = parseMultipart(buffer, boundaryMatch[1]);
      const name  = (fields.name  || '').trim();
      const phone = (fields.phone || '').trim();
      const wish  = (fields.wish  || '').trim();

      if (!name || !wish) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Thiếu họ tên hoặc điều ước' }));
        return;
      }

      // Lưu ảnh
      let photoUrl = '';
      if (files.photo && files.photo.data.length > 0) {
        const ext      = path.extname(files.photo.filename) || '.jpg';
        const filename = 'photo_' + Date.now() + '_' + Math.random().toString(36).slice(2) + ext;
        const dest     = path.join(UPLOAD_DIR, filename);
        fs.writeFileSync(dest, files.photo.data);
        // Dùng đường dẫn tương đối thay vì hardcode localhost để chạy tốt trên môi trường deploy
        photoUrl = '/uploads/' + filename;
      }

      const newWish = {
        id:    Date.now().toString(36) + Math.random().toString(36).slice(2),
        name:  name.slice(0, 100),
        phone: phone.slice(0, 20),
        wish:  wish.slice(0, 300),
        photo: photoUrl,
        time:  new Date().toISOString(),
      };

      const wishes = readWishes();
      wishes.push(newWish);
      if (wishes.length > 500) wishes.splice(0, wishes.length - 500);
      writeWishes(wishes);

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        success: true,
        id:    newWish.id,
        name:  newWish.name,
        wish:  newWish.wish,
        photo: newWish.photo,
      }));
    });
    return;
  }

  // ── GET /uploads ──────────────────────────────────────────────
  // Phục vụ ảnh động từ thư mục tương ứng
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    const filename = pathname.replace('/uploads/', '');
    const filePath = path.join(UPLOAD_DIR, filename);

    // Bảo vệ path traversal
    if (!filePath.startsWith(UPLOAD_DIR)) {
        res.writeHead(403); res.end('Forbidden'); return;
    }

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('404 Not Found: ' + pathname);
            return;
        }
        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
    });
    return;
  }

  // ── Static files ──────────────────────────────────────────────
  let filePath = path.join(PUBLIC, pathname === '/' ? 'index.html' : pathname);

  // Bảo vệ path traversal
  if (!filePath.startsWith(PUBLIC)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('404 Not Found: ' + pathname);
      return;
    }
    const ext  = path.extname(filePath).toLowerCase();
    const mime = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(data);
  });
});

// Xuất server cho Vercel hoặc chạy trực tiếp trên Local
if (isVercel) {
  module.exports = (req, res) => {
    server.emit('request', req, res);
  };
} else {
  server.listen(PORT, () => {
    console.log('');
    console.log('  🎆 Ước Nguyện Pháo Hoa đang chạy!');
    console.log('');
    console.log('  📱 Trang form: http://localhost:' + PORT + '/');
    console.log('  🎇 Màn hình LED: http://localhost:' + PORT + '/show.html');
    console.log('');
    console.log('  Nhấn Ctrl+C để dừng server');
    console.log('');
  });
}
