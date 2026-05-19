const fs = require('fs');

// Try importing each module with a catch block
const modules = [
  { name: 'db.js', path: './config/db.js' },
  { name: 'passport.js', path: './config/passport.js' },
  { name: 'requestLogger.js', path: './modules/logging/middleware/requestLogger.js' },
  { name: 'errorLogger.js', path: './modules/logging/middleware/errorLogger.js' },
  { name: 'notificationSocket.js', path: './websocket/notificationSocket.js' },
  { name: 'canvasSocket.js', path: './websocket/canvasSocket.js' }
];

modules.forEach(({ name, path }) => {
  console.log(`=== Trying to import ${name} ===`);
  import(path).catch(e => {
    console.log(`${name} error:`, e.message || e.toString());
  });
});

// Also try the main server.js
import('./server.js').catch(e => {
  console.log('server.js error:', e.message || e.toString());
});

