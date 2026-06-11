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
      phone: w.phone, // <--- Cập nhật: Cho phép API trả về số điện thoại
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

  // ── API XÓA BẰNG ID ───────────────────────────────────────────
  if (req.method === 'POST' && pathname === '/delete') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body);
        let wishes = readWishes();
        const initialLength = wishes.length;
        
        wishes = wishes.filter(w => w.id !== id);
        
        if (wishes.length < initialLength) {
          writeWishes(wishes);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Không tìm thấy dữ liệu' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Lỗi xử lý yêu cầu' }));
      }
    });
    return;
  }

  // ── TRANG ADMIN QUẢN LÝ TÍCH HỢP SẴN ───────────────────────────
  if (req.method === 'GET' && pathname === '/admin') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <!DOCTYPE html>
      <html lang="vi">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Quản Trị Pháo Hoa</title>
        <style>
          body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f4f7f6; padding: 20px; }
          .container { max-width: 1100px; margin: auto; background: white; padding: 20px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); }
          .header-flex { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #007bff; padding-bottom: 10px; margin-bottom: 20px; }
          h2 { color: #333; margin: 0; }
          table { width: 100%; border-collapse: collapse; margin-top: 10px; }
          th, td { border: 1px solid #ddd; padding: 12px; text-align: left; vertical-align: middle; }
          th { background-color: #007bff; color: white; }
          .btn-delete { background: #dc3545; color: white; border: none; padding: 8px 12px; border-radius: 4px; cursor: pointer; font-weight: bold; }
          .btn-delete:hover { background: #c82333; }
          .btn-export { background: #28a745; color: white; border: none; padding: 10px 15px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 14px; }
          .btn-export:hover { background: #218838; }
          .img-preview { max-height: 60px; border-radius: 4px; cursor: pointer; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header-flex">
            <h2>⚙️ Bảng Điều Khiển Lời Chúc</h2>
            <button class="btn-export" onclick="exportToExcel()">📊 Xuất File Excel</button>
          </div>
          <p>Danh sách chi tiết các lời chúc đang hiển thị trên màn hình LED.</p>
          <table>
            <thead>
              <tr>
                <th>Họ và Tên</th>
                <th>SĐT</th>
                <th style="width: 40%">Điều ước</th>
                <th>Hình ảnh</th>
                <th>Thời gian gửi</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody id="wish-list">
              <tr><td colspan="6" style="text-align:center;">Đang tải dữ liệu...</td></tr>
            </tbody>
          </table>
        </div>
        <script>
          let currentData = [];

          async function loadWishes() {
            try {
              const res = await fetch('/api');
              const data = await res.json();
              currentData = data.wishes;
              const list = document.getElementById('wish-list');
              
              if (currentData.length === 0) {
                list.innerHTML = '<tr><td colspan="6" style="text-align:center;">Chưa có dữ liệu nào.</td></tr>';
                return;
              }

              list.innerHTML = currentData.map(w => {
                let imgHtml = w.photo ? '<a href="' + w.photo + '" target="_blank"><img class="img-preview" src="' + w.photo + '" alt="Ảnh"></a>' : '<span style="color:#999; font-size:13px">Không có</span>';
                let phoneText = w.phone ? w.phone : '<span style="color:#999; font-size:13px">Trống</span>';
                
                return '<tr>' +
                  '<td><b>' + w.name + '</b></td>' +
                  '<td>' + phoneText + '</td>' +
                  '<td>' + w.wish + '</td>' +
                  '<td style="text-align:center;">' + imgHtml + '</td>' +
                  '<td>' + new Date(w.time).toLocaleString('vi-VN') + '</td>' +
                  '<td><button class="btn-delete" onclick="deleteWish(\\'' + w.id + '\\')">🗑 Xóa</button></td>' +
                '</tr>';
              }).join('');
            } catch (err) {
              alert('Lỗi khi tải dữ liệu!');
            }
          }

          async function deleteWish(id) {
            if (!confirm('Bạn có chắc chắn muốn xóa lời chúc này không? Hành động này không thể hoàn tác.')) return;
            try {
              const res = await fetch('/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
              });
              const result = await res.json();
              if (result.success) loadWishes(); 
              else alert('Lỗi: ' + result.error);
            } catch (err) {
              alert('Không thể kết nối đến máy chủ.');
            }
          }

          function exportToExcel() {
            if (currentData.length === 0) {
              alert('Không có dữ liệu để xuất!');
              return;
            }

            // Dùng BOM (\\uFEFF) để báo cho Excel biết đây là file UTF-8, giúp Tiếng Việt không bị lỗi
            let csvContent = "\\uFEFFHọ và Tên,Số điện thoại,Điều ước,Hình ảnh (Link),Thời gian gửi\\n";
            
            currentData.forEach(w => {
              // Bao bọc chuỗi trong dấu ngoặc kép và escape các dấu ngoặc kép bên trong để tránh vỡ cột CSV
              let name = '"' + (w.name || '').replace(/"/g, '""') + '"';
              let phone = '"' + (w.phone || '').replace(/"/g, '""') + '"';
              let wish = '"' + (w.wish || '').replace(/"/g, '""') + '"';
              let photo = w.photo ? '"' + window.location.origin + w.photo + '"' : '"Không có"';
              let time = '"' + new Date(w.time).toLocaleString('vi-VN') + '"';
              
              csvContent += name + ',' + phone + ',' + wish + ',' + photo + ',' + time + '\\n';
            });

            // Tạo và tải xuống file CSV
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.setAttribute("href", url);
            link.setAttribute("download", "DanhSachLoiChuc_PhaoHoa.csv");
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }

          // Khởi chạy khi mở trang
          loadWishes();
        </script>
      </body>
      </html>
    `);
    return;
  }

  // ── GET /uploads ──────────────────────────────────────────────
  if (req.method === 'GET' && pathname.startsWith('/uploads/')) {
    const filename = pathname.replace('/uploads/', '');
    const filePath = path.join(UPLOAD_DIR, filename);

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
    console.log('  ⚙️  Trang Quản trị: http://localhost:' + PORT + '/admin');
    console.log('');
    console.log('  Nhấn Ctrl+C để dừng server');
    console.log('');
  });
}
