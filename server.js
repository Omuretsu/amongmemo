'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const HOST = '127.0.0.1';
const PORT = Number.parseInt(process.env.AMONG_MEMO_PORT || '3210', 10);
const APP_ROOT = __dirname;
const PRIVATE_ROOT = path.resolve(process.env.AMONG_MEMO_DATA_DIR || path.join(APP_ROOT, 'private'));
const PLAYERS_ROOT = path.join(PRIVATE_ROOT, 'players');
const GAMES_ROOT = path.join(PRIVATE_ROOT, 'games');
const SETTINGS_FILE = path.join(PRIVATE_ROOT, 'settings.json');
const API_TOKEN = crypto.randomBytes(32).toString('base64url');
const EXPECTED_ORIGIN = `http://${HOST}:${PORT}`;
const MAX_BODY_BYTES = 1024 * 1024;
const API_VERSION = 2;

const STATIC_FILES = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/css/style.css', ['css/style.css', 'text/css; charset=utf-8']],
  ['/js/map-data.js', ['js/map-data.js', 'text/javascript; charset=utf-8']],
  ['/js/app.js', ['js/app.js', 'text/javascript; charset=utf-8']]
]);

function sendJson(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {'Content-Type':'application/json; charset=utf-8','Content-Length':Buffer.byteLength(body),'Cache-Control':'no-store'});
  response.end(body);
}

function securityHeaders(response) {
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('Referrer-Policy', 'no-referrer');
  response.setHeader('X-Frame-Options', 'DENY');
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
}

function validToken(request) {
  const supplied = request.headers['x-among-memo-token'];
  if (typeof supplied !== 'string') return false;
  const expectedBuffer = Buffer.from(API_TOKEN);
  const suppliedBuffer = Buffer.from(supplied);
  return expectedBuffer.length === suppliedBuffer.length && crypto.timingSafeEqual(expectedBuffer, suppliedBuffer);
}

function authorizeWrite(request, response) {
  if (request.headers.origin !== EXPECTED_ORIGIN) {
    sendJson(response, 403, {error:'許可されていないアクセス元です'});
    return false;
  }
  if (!validToken(request)) {
    sendJson(response, 403, {error:'APIトークンが正しくありません'});
    return false;
  }
  if (!String(request.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    sendJson(response, 415, {error:'application/jsonのみ利用できます'});
    return false;
  }
  return true;
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('データが大きすぎます'), {status:413});
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('JSONが正しくありません'), {status:400});
  }
}

function validatePlayer(source) {
  if (!source || typeof source !== 'object') throw Object.assign(new Error('プレイヤーデータが正しくありません'), {status:400});
  const id = String(source.id || '');
  const name = String(source.name || '').trim().normalize('NFKC');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(id)) throw Object.assign(new Error('プレイヤーIDが正しくありません'), {status:400});
  if (!name || name.length > 40 || /[\u0000-\u001f\u007f]/.test(name)) throw Object.assign(new Error('プレイヤー名が正しくありません'), {status:400});
  return {id, name};
}

function normalizedName(name) { return name.normalize('NFKC').toLocaleLowerCase('ja-JP'); }
function playerPath(id) { return path.join(PLAYERS_ROOT, `${id}.json`); }

async function readJsonFile(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function safeReadPlayer(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('通常ファイルではありません');
  const data = await readJsonFile(file);
  return validatePlayer(data.player);
}

async function loadPlayers() {
  const players = [];
  for (const entry of await fs.readdir(PLAYERS_ROOT, {withFileTypes:true})) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    try { players.push(await safeReadPlayer(path.join(PLAYERS_ROOT, entry.name))); }
    catch (error) { console.warn(`プレイヤーファイルを無視しました: ${entry.name}: ${error.message}`); }
  }
  return players;
}

