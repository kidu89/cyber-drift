const fs = require('fs');
const path = require('path');

const code = fs.readFileSync('app.js', 'utf8');
const regex = /['"]([a-zA-Z0-9_\-\.\/]+\.(?:bin|glb|gltf|webp|png|jpg|jpeg|mp3|wav|ogg|wasm|json|gz))['"]/g;
let match;
const set = new Set();
while ((match = regex.exec(code)) !== null) {
    set.add(match[1]);
}
console.log('Found ' + set.size + ' unique asset references in app.js');

const missing = [];
for (const item of set) {
    let p = item;
    if (p.startsWith('/')) p = p.slice(1);
    const exists = fs.existsSync(p) || 
                   fs.existsSync(p + '.gz') || 
                   fs.existsSync('site_assets/' + p) || 
                   fs.existsSync('site_assets/' + p + '.gz');
    if (!exists) {
        missing.push(item);
    }
}

console.log('Missing files referenced in app.js (' + missing.length + '):');
for (const m of missing) {
    console.log('-', m);
}
