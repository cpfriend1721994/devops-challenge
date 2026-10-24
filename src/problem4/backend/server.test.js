const { test, expect } = require('bun:test');
const { requestHandler } = require('./server');

function mockRes() {
  return {
    statusCode: null,
    headers: {},
    body: '',
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers;
    },
    end(payload) {
      this.body = payload;
    }
  };
}

test('GET /health returns 200 with UP status', () => {
  const req = { method: 'GET', url: '/health' };
  const res = mockRes();
  requestHandler(req, res);
  expect(res.statusCode).toBe(200);
  const data = JSON.parse(res.body);
  expect(data.status).toBe('UP');
});

test('GET /api/v1/ping returns pong message', () => {
  const req = { method: 'GET', url: '/api/v1/ping' };
  const res = mockRes();
  requestHandler(req, res);
  expect(res.statusCode).toBe(200);
  const data = JSON.parse(res.body);
  expect(data.message).toBe('pong');
});

test('GET /unknown returns 404 Not Found', () => {
  const req = { method: 'GET', url: '/unknown' };
  const res = mockRes();
  requestHandler(req, res);
  expect(res.statusCode).toBe(404);
});
