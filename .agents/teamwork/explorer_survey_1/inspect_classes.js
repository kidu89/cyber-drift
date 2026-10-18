const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

function inspectFn(name, maxLen = 2000) {
    let re = new RegExp('(function\\s+' + name + '\\b|var\\s+' + name + '\\s*=\\s*(class|function))');
    let m = re.exec(content);
    if (m) {
        console.log(`=== FOUND ${name} at index ${m.index} ===`);
        console.log(content.slice(m.index, m.index + maxLen));
    } else {
        console.log(`=== NOT FOUND: ${name} ===`);
    }
}

inspectFn('Hst'); // challenges
inspectFn('sE');  // race system
inspectFn('gE');  // police pursuit system
inspectFn('Kx');  // skills / drift chain
inspectFn('NE');  // pause menu
