const fs = require('fs');
const content = fs.readFileSync('server.js', 'utf8');
const lines = content.split('\n');

const targetLineNumbers = [63, 93, 109, 129, 137, 140, 145];
targetLineNumbers.forEach(num => {
    const line = lines[num - 1];
    console.log(`=== Line ${num} ===`);
    console.log('Original:', JSON.stringify(line));
    // Test replacement of \` and \${
    const cleaned = line.replace(/\\`/g, '`').replace(/\\\$/g, '$');
    console.log('Cleaned: ', JSON.stringify(cleaned));
});
