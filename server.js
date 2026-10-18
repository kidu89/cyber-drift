const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const url = require('url');
const { exec } = require('child_process');

function getCliPort() {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg === '--port' || arg === '-p') {
            const next = parseInt(args[i + 1], 10);
            if (!isNaN(next) && next > 0) return next;
            i++;
        } else if (arg.startsWith('--port=')) {
            const val = parseInt(arg.split('=')[1], 10);
            if (!isNaN(val) && val > 0) return val;
        } else if (/^\d+$/.test(arg)) {
            const val = parseInt(arg, 10);
            if (!isNaN(val) && val > 0) return val;
        }
    }
    if (process.env.PORT) {
        const envPort = parseInt(process.env.PORT, 10);
        if (!isNaN(envPort) && envPort > 0) return envPort;
    }
    return 3000;
}

const DEFAULT_PORT = getCliPort();
const ROOT = process.env.SF_ROOT || __dirname;

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
    '.gz': 'application/octet-stream',
    '.webmanifest': 'application/manifest+json'
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

    let pathname;
    try {
        const parsedUrl = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
        pathname = decodeURIComponent(parsedUrl.pathname || '/');
    } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('400 Bad Request: Malformed URI');
        return;
    }

    if (req.url.includes('..') || pathname.includes('..')) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

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

    const safePath = path.normalize(path.join(ROOT, pathname));
    const rootNorm = path.normalize(ROOT);
    const isContained = safePath.toLowerCase() === rootNorm.toLowerCase() ||
                        safePath.toLowerCase().startsWith(rootNorm.toLowerCase() + path.sep);
    if (!isContained) {
        res.writeHead(403, { 'Content-Type': 'text/plain' });
        res.end('403 Forbidden');
        return;
    }

    let filePath = safePath;

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
        return proxyAndCache(pathname, safePath, req, res);
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(filePath);

    const range = req.headers.range;
    if (range && (ext === '.mp3' || ext === '.ogg' || ext === '.wav')) {
        const send416 = () => {
            if (!res.headersSent) {
                res.writeHead(416, {
                    'Content-Range': `bytes */${stat.size}`,
                    'Content-Type': contentType
                });
                res.end();
            }
        };

        const rangeStr = Array.isArray(range) ? range[0] : range;
        const rangeMatch = typeof rangeStr === 'string' && rangeStr.trim().match(/^bytes\s*=\s*(\d+)?\s*-\s*(\d+)?$/);

        if (!rangeMatch || (!rangeMatch[1] && !rangeMatch[2]) || stat.size === 0) {
            send416();
            return;
        }

        let start;
        let end;

        if (rangeMatch[1] === undefined) {
            // Suffix byte range: bytes=-<suffixLength>
            const suffixLength = parseInt(rangeMatch[2], 10);
            if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
                send416();
                return;
            }
            start = suffixLength >= stat.size ? 0 : stat.size - suffixLength;
            end = stat.size - 1;
        } else if (rangeMatch[2] === undefined) {
            // Open-ended byte range: bytes=<start>-
            start = parseInt(rangeMatch[1], 10);
            if (!Number.isSafeInteger(start) || start >= stat.size) {
                send416();
                return;
            }
            end = stat.size - 1;
        } else {
            // Explicit byte range: bytes=<start>-<end>
            start = parseInt(rangeMatch[1], 10);
            end = parseInt(rangeMatch[2], 10);
            if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= stat.size) {
                send416();
                return;
            }
            if (end >= stat.size) {
                end = stat.size - 1;
            }
        }

        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
            send416();
            return;
        }

        const chunksize = (end - start) + 1;
        let file;
        try {
            file = fs.createReadStream(filePath, { start, end });
        } catch (streamErr) {
            if (!res.headersSent) {
                if (streamErr.code === 'ERR_OUT_OF_RANGE') {
                    send416();
                } else {
                    res.writeHead(500, { 'Content-Type': 'text/plain' });
                    res.end('500 Internal Server Error');
                }
            }
            return;
        }

        file.on('error', () => {
            if (!res.headersSent) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('500 Internal Server Error');
            }
        });

        res.on('close', () => {
            file.destroy();
        });

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
    const stream = fs.createReadStream(filePath);
    stream.on('error', () => {
        if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
            res.end('500 Internal Server Error');
        }
    });
    stream.pipe(res);
});

function proxyAndCache(pathname, safePath, req, res) {
    const remoteUrl = 'https://teleoperator.mindblown.ai' + pathname;
    const reqOptions = {
        agent: false,
        timeout: 4000,
        headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    };

    https.get(remoteUrl, reqOptions, (upstreamRes) => {
        if (upstreamRes.statusCode === 200) {
            console.log(`[Proxy-Cache] 200 OK from upstream: ${pathname} -> saving locally`);
            try {
                fs.mkdirSync(path.dirname(safePath), { recursive: true });
                const fileOut = fs.createWriteStream(safePath);
                upstreamRes.pipe(fileOut);
            } catch (err) {
                console.error(`[Proxy-Cache] Cache write error for ${pathname}:`, err.message);
            }

            const ext = path.extname(safePath).toLowerCase();
            const contentType = MIME_TYPES[ext] || upstreamRes.headers['content-type'] || 'application/octet-stream';
            res.writeHead(200, {
                'Content-Type': contentType,
                'Content-Length': upstreamRes.headers['content-length'] || undefined,
                'Accept-Ranges': 'bytes'
            });
            upstreamRes.pipe(res);
            return;
        }

        // Try .gz variant if not already .gz
        if (!pathname.endsWith('.gz') && /\.(bin|glb|gltf|hdr|json)$/.test(pathname)) {
            const gzUrl = remoteUrl + '.gz';
            const gzSafePath = safePath + '.gz';
            return https.get(gzUrl, reqOptions, (gzRes) => {
                if (gzRes.statusCode === 200) {
                    console.log(`[Proxy-Cache] 200 OK from upstream gz: ${pathname}.gz -> saving locally`);
                    try {
                        fs.mkdirSync(path.dirname(gzSafePath), { recursive: true });
                        const fileOut = fs.createWriteStream(gzSafePath);
                        gzRes.pipe(fileOut);
                    } catch (err) {}

                    res.writeHead(200, {
                        'Content-Type': 'application/octet-stream',
                        'Content-Length': gzRes.headers['content-length'] || undefined,
                        'Accept-Ranges': 'bytes'
                    });
                    gzRes.pipe(res);
                    return;
                }

                console.warn(`[404 Not Found] ${pathname}`);
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end(`404 Not Found: ${pathname}`);
            }).on('error', () => {
                res.writeHead(404, { 'Content-Type': 'text/plain' });
                res.end(`404 Not Found: ${pathname}`);
            });
        }

        console.warn(`[404 Not Found] ${pathname}`);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`404 Not Found: ${pathname}`);
    }).on('error', (err) => {
        console.warn(`[404 Remote Error] ${pathname}:`, err.message);
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`404 Not Found: ${pathname}`);
    });
}

function startServer(port = DEFAULT_PORT) {
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

        const noOpen = process.env.NO_OPEN === '1' || process.env.NO_OPEN === 'true' || process.argv.includes('--no-open');
        if (!noOpen) {
            const startCmd = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
            exec(`${startCmd} ${gameUrl}`);
        }
    });
}

if (require.main === module) {
    startServer(DEFAULT_PORT);
}

module.exports = server;
server.server = server;
server.startServer = startServer;
server.MIME_TYPES = MIME_TYPES;
server.DEFAULT_PORT = DEFAULT_PORT;