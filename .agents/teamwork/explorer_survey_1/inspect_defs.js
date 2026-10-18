const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

function snippetAt(index, before = 50, after = 500) {
    return content.slice(Math.max(0, index - before), Math.min(content.length, index + after));
}

console.log('--- VEHICLES (hs) ---');
console.log(snippetAt(3145424, 20, 1200));

console.log('--- TIMES OF DAY / PRESETS (aa) ---');
console.log(snippetAt(3958470, 20, 1200));
