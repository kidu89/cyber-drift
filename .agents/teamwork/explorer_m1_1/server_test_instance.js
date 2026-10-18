const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec } = require('child_process');

const DEFAULT_PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const ROOT = path.resolve(__dirname, '../../..');

const MIME_TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.wasm': 'application/wasm',
    '.glb': 'model/gltf-binary',
    '.gltf': 'model/gltf+json',
    '.mp3': 'audio/mpeg',
    '.wav': 'audio/wav',
    '.ogg': 'audio/ogg',
    '.webp': 'image/webp',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.ttf': 'font/ttf',
    '.bin': 'application/octet-stream',
    '.gz': 'application/octet-stream'
};

let mockDb = [];
try {
    const mockFile = path.join(ROOT, 'mock_api.json');
    if (fs.existsSync(mockFile)) {
        mockDb = JSON.parse(fs.readFileSync(mockFile, 'utf8'));
    }
} catch (e) {}

const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const parsedUrl = url.parse(req.url);
    let pathname = decodeURIComponent(parsedUrl.pathname);

    if (pathname.includes('/api/') || pathname.includes('graphql') || pathname.includes('/events')) {
        const match = mockDb.find(call => call.url && call.url.includes(pathname) && call.method === req.method);
        if (match) {
            console.log(`[Architect] Mocking ${req.method} ${pathname}`);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(match.response));
            return;
        }
    }

    if (pathname === '/' || pathname === '') {
        pathname = '/index.html';
    }

    let filePath = path.join(ROOT, pathname);

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        const siteAssetsPath = path.join(ROOT, 'site_assets', pathname);
        if (fs.existsSync(siteAssetsPath) && !fs.statSync(siteAssetsPath).isDirectory()) {
            filePath = siteAssetsPath;
        } else if (fs.existsSync(filePath + '.gz')) {
            filePath = filePath + '.gz';
        } else if (fs.existsSync(siteAssetsPath + '.gz')) {
            filePath = siteAssetsPath + '.gz';
        } else if (fs.existsSync(filePath + '.html')) {
            filePath = filePath + '.html';
        } else if (!path.extname(pathname)) {
            filePath = path.join(ROOT, 'index.html');
        }
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`404 Not Found: ${pathname}`);
        return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(filePath);

    const range = req.headers.range;
    if (range && (ext === '.mp3' || ext === '.ogg' || ext === '.wav')) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
        const chunksize = (end - start) + 1;
        const file = fs.createReadStream(filePath, { start, end });
        res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': contentType,
        });
        file.pipe(res);
        return;
    }

    res.writeHead(200, {
        'Content-Type': contentType,
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
});

function startServer(port) {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`Port ${port} is in use, trying ${port + 1}...`);
            startServer(port + 1);
        } else {
            console.error('Server error:', err);
        }
    });

    server.listen(port, () => {
        const gameUrl = `http://localhost:${port}`;
        console.log('====================================================');
        console.log('  [WebPulls] Local Server Running');
        console.log(`  URL: ${gameUrl}`);
        console.log('  Press Ctrl+C to stop the server');
        console.log('====================================================');

        const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
        exec(`${startCmd} ${gameUrl}`);
    });
}

startServer(DEFAULT_PORT);