const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function walk(dir) {
    let files = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
            files = files.concat(walk(full));
        } else if (item.name.endsWith('.gz')) {
            files.push(full);
        }
    }
    return files;
}

const gzFiles = walk(path.join(__dirname, 'assets'));
console.log(`Found ${gzFiles.length} .gz files to decompress...`);

for (const gzFile of gzFiles) {
    const uncompressed = gzFile.slice(0, -3);
    if (!fs.existsSync(uncompressed)) {
        try {
            const buf = fs.readFileSync(gzFile);
            const decompressed = zlib.gunzipSync(buf);
            fs.writeFileSync(uncompressed, decompressed);
            console.log(`[Unpacked] ${path.relative(__dirname, uncompressed)} (${decompressed.length} bytes)`);
        } catch (e) {
            console.error(`[Error] Unpacking ${gzFile}: ${e.message}`);
        }
    } else {
        console.log(`[Exists] ${path.relative(__dirname, uncompressed)}`);
    }
}
console.log('Unpacking complete.');
