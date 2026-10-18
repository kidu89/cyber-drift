const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

function findDeclaration(name) {
    let re = new RegExp(`(${name}\\s*=\\s*class|class\\s+${name})`);
    let m = re.exec(content);
    if (m) {
        console.log(`=== FOUND ${name} at index ${m.index} ===`);
        console.log(content.slice(m.index, m.index + 1500));
    } else {
        // Search where it's assigned
        let re2 = new RegExp(`\\b${name}\\s*=`);
        let m2 = re2.exec(content);
        if (m2) {
            console.log(`=== FOUND ASSIGNMENT ${name} at index ${m2.index} ===`);
            console.log(content.slice(m2.index - 50, m2.index + 500));
        } else {
            console.log(`=== NOT FOUND: ${name} ===`);
        }
    }
}

findDeclaration('sE');
findDeclaration('gE');
findDeclaration('lE'); // taxi
findDeclaration('W_'); // tele
