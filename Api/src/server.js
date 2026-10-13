import http from 'http';
import app from './app.js';
import { initRealtime, closeRealtime } from './lib/realtime.js';

const port = process.env.PORT || 3000;

const server = http.createServer(app);
await initRealtime(server);

server.listen(port, () => {
  console.log(`API listening on http://localhost:${port}`);
  console.log(`Documentation Swagger disponible sur http://localhost:${port}/api-docs`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    console.log(`[Server] ${signal} received, closing`);
    // Do not hang on lingering connections.
    setTimeout(() => process.exit(0), 5000).unref();
    try {
      await closeRealtime();
    } finally {
      process.exit(0);
    }
  });
}
