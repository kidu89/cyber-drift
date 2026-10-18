const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

let aaIndex = content.indexOf('var aa={');
if (aaIndex !== -1) {
    console.log(content.slice(aaIndex, aaIndex + 3000));
}
