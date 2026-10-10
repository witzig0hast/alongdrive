// SSO-Test gegen einen Mock-OIDC-Provider (Authorization-Code-Flow mit PKCE)
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dd-oidc-'));
const IDP = 19000 + Math.floor(Math.random() * 500);
const PORT = 19600 + Math.floor(Math.random() * 300);
let currentUser = { sub: 'u-alice', email: 'alice@example.com', email_verified: true, preferred_username: 'alice' };
const codes = new Map();
const idp = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const json = (o) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
  if (u.pathname === '/.well-known/openid-configuration') return json({ authorization_endpoint: `http://127.0.0.1:${IDP}/authorize`, token_endpoint: `http://127.0.0.1:${IDP}/token`, userinfo_endpoint: `http://127.0.0.1:${IDP}/userinfo` });
  if (u.pathname === '/authorize') {
    const code = crypto.randomBytes(8).toString('hex');
    codes.set(code, { challenge: u.searchParams.get('code_challenge'), user: currentUser });
    res.writeHead(302, { Location: `${u.searchParams.get('redirect_uri')}?code=${code}&state=${u.searchParams.get('state')}` });
    return res.end();
  }
  if (u.pathname === '/token') {
    let b = '';
    req.on('data', (c) => (b += c));
    req.on('end', () => {
      const p = new URLSearchParams(b);
      const c = codes.get(p.get('code'));
      const okPkce = c && crypto.createHash('sha256').update(p.get('code_verifier') || '').digest('base64url') === c.challenge;
      if (!okPkce || p.get('client_secret') !== 'shh') { res.writeHead(400); return res.end('{}'); }
      codes.delete(p.get('code'));
      const at = 'at-' + crypto.randomBytes(6).toString('hex');
      codes.set(at, c);
      json({ access_token: at, token_type: 'Bearer' });
    });
    return;
  }
  if (u.pathname === '/userinfo') {
    const c = codes.get((req.headers.authorization || '').replace('Bearer ', ''));
    if (!c) { res.writeHead(401); return res.end(); }
    return json(c.user);
  }
  res.writeHead(404); res.end();
});
await new Promise((r) => idp.listen(IDP, '127.0.0.1', r));
const srv = spawn('node', ['server/server.js'], { env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, OIDC_ISSUER: `http://127.0.0.1:${IDP}`, OIDC_CLIENT_ID: 'dd', OIDC_CLIENT_SECRET: 'shh', PUBLIC_URL: `http://127.0.0.1:${PORT}` }, stdio: 'ignore' });
const base = `http://127.0.0.1:${PORT}`;
for (let i = 0; i < 50; i++) { try { await fetch(base + '/health'); break; } catch { await new Promise((r) => setTimeout(r, 100)); } }

// manueller Redirect-Follower mit Cookie-Jar
async function sso(user) {
  currentUser = user;
  let jar = '';
  let url = base + '/auth/oidc/start';
  for (let i = 0; i < 6; i++) {
    const r = await fetch(url, { redirect: 'manual', headers: jar ? { Cookie: jar } : {} });
    const sc = r.headers.get('set-cookie');
    if (sc && !/Max-Age=0/.test(sc)) jar = sc.split(';')[0];
    if (r.status >= 300 && r.status < 400) { url = new URL(r.headers.get('location'), url).toString(); continue; }
    return { status: r.status, jar, text: await r.text() };
  }
  return { status: 302, jar, text: '' };
}
const me = async (jar) => (await fetch(base + '/auth/me', { headers: { Cookie: jar } })).json();
let passed = 0;
const t = async (name, fn) => { try { await fn(); passed++; console.log('  ✓', name); } catch (e) { console.error('  ✗', name, '\n   ', e.message); process.exitCode = 1; } };
console.log('SSO (OIDC)');
let adminJar;
await t('Status zeigt SSO an; erster SSO-Login wird Admin', async () => {
  const st = await (await fetch(base + '/auth/status')).json();
  assert.ok(st.oidc && st.setup);
  const r = await sso({ sub: 'u-alice', email: 'alice@example.com', email_verified: true, preferred_username: 'alice' });
  assert.ok(r.jar, 'keine Session: ' + r.text.slice(0, 200));
  adminJar = r.jar;
  const m = await me(r.jar);
  assert.equal(m.user.role, 'admin');
  assert.equal(m.user.username, 'alice');
});
await t('Zweiter, unbekannter SSO-Nutzer wird abgewiesen', async () => {
  const r = await sso({ sub: 'u-bob', email: 'bob@example.com', email_verified: true, preferred_username: 'bob' });
  assert.equal(r.status, 403);
  assert.ok(/nicht freigeschaltet/.test(r.text));
});
await t('Admin schaltet Bob per E-Mail frei -> Login klappt als Spieler', async () => {
  const r0 = await fetch(base + '/api/admin/users', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminJar, Origin: base }, body: JSON.stringify({ username: 'bobby', email: 'bob@example.com', sso: true }) });
  assert.equal(r0.status, 200);
  const r = await sso({ sub: 'u-bob', email: 'bob@example.com', email_verified: true, preferred_username: 'bob' });
  const m = await me(r.jar);
  assert.equal(m.user.username, 'bobby');
  assert.equal(m.user.role, 'user');
});
await t('Auto-Anlage aktivierbar', async () => {
  await fetch(base + '/api/admin/settings', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: adminJar, Origin: base }, body: JSON.stringify({ ssoAutoCreate: true }) });
  const r = await sso({ sub: 'u-carol', email: 'carol@example.com', email_verified: true, preferred_username: 'carol' });
  assert.equal((await me(r.jar)).user.username, 'carol');
});
await t('Falscher/abgelaufener State wird abgelehnt', async () => {
  const r = await fetch(base + '/auth/oidc/callback?code=x&state=nope', { redirect: 'manual' });
  assert.equal(r.status, 403);
});
srv.kill(); idp.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} Tests bestanden${process.exitCode ? ' – FEHLER' : ''}`);
process.exit(process.exitCode || 0);
