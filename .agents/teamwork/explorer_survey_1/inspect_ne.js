const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

let neIndex = content.indexOf('var NE=class{');
if (neIndex !== -1) {
    console.log(content.slice(neIndex, neIndex + 4000));
}
