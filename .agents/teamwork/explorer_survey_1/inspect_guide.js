const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

function inspectFn(name, maxLen = 2000) {
    let re = new RegExp(`(${name}\\s*=\\s*class|class\\s+${name})`);
    let m = re.exec(content);
    if (m) {
        console.log(`=== FOUND ${name} at index ${m.index} ===`);
        console.log(content.slice(m.index, m.index + maxLen));
    } else {
        console.log(`=== NOT FOUND: ${name} ===`);
    }
}

inspectFn('yz'); // guide
inspectFn('gz'); // da / autopilot
