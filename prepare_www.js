const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const WWW = path.join(ROOT, 'www');

if (!fs.existsSync(WWW)) {
    fs.mkdirSync(WWW, { recursive: true });
}

const copyList = [
    'index.html',
    'app.js',
    'boot.js',
    'style.css',
    'game_enhancements.js',
    'missions_hub.js',
    'pod.js',
    'mock_api.json'
];

for (const file of copyList) {
    const src = path.join(ROOT, file);
    const dest = path.join(WWW, file);
    if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        console.log(`Copied ${file} to www/`);
    }
}

function copyDirRecursive(srcDir, destDir) {
    if (!fs.existsSync(srcDir)) return;
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });

    for (const item of fs.readdirSync(srcDir, { withFileTypes: true })) {
        const srcPath = path.join(srcDir, item.name);
        const destPath = path.join(destDir, item.name);

        if (item.isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else {
            fs.copyFileSync(srcPath, destPath);
        }
    }
}

console.log('Copying assets/ to www/assets/...');
copyDirRecursive(path.join(ROOT, 'assets'), path.join(WWW, 'assets'));

console.log('Copying site_assets/ to www/site_assets/...');
copyDirRecursive(path.join(ROOT, 'site_assets'), path.join(WWW, 'site_assets'));

console.log('www distribution package ready.');
