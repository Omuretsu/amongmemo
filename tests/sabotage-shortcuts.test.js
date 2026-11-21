const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(script, /'Digit1':'停電','Digit2':'コミュニケーション','Digit3':'リアクター'/);
assert.match(script, /event\.metaKey&&event\.shiftKey\?'other':event\.shiftKey\?'occurred':'self'/);
assert.match(script, /event\.metaKey && !event\.shiftKey/);
assert.match(html, /1：停電/);
assert.match(html, /2：コミュニケーション/);
assert.match(html, /3：リアクター/);

console.log('Sabotage shortcuts: ok');
