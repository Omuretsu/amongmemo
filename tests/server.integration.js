'use strict';

const assert = require('node:assert/strict');

const baseUrl = process.env.AMONG_MEMO_TEST_URL || 'http://127.0.0.1:3211';

async function json(path, options={}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const body = await response.json();
  return {response,body};
}

(async () => {
  const health = await json('/api/health');
  assert.equal(health.response.status,200);
  assert.equal(health.body.ok,true);
  assert.equal(health.body.apiVersion,2);

  const bootstrap = await json('/api/bootstrap');
  assert.equal(bootstrap.response.status,200);
  assert.ok(bootstrap.body.token);
  assert.equal(bootstrap.body.apiVersion,2);

  const privateRoute = await json('/private/settings.json');
  assert.equal(privateRoute.response.status,404);

  const game = {id:'test-game',participants:[],timeline:[],sabotages:[],deaths:[],path:[],turn:1};
  const payload = JSON.stringify({players:[{id:'alice-id',name:'Alice'}],game});
  const origin = baseUrl;

  const unauthorized = await json('/api/games/end',{method:'POST',headers:{'Content-Type':'application/json','Origin':origin},body:payload});
  assert.equal(unauthorized.response.status,403);

  const headers = {'Content-Type':'application/json','Origin':origin,'X-Among-Memo-Token':bootstrap.body.token};
  const registered = await json('/api/players',{method:'POST',headers,body:JSON.stringify({players:[{id:'bob-id',name:'Bob'}]})});
  assert.equal(registered.response.status,200);
  assert.deepEqual(registered.body.players.created,['Bob']);
  const afterRegistration = await json('/api/bootstrap');
  assert.deepEqual(afterRegistration.body.players,[{id:'bob-id',name:'Bob'}]);

  const created = await json('/api/games/end',{method:'POST',headers,body:payload});
  assert.equal(created.response.status,200);
  assert.deepEqual(created.body.players.created,['Alice']);
  assert.equal(created.body.game.status,'created');

  const unchanged = await json('/api/games/end',{method:'POST',headers,body:payload});
  assert.equal(unchanged.response.status,200);
  assert.deepEqual(unchanged.body.players.unchanged,['Alice']);
  assert.equal(unchanged.body.game.status,'unchanged');

  const updatedPayload = JSON.stringify({players:[{id:'alice-id',name:'Alice Updated'}],game:{...game,id:'test-game-2'}});
  const updated = await json('/api/games/end',{method:'POST',headers,body:updatedPayload});
  assert.equal(updated.response.status,200);
  assert.deepEqual(updated.body.players.updated,['Alice Updated']);

  const conflictPayload = JSON.stringify({players:[{id:'different-id',name:'Alice Updated'}],game:{...game,id:'test-game-3'}});
  const conflict = await json('/api/games/end',{method:'POST',headers,body:conflictPayload});
  assert.equal(conflict.response.status,409);

  const page = await fetch(`${baseUrl}/`);
  assert.equal(page.status,200);
  assert.match(page.headers.get('content-security-policy'),/default-src 'self'/);
  assert.equal(page.headers.get('x-frame-options'),'DENY');

  console.log('server integration: ok');
})().catch(error => {
  console.error(error);
  process.exit(1);
});
