const fs = require('fs');
const path = require('path');

function removeDuplicateGz(dir) {
    if (!fs.existsSync(dir)) return;
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) {
            removeDuplicateGz(full);
        } else if (item.name.endsWith('.gz')) {
            const base = full.slice(0, -3);
            if (fs.existsSync(base)) {
                fs.unlinkSync(full);
                console.log(`Removed duplicate .gz: ${path.relative(__dirname, full)}`);
            }
        }
    }
}

removeDuplicateGz(path.join(__dirname, 'www'));
removeDuplicateGz(path.join(__dirname, 'android', 'app', 'src', 'main', 'assets', 'public'));
console.log('Cleanup of duplicate .gz complete.');
