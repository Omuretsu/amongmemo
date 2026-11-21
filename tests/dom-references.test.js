'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const referencedIds = [...script.matchAll(/\$\('#([^']+)'\)/g)].map(match => match[1]);
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]));
const missingIds = [...new Set(referencedIds)].filter(id => !htmlIds.has(id));

assert.deepEqual(missingIds, []);
assert.doesNotMatch(html, /data-roster-(?:player|host)[^>]*type="(?:checkbox|radio)"/);
assert.match(script, /event\.key==='4'/);
console.log(`DOM references: ok (${new Set(referencedIds).size} ids)`);
