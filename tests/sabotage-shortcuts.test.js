const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const script = fs.readFileSync(path.join(root, 'js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert.match(script, /'Digit1':'停電','Digit2':'コミュニケーション','Digit3':'リアクター'/);
assert.match(script, /event\.metaKey&&event\.shiftKey\?'other':event\.shiftKey\?'occurred':'self'/);
assert.match(script, /event\.metaKey && !event\.shiftKey/);
assert.match(script, /event\.code==='Digit4'/);
assert.match(script, /quickMeetingEvent\('button',event\.shiftKey\?'other':'self'\)/);
assert.match(script, /event\.code==='Digit5'/);
assert.match(script, /quickMeetingEvent\('report',event\.shiftKey\?'other':'self'\)/);
assert.match(script, /hasUsedOwnMeetingButton\(\)/);
assert.match(script, /event\.metaKey && event\.key==='Enter'/);
assert.match(script, /openMeetingFromLastPathEvent\(\)/);
assert.match(script, /meetingContextFromLastPathEvent\(\)/);
assert.match(script, /openMeetingDialog\(context\.type,context\.reporter\)/);
assert.doesNotMatch(script, /\$\('#meetingType'\)/);
assert.doesNotMatch(script, /\$\('#reporter'\)/);
assert.match(script, /meetingNumberFromShortcut\(event\)/);
assert.match(html, /1：停電/);
assert.match(html, /2：コミュニケーション/);
assert.match(html, /3：リアクター/);
assert.match(html, /4 \/ ⇧\+4/);
assert.match(html, /5 \/ ⇧\+5/);
assert.match(html, /⌘\+Enter/);

console.log('Sabotage shortcuts: ok');
