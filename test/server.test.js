import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../server.js';

test('static server serves app assets, rejects writes and keeps workspace files private', async t => {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const home = await fetch(base);
  assert.equal(home.status, 200); assert.match(await home.text(), /BenchFlow/);
  assert.match(home.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal((await fetch(`${base}/src/model.js`)).status, 200);
  assert.equal((await fetch(`${base}/.git/config`)).status, 404);
  assert.equal((await fetch(`${base}/server.js`)).status, 404);
  assert.equal((await fetch(`${base}/test/core.test.js`)).status, 404);
  assert.equal((await fetch(`${base}/src/%2e%2e%2fserver.js`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: 'POST', body: 'x' })).status, 405);
  assert.equal((await fetch(`${base}/`, { method: 'HEAD' })).status, 200);
});
