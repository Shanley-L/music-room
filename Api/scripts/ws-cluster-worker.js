import http from 'http';
import { createIo } from '../src/socket/index.js';

const port = process.env.WORKER_PORT || 3999;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('worker');
});

async function main() {
  await createIo(server);

  server.listen(port, '0.0.0.0', () => {
    if (process.send) process.send({ type: 'ready', port });
  });
}

main().catch((err) => {
  console.error('worker failed', err);
  process.exit(1);
});
