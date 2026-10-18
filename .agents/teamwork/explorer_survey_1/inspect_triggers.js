const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

function searchRefs(term) {
    let re = new RegExp(term, 'g');
    let m;
    let results = [];
    while ((m = re.exec(content)) !== null && results.length < 10) {
        let start = Math.max(0, m.index - 100);
        let end = Math.min(content.length, m.index + 150);
        results.push(content.slice(start, end).replace(/\r?\n/g, ' '));
    }
    return results;
}

console.log('=== raceChip ===', searchRefs('raceChip'));
console.log('=== challenges on ===', searchRefs('challenges\\.'));
console.log('=== police trigger ===', searchRefs('vo\\.pursuit|vo\\.start|vo\\.dispatch'));
console.log('=== pause menu tabs ===', searchRefs('data-tab="'));
