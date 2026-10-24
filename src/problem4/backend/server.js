const http = require('http');

const PORT = process.env.PORT || 3000;
const VERSION = process.env.APP_VERSION || '1.0.0';

function requestHandler(req, res) {
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'UP', timestamp: new Date().toISOString(), version: VERSION }));
    return;
  }

  if (req.method === 'GET' && req.url === '/api/v1/ping') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'pong', version: VERSION }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
}

const server = http.createServer(requestHandler);

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[HTTP API] Server listening on port ${PORT} (version: ${VERSION})`);
  });

  const gracefulShutdown = (signal) => {
    console.log(`[HTTP API] Received ${signal}, closing server gracefully...`);
    server.close(() => {
      console.log('[HTTP API] Server closed successfully.');
      process.exit(0);
    });
    setTimeout(() => {
      console.error('[HTTP API] Forcefully shutting down due to timeout.');
      process.exit(1);
    }, 10000);
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}

module.exports = { server, requestHandler };
