const fs = require('fs');
const app = fs.readFileSync('app.js', 'utf8');

// Check guide properties
const p = app.indexOf('xc=new yz(Yt)');
console.log('xc=new yz:\n', app.slice(p, p + 200));

// Check guide class fields
const p2 = app.indexOf('this.mesh=new _e');
console.log('this.mesh=new _e:\n', app.slice(p2, p2 + 200));
