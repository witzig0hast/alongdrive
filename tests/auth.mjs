// Integrationstest der Authentifizierung: startet den Server mit leerem Datenverzeichnis
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import WebSocket from 'ws';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-auth-'));
const PORT = 18000 + Math.floor(Math.random() * 1000);
const srv = spawn('node', ['server/server.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir }, stdio: 'ignore' });
const base = `http://127.0.0.1:${PORT}`;
const jar = {};
const call = async (who, p, method = 'GET', body) => {
  const r = await fetch(base + p, { method, redirect: 'manual', headers: { 'Content-Type': 'application/json', Origin: base, ...(jar[who] ? { Cookie: jar[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc && /dd_session=[^;]+/.test(sc) && !/Max-Age=0/.test(sc)) jar[who] = sc.split(';')[0];
  let j = null;
  try { j = await r.clone().json(); } catch {}
  return { status: r.status, json: j, headers: r.headers };
};
let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };
for (let i = 0; i < 50; i++) { try { await fetch(base + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

console.log('Authentifizierung');
await t('ohne Anmeldung: Spiel gesperrt, Login-Seite offen', async () => {
  assert.equal((await call('x', '/login')).status, 200);
  assert.equal((await call('x', '/auth/me')).status, 401);
  assert.equal((await call('x', '/assets/x.js')).status, 401);
  const r = await fetch(base + '/', { redirect: 'manual', headers: { Accept: 'text/html' } });
  assert.equal(r.status, 302);
});
await t('Einrichtung offen; erster Account wird Admin', async () => {
  assert.equal((await call('x', '/auth/status')).json.setup, true);
  assert.equal((await call('admin', '/auth/register', 'POST', { username: 'ab', password: 'longenough1' })).status, 400);
  assert.equal((await call('admin', '/auth/register', 'POST', { username: 'chef', password: 'short' })).status, 400);
  assert.equal((await call('admin', '/auth/register', 'POST', { username: 'chef', password: 'geheim1234' })).status, 200);
  assert.equal((await call('admin', '/auth/me')).json.user.role, 'admin');
});
await t('Registrierung danach geschlossen', async () => {
  assert.equal((await call('x', '/auth/status')).json.setup, false);
  assert.equal((await call('evil', '/auth/register', 'POST', { username: 'hacker', password: 'geheim1234' })).status, 403);
});
await t('Admin legt Spieler an, Spieler kann sich anmelden, aber nicht verwalten', async () => {
  assert.equal((await call('admin', '/api/admin/users', 'POST', { username: 'spieler1', password: 'passwort123', role: 'user' })).status, 200);
  assert.equal((await call('admin', '/api/admin/users', 'POST', { username: 'Spieler1', password: 'passwort123' })).status, 409);
  assert.equal((await call('p1', '/auth/login', 'POST', { username: 'spieler1', password: 'falsch' })).status, 401);
  assert.equal((await call('p1', '/auth/login', 'POST', { username: 'spieler1', password: 'passwort123' })).status, 200);
  assert.equal((await call('p1', '/api/admin/users')).status, 403);
  assert.equal((await call('p1', '/admin')).status, 403);
  assert.equal((await call('admin', '/admin')).status, 200);
});
await t('Passwörter sind gehasht, Sessions nur als Hash gespeichert', async () => {
  await new Promise((r) => setTimeout(r, 500));
  const raw = fs.readFileSync(path.join(dir, 'auth.json'), 'utf8');
  assert.ok(!raw.includes('passwort123') && !raw.includes('geheim1234') && raw.includes('scrypt$'));
  assert.ok(!raw.includes(jar.p1.split('=')[1]));
});
await t('WebSocket nur mit gültiger Session; Name kommt vom Account', async () => {
  const ws0 = new WebSocket(`ws://127.0.0.1:${PORT}`);
  await new Promise((res) => { ws0.on('error', res); ws0.on('unexpected-response', res); ws0.on('open', () => { ws0.close(); assert.fail('ohne Cookie verbunden'); }); });
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, { headers: { Cookie: jar.p1 } });
  const joined = await new Promise((res, rej) => { ws.on('open', () => ws.send(JSON.stringify({ t: 'create', name: 'Fälscher', seed: 'x' }))); ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 'joined') res(m); }); ws.on('error', rej); });
  assert.ok(joined.code);
  assert.equal(joined.snapshot.players.length, 0);
  ws.close();
});
await t('Letzten Admin kann man weder löschen noch degradieren', async () => {
  const users = (await call('admin', '/api/admin/users')).json.users;
  const chef = users.find((u) => u.username === 'chef');
  assert.equal((await call('admin', `/api/admin/users/${chef.id}`, 'DELETE')).status, 400);
  assert.equal((await call('admin', `/api/admin/users/${chef.id}`, 'PATCH', { role: 'user' })).status, 400);
});
await t('Sperren beendet Sessions; Passwort-Reset; Löschen', async () => {
  const p1 = (await call('admin', '/api/admin/users')).json.users.find((u) => u.username === 'spieler1');
  await call('admin', `/api/admin/users/${p1.id}`, 'PATCH', { disabled: true });
  assert.equal((await call('p1', '/auth/me')).status, 401);
  await call('admin', `/api/admin/users/${p1.id}`, 'PATCH', { disabled: false, password: 'neuespasswort' });
  assert.equal((await call('p1', '/auth/login', 'POST', { username: 'spieler1', password: 'neuespasswort' })).status, 200);
  assert.equal((await call('admin', `/api/admin/users/${p1.id}`, 'DELETE')).status, 200);
});
await t('Bestenliste', async () => {
  assert.equal((await call('admin', '/api/score', 'POST', { km: 12.5, days: 1.2, kills: 3, seed: 's', cause: 'Test' })).status, 200);
  const s = (await call('admin', '/api/scores')).json;
  assert.equal(s.top[0].name, 'chef');
  assert.equal(s.top[0].km, 12.5);
});
await t('Fremder Origin bei POST wird abgelehnt; Login-Drosselung', async () => {
  const r = await fetch(base + '/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.example' }, body: '{}' });
  assert.equal(r.status, 403);
  let last = 0;
  for (let i = 0; i < 12; i++) last = (await call('z', '/auth/login', 'POST', { username: 'chef', password: 'x' + i })).status;
  assert.equal(last, 429);
});
srv.kill();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} Tests bestanden${process.exitCode ? ' – FEHLER' : ''}`);
process.exit(process.exitCode || 0);
