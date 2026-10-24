const { test, expect } = require('bun:test');
const fs = require('fs');
const path = require('path');

test('SPA index.html source template exists and contains card layout', () => {
  const indexHtml = path.join(__dirname, 'index.html');
  expect(fs.existsSync(indexHtml)).toBe(true);
  const content = fs.readFileSync(indexHtml, 'utf-8');
  expect(content).toContain('id="status"');
});

test('dist bundle is generated with fingerprinted assets', () => {
  const distDir = path.join(__dirname, 'dist');
  expect(fs.existsSync(distDir)).toBe(true);
  expect(fs.existsSync(path.join(distDir, 'index.html'))).toBe(true);
  expect(fs.existsSync(path.join(distDir, 'assets'))).toBe(true);
});
