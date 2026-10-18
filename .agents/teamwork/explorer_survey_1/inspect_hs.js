const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

let hsIndex = content.indexOf('var hs={');
if (hsIndex !== -1) {
    console.log(content.slice(hsIndex, hsIndex + 4000));
}
