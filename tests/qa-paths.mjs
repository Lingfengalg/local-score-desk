import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {fileURLToPath, pathToFileURL} from 'node:url';

export function testHtml() {
  return process.env.SCORE_TEST_HTML || fileURLToPath(new URL('../index.html', import.meta.url));
}

export async function qaDirectory(suite) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'score-' + suite + '-'));
  console.log('QA artifacts: ' + directory);
  return pathToFileURL(directory + path.sep);
}

export const browserOptions = {
  headless: true,
  ...(process.env.BROWSER_CHANNEL ? {channel: process.env.BROWSER_CHANNEL} : {})
};

export function availablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const {port} = server.address();
      server.close(() => resolve(port));
    });
  });
}
