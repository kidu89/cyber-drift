const fs = require('fs');
const content = fs.readFileSync('app.js', 'utf8');

let showIndex = content.indexOf('this.tab=f;');
if (showIndex !== -1) {
    console.log(content.slice(showIndex, showIndex + 2500));
}
