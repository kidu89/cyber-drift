const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');
const lines = content.split('\n');

console.log('Total lines:', lines.length);
let count = 0;
lines.forEach((line, idx) => {
    if (line.includes('\\`') || line.includes('\\${')) {
        count++;
        console.log(`[#${count}] Line ${idx + 1}: ${line}`);
    }
});
