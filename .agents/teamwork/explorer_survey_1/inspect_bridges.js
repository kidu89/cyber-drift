const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

function findBridgeCode() {
    let re = /Golden Gate Bridge|Bay Bridge/g;
    let m;
    while ((m = re.exec(content)) !== null) {
        let start = Math.max(0, m.index - 80);
        let end = Math.min(content.length, m.index + 160);
        console.log('--- Bridge match at ' + m.index + ' ---');
        console.log(content.slice(start, end).replace(/\r?\n/g, ' '));
    }
}

findBridgeCode();
