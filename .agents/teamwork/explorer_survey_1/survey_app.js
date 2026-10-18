const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

function findMatches(pattern, max = 10) {
    let re = new RegExp(pattern, 'g');
    let matches = [];
    let m;
    while ((m = re.exec(content)) !== null && matches.length < max) {
        let start = Math.max(0, m.index - 80);
        let end = Math.min(content.length, m.index + 120);
        matches.push({ index: m.index, snippet: content.slice(start, end).replace(/\r?\n/g, ' ') });
    }
    return matches;
}

console.log('=== SEARCH RESULTS ===');
console.log('window.__sf matches:', findMatches('window\\.__sf', 15));
console.log('Mission / Quest matches:', findMatches('mission|challenge|pursuit|heat', 10));
console.log('Vehicles / hs matches:', findMatches('hs\\s*=\\s*\\{', 5));
console.log('Times of day / aa matches:', findMatches('aa\\s*=\\s*\\{', 5));