async function atomicWriteJson(file, value) {
  const directory = path.dirname(file);
  const temporary = path.join(directory, `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {encoding:'utf8',mode:0o600,flag:'wx'});
  await fs.rename(temporary, file);
  await fs.chmod(file, 0o600);
}

async function ensureNoNameConflicts(players, existingPlayers) {
  const byName = new Map();
  for (const player of [...existingPlayers, ...players]) {
    const key = normalizedName(player.name);
    const previous = byName.get(key);
    if (previous && previous.id !== player.id) {
      throw Object.assign(new Error(`同名の別プレイヤーが存在します: ${player.name}`), {status:409,conflict:{existing:previous,incoming:player}});
    }
    byName.set(key, player);
  }
}

async function syncPlayers(sources, selfId) {
  if (!Array.isArray(sources) || sources.length > 100) throw Object.assign(new Error('プレイヤー一覧が正しくありません'), {status:400});
  const players = sources.map(validatePlayer).filter(player => player.id !== selfId);
  if (new Set(players.map(player=>player.id)).size !== players.length) throw Object.assign(new Error('プレイヤーIDが重複しています'), {status:400});
  const existingPlayers = await loadPlayers();
  await ensureNoNameConflicts(players, existingPlayers);
  const result = {created:[],updated:[],unchanged:[]};
  for (const player of players) {
    const file = playerPath(player.id);
    let existing = null;
    try { existing = await safeReadPlayer(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (existing && existing.id===player.id && existing.name===player.name) {
      result.unchanged.push(player.name);
      continue;
    }
    await atomicWriteJson(file, {version:1,player});
    result[existing ? 'updated' : 'created'].push(player.name);
  }
  return result;
}

async function loadSettings() {
  try {
    const data = await readJsonFile(SETTINGS_FILE);
    return data.self ? validatePlayer(data.self) : null;
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    console.warn(`settings.jsonを読み込めません: ${error.message}`);
    return null;
  }
}

function validateGame(source) {
  if (!source || typeof source !== 'object') throw Object.assign(new Error('ゲームデータが正しくありません'), {status:400});
  const id = String(source.id || '');
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(id)) throw Object.assign(new Error('ゲームIDが正しくありません'), {status:400});
  if (!Array.isArray(source.participants) || !Array.isArray(source.timeline) || source.timeline.length > 500) throw Object.assign(new Error('ゲームログが正しくありません'), {status:400});
  return {...source,id,endedAt:new Date().toISOString()};
}

async function saveGame(source) {
  const game = validateGame(source);
  const file = path.join(GAMES_ROOT, `${game.id}.json`);
  try {
    const stat = await fs.lstat(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('ゲームログの保存先が通常ファイルではありません');
    return {file:path.basename(file),status:'unchanged'};
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await atomicWriteJson(file, {version:1,game});
  return {file:path.basename(file),status:'created'};
}

async function preparePrivateDirectories() {
  await fs.mkdir(PLAYERS_ROOT, {recursive:true,mode:0o700});
  await fs.mkdir(GAMES_ROOT, {recursive:true,mode:0o700});
  await fs.chmod(PRIVATE_ROOT, 0o700);
  await fs.chmod(PLAYERS_ROOT, 0o700);
  await fs.chmod(GAMES_ROOT, 0o700);
  try { await fs.chmod(SETTINGS_FILE, 0o600); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}

async function serveStatic(request, response, pathname) {
  const definition = STATIC_FILES.get(pathname);
  if (!definition || !['GET','HEAD'].includes(request.method)) return false;
  const [relative, contentType] = definition;
  const body = await fs.readFile(path.join(APP_ROOT, relative));
  response.writeHead(200, {'Content-Type':contentType,'Content-Length':body.length,'Cache-Control':'no-cache'});
  response.end(request.method === 'HEAD' ? undefined : body);
  return true;
}

async function handleRequest(request, response) {
  securityHeaders(response);
  if (request.headers.host !== `${HOST}:${PORT}`) return sendJson(response, 400, {error:'Hostが正しくありません'});
  const url = new URL(request.url, EXPECTED_ORIGIN);
  if (url.pathname.startsWith('/private/')) return sendJson(response, 404, {error:'Not Found'});

  if (request.method==='GET' && url.pathname==='/api/health') return sendJson(response, 200, {ok:true,apiVersion:API_VERSION});
  if (request.method==='GET' && url.pathname==='/api/bootstrap') {
    const [self,players] = await Promise.all([loadSettings(),loadPlayers()]);
    return sendJson(response, 200, {version:1,apiVersion:API_VERSION,token:API_TOKEN,self,players});
  }
  if (request.method==='POST' && url.pathname==='/api/players') {
    if (!authorizeWrite(request,response)) return;
    const body = await readJsonBody(request);
    const self = await loadSettings();
    const result = await syncPlayers(body.players,self?.id);
    return sendJson(response, 200, {ok:true,players:result});
  }
  if (request.method==='POST' && url.pathname==='/api/games/end') {
    if (!authorizeWrite(request,response)) return;
    const body = await readJsonBody(request);
    const self = await loadSettings();
    const players = await syncPlayers(body.players,self?.id);
    const game = await saveGame(body.game);
    return sendJson(response, 200, {ok:true,players,game});
  }
  if (request.method==='DELETE' && url.pathname.startsWith('/api/players/')) {
    if (!authorizeWrite(request,response)) return;
    const body = await readJsonBody(request);
    const id = decodeURIComponent(url.pathname.slice('/api/players/'.length));
    validatePlayer({id,name:body.name || 'player'});
    const self = await loadSettings();
    if (self?.id===id) return sendJson(response, 403, {error:'自分は削除できません'});
    try { await fs.unlink(playerPath(id)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    return sendJson(response, 200, {ok:true});
  }
  if (await serveStatic(request,response,url.pathname)) return;
  sendJson(response, 404, {error:'Not Found'});
}

async function start() {
  await preparePrivateDirectories();
  const server = http.createServer((request,response) => {
    handleRequest(request,response).catch(error => {
      if (!error.status || error.status >= 500) console.error(error);
      if (!response.headersSent) sendJson(response,error.status||500,{error:error.status?error.message:'サーバーエラーが発生しました',conflict:error.conflict});
      else response.destroy();
    });
  });
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(PORT,HOST,() => {
      server.removeListener('error',reject);
      console.log(`Among Memo: ${EXPECTED_ORIGIN}`);
      resolve();
    });
  });
  const shutdown = () => server.close(() => process.exit(0));
  process.on('SIGINT',shutdown);
  process.on('SIGTERM',shutdown);
  return server;
}

if (require.main === module) start().catch(error => { console.error(error); process.exit(1); });

module.exports = {start,validatePlayer,loadPlayers,syncPlayers,saveGame};
