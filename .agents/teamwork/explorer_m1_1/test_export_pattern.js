const http = require('http');

const server = http.createServer((req, res) => {});
function startServer() {}
const MIME_TYPES = { '.html': 'text/html' };

module.exports = server;
server.server = server;
server.startServer = startServer;
server.MIME_TYPES = MIME_TYPES;

const importedDirect = module.exports;
const { server: importedServer, startServer: importedStart, MIME_TYPES: importedMime } = module.exports;

console.log('importedDirect === server:', importedDirect === server);
console.log('importedServer === server:', importedServer === server);
console.log('importedStart === startServer:', importedStart === startServer);
console.log('importedMime === MIME_TYPES:', importedMime === MIME_TYPES);
