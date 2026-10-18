const fs = require('fs');
const vm = require('vm');

const content = fs.readFileSync('server.js', 'utf8');
const fixedContent = content.replace(/\\`/g, '`').replace(/\\\$/g, '$');

try {
    new vm.Script(fixedContent);
    console.log('SUCCESS: Script compiles cleanly with zero syntax errors!');
} catch (err) {
    console.error('FAILED:', err);
}
