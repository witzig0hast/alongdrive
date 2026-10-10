// Authentifizierung für Dead Desert
// - lokale Konten (scrypt) + generisches OpenID-Connect-SSO (Authentik, Keycloak, Authelia, Google …)
// - der ERSTE Account (lokal oder per SSO) wird Admin, danach ist die Selbstregistrierung geschlossen
// - weitere Konten legt der Admin an (oder gibt SSO-Auto-Anlage frei)
// - Sessions per HttpOnly-Cookie (serverseitig, nur als Hash gespeichert), Bestenliste pro Account
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const COOKIE = 'dd_session';
const SESSION_MS = 30 * 24 * 3600 * 1000;
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const b64u = (b) => Buffer.from(b).toString('base64url');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const h = crypto.scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString('hex')}$${h.toString('hex')}`;
}

export function verifyPassword(pw, stored) {
  try {
    const [alg, saltHex, hashHex] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const h = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), 64, { N: 16384, r: 8, p: 1 });
    return crypto.timingSafeEqual(h, Buffer.from(hashHex, 'hex'));
  } catch {
    return false;
  }
}

export class AuthService {
  constructor(opts = {}) {
    this.disabled = !!opts.disabled;
    this.dir = opts.dataDir || path.join(process.cwd(), 'data');
    this.file = path.join(this.dir, 'auth.json');
    this.publicUrl = (opts.publicUrl || '').replace(/\/$/, '');
    this.oidc = opts.oidc && opts.oidc.issuer && opts.oidc.clientId ? opts.oidc : null;
    this.data = { users: [], sessions: {}, settings: { ssoAutoCreate: false }, scores: [] };
    this.states = new Map();
    this.attempts = new Map();
    this.discovery = null;
    this.load();
    setInterval(() => this.gc(), 10 * 60 * 1000).unref();
  }

  // ------------------------------------------------------------ Speicher
  load() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (fs.existsSync(this.file)) this.data = { ...this.data, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) };
    } catch (e) {
      console.error('[auth] Konnte', this.file, 'nicht lesen:', e.message);
    }
  }

  save() {
    clearTimeout(this._t);
    this._t = setTimeout(() => {
      try {
        const tmp = this.file + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 1), { mode: 0o600 });
        fs.renameSync(tmp, this.file);
      } catch (e) {
        console.error('[auth] Speichern fehlgeschlagen:', e.message);
      }
    }, 200);
  }

  gc() {
    const now = Date.now();
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.exp < now) delete this.data.sessions[k];
    for (const [k, s] of this.states) if (s.exp < now) this.states.delete(k);
    for (const [k, a] of this.attempts) if (a.reset < now) this.attempts.delete(k);
    this.save();
  }

  get needsSetup() {
    return this.data.users.length === 0;
  }

  // ------------------------------------------------------------ Benutzer
  publicUser(u) {
    return { id: u.id, username: u.username, email: u.email || '', role: u.role, provider: u.provider, disabled: !!u.disabled, createdAt: u.createdAt, lastLogin: u.lastLogin || 0 };
  }

  findByName(name) {
    const n = String(name).toLowerCase();
    return this.data.users.find((u) => u.username.toLowerCase() === n);
  }

  validName(n) {
    return /^[A-Za-z0-9_.-]{3,20}$/.test(String(n || ''));
  }

  createUser({ username, password, email, role, provider = 'local', oidcSub }) {
    const u = {
      id: crypto.randomUUID(),
      username,
      email: email || '',
      role: role || 'user',
      provider,
      oidcSub: oidcSub || null,
      passHash: password ? hashPassword(password) : null,
      createdAt: Date.now(),
      disabled: false,
    };
    this.data.users.push(u);
    this.save();
    return u;
  }

  uniqueName(base) {
    let n = String(base || 'spieler').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 16) || 'spieler';
    if (n.length < 3) n = n + 'xyz'.slice(0, 3 - n.length);
    let cand = n;
    for (let i = 2; this.findByName(cand); i++) cand = n.slice(0, 16) + i;
    return cand;
  }

  adminCount() {
    return this.data.users.filter((u) => u.role === 'admin' && !u.disabled).length;
  }

  // ------------------------------------------------------------ Sessions
  newSession(res, req, user) {
    const token = crypto.randomBytes(32).toString('base64url');
    this.data.sessions[sha(token)] = { uid: user.id, exp: Date.now() + SESSION_MS };
    user.lastLogin = Date.now();
    this.save();
    const secure = this.isHttps(req) ? '; Secure' : '';
    this.addCookie(res, `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  }

  addCookie(res, c) {
    const prev = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', prev ? [].concat(prev, c) : c);
  }

  isHttps(req) {
    return (req.headers['x-forwarded-proto'] || '').split(',')[0] === 'https' || this.publicUrl.startsWith('https');
  }

  cookies(req) {
    const out = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  userFromRequest(req) {
    if (this.disabled) return { id: 'anon', username: 'Gast', role: 'admin', provider: 'none' };
    const tok = this.cookies(req)[COOKIE];
    if (!tok) return null;
    const s = this.data.sessions[sha(tok)];
    if (!s || s.exp < Date.now()) return null;
    const u = this.data.users.find((x) => x.id === s.uid);
    return u && !u.disabled ? u : null;
  }

  destroySession(req, res) {
    const tok = this.cookies(req)[COOKIE];
    if (tok) delete this.data.sessions[sha(tok)];
    this.save();
    this.addCookie(res, `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  }

  dropUserSessions(uid) {
    for (const [k, s] of Object.entries(this.data.sessions)) if (s.uid === uid) delete this.data.sessions[k];
  }

  // ------------------------------------------------------------ HTTP-Hilfen
  json(res, code, obj) {
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
  }

  html(res, body, code = 200) {
    res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' });
    res.end(body);
  }

  readBody(req, limit = 20000) {
    return new Promise((resolve, reject) => {
      let n = 0;
      const chunks = [];
      req.on('data', (c) => {
        n += c.length;
        if (n > limit) {
          reject(new Error('zu groß'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
        } catch {
          reject(new Error('ungültiges JSON'));
        }
      });
    });
  }

  sameOrigin(req) {
    const o = req.headers.origin;
    if (!o) return true;
    try {
      return new URL(o).host === req.headers.host;
    } catch {
      return false;
    }
  }

  clientIp(req) {
    return (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  }

  throttled(req) {
    const ip = this.clientIp(req);
    const now = Date.now();
    let a = this.attempts.get(ip);
    if (!a || a.reset < now) a = { n: 0, reset: now + 5 * 60 * 1000 };
    this.attempts.set(ip, a);
    return a;
  }

  baseUrl(req) {
    if (this.publicUrl) return this.publicUrl;
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0];
    return `${proto}://${req.headers['x-forwarded-host'] || req.headers.host}`;
  }

  // ------------------------------------------------------------ Router
  /** Gibt true zurück, wenn die Anfrage behandelt wurde. */
  async handle(req, res) {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const m = req.method;
    try {
      if (p === '/login' && m === 'GET') return this.html(res, loginPage()), true;
      if (p === '/auth/status' && m === 'GET') return this.json(res, 200, { setup: this.needsSetup, oidc: !!this.oidc, oidcName: this.oidc?.name || 'SSO', disabled: this.disabled }), true;
      if (p === '/auth/me' && m === 'GET') {
        const u = this.userFromRequest(req);
        return u ? this.json(res, 200, { user: this.publicUser(u) }) : this.json(res, 401, { error: 'nicht angemeldet' }), true;
      }
      if (p === '/auth/logout' && m === 'POST') {
        this.destroySession(req, res);
        return this.json(res, 200, { ok: true }), true;
      }
      if (p === '/auth/register' && m === 'POST') return await this.register(req, res), true;
      if (p === '/auth/login' && m === 'POST') return await this.login(req, res), true;
      if (p === '/auth/oidc/start' && m === 'GET') return await this.oidcStart(req, res, url), true;
      if (p === '/auth/oidc/callback' && m === 'GET') return await this.oidcCallback(req, res, url), true;
      if (p === '/admin' && m === 'GET') {
        const u = this.userFromRequest(req);
        if (!u) return res.writeHead(302, { Location: '/login' }), res.end(), true;
        if (u.role !== 'admin') return this.html(res, '<h1>Kein Zugriff</h1><a href="/">Zurück</a>', 403), true;
        return this.html(res, adminPage()), true;
      }
      if (p.startsWith('/api/')) return await this.api(req, res, p, m), true;
    } catch (e) {
      console.error('[auth]', e.message);
      this.json(res, 400, { error: e.message });
      return true;
    }
    return false;
  }

  async register(req, res) {
    if (!this.sameOrigin(req)) return this.json(res, 403, { error: 'Origin' });
    if (!this.needsSetup) return this.json(res, 403, { error: 'Registrierung ist geschlossen – der Admin legt Konten an.' });
    const b = await this.readBody(req);
    if (!this.validName(b.username)) return this.json(res, 400, { error: 'Benutzername: 3–20 Zeichen (A–Z, 0–9, _ . -)' });
    if (String(b.password || '').length < 8) return this.json(res, 400, { error: 'Passwort: mindestens 8 Zeichen' });
    const u = this.createUser({ username: b.username, password: b.password, email: b.email, role: 'admin' });
    console.log(`[auth] Erster Account angelegt: ${u.username} (Admin)`);
    this.newSession(res, req, u);
    this.json(res, 200, { ok: true });
  }

  async login(req, res) {
    if (!this.sameOrigin(req)) return this.json(res, 403, { error: 'Origin' });
    const a = this.throttled(req);
    if (a.n >= 10) return this.json(res, 429, { error: 'Zu viele Versuche – bitte in einigen Minuten erneut.' });
    const b = await this.readBody(req);
    const u = this.findByName(b.username);
    const ok = u && u.passHash && !u.disabled && verifyPassword(String(b.password || ''), u.passHash);
    if (!ok) {
      a.n++;
      if (!u) crypto.scryptSync('x', 'y', 64); // Zeitverhalten angleichen
      return this.json(res, 401, { error: 'Benutzername oder Passwort falsch' });
    }
    this.attempts.delete(this.clientIp(req));
    this.newSession(res, req, u);
    this.json(res, 200, { ok: true });
  }

  // ------------------------------------------------------------ OIDC
  async getDiscovery() {
    if (this.discovery && this.discovery.exp > Date.now()) return this.discovery.doc;
    const r = await fetch(this.oidc.issuer.replace(/\/$/, '') + '/.well-known/openid-configuration');
    if (!r.ok) throw new Error('OIDC-Discovery fehlgeschlagen (' + r.status + ')');
    const doc = await r.json();
    this.discovery = { doc, exp: Date.now() + 3600 * 1000 };
    return doc;
  }

  async oidcStart(req, res, url) {
    if (!this.oidc) return this.html(res, loginPage('SSO ist nicht konfiguriert.'), 404);
    const doc = await this.getDiscovery();
    const state = crypto.randomBytes(16).toString('base64url');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
    this.states.set(state, { verifier, exp: Date.now() + 10 * 60 * 1000 });
    const q = new URLSearchParams({
      response_type: 'code', client_id: this.oidc.clientId, redirect_uri: this.baseUrl(req) + '/auth/oidc/callback',
      scope: this.oidc.scopes || 'openid profile email', state, code_challenge: challenge, code_challenge_method: 'S256',
    });
    res.writeHead(302, { Location: doc.authorization_endpoint + '?' + q });
    res.end();
  }

  async oidcCallback(req, res, url) {
    const fail = (msg) => this.html(res, loginPage(msg), 403);
    if (!this.oidc) return fail('SSO ist nicht konfiguriert.');
    if (url.searchParams.get('error')) return fail('SSO-Anmeldung abgelehnt: ' + url.searchParams.get('error'));
    const st = this.states.get(url.searchParams.get('state') || '');
    this.states.delete(url.searchParams.get('state') || '');
    if (!st || st.exp < Date.now()) return fail('SSO-Sitzung abgelaufen – bitte erneut versuchen.');
    const doc = await this.getDiscovery();
    const body = new URLSearchParams({
      grant_type: 'authorization_code', code: url.searchParams.get('code') || '', redirect_uri: this.baseUrl(req) + '/auth/oidc/callback',
      client_id: this.oidc.clientId, code_verifier: st.verifier,
    });
    if (this.oidc.clientSecret) body.set('client_secret', this.oidc.clientSecret);
    const tr = await fetch(doc.token_endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
    if (!tr.ok) return fail('Token-Austausch fehlgeschlagen (' + tr.status + ')');
    const tok = await tr.json();
    const ur = await fetch(doc.userinfo_endpoint, { headers: { Authorization: 'Bearer ' + tok.access_token } });
    if (!ur.ok) return fail('Userinfo fehlgeschlagen (' + ur.status + ')');
    const info = await ur.json();
    if (!info.sub) return fail('SSO lieferte keine Benutzer-ID.');
    const email = info.email_verified === false ? '' : String(info.email || '').toLowerCase();
    let u = this.data.users.find((x) => x.oidcSub === info.sub && x.provider === 'oidc');
    if (!u && email) {
      // vom Admin vorab angelegter Account mit gleicher E-Mail -> verknüpfen
      u = this.data.users.find((x) => x.email && x.email.toLowerCase() === email && !x.oidcSub);
      if (u) {
        u.oidcSub = info.sub;
        if (!u.passHash) u.provider = 'oidc';
      }
    }
    if (!u) {
      if (this.needsSetup) {
        u = this.createUser({ username: this.uniqueName(info.preferred_username || info.name || email.split('@')[0]), email, role: 'admin', provider: 'oidc', oidcSub: info.sub });
        console.log(`[auth] Erster Account per SSO angelegt: ${u.username} (Admin)`);
      } else if (this.data.settings.ssoAutoCreate) {
        u = this.createUser({ username: this.uniqueName(info.preferred_username || info.name || email.split('@')[0]), email, role: 'user', provider: 'oidc', oidcSub: info.sub });
      } else return fail('Dein Konto ist nicht freigeschaltet. Bitte den Admin, dich anzulegen (E-Mail: ' + (email || 'unbekannt') + ').');
    }
    if (u.disabled) return fail('Dieses Konto ist deaktiviert.');
    this.newSession(res, req, u);
    res.writeHead(302, { Location: '/' });
    res.end();
  }

  // ------------------------------------------------------------ API
  async api(req, res, p, m) {
    const user = this.userFromRequest(req);
    if (!user) return this.json(res, 401, { error: 'nicht angemeldet' });
    if (m !== 'GET' && !this.sameOrigin(req)) return this.json(res, 403, { error: 'Origin' });

    if (p === '/api/scores' && m === 'GET') {
      const best = new Map();
      for (const s of this.data.scores) {
        const b = best.get(s.uid);
        if (!b || s.km > b.km) best.set(s.uid, s);
      }
      const top = [...best.values()].sort((a, b) => b.km - a.km).slice(0, 20);
      const mine = this.data.scores.filter((s) => s.uid === user.id).sort((a, b) => b.at - a.at).slice(0, 10);
      return this.json(res, 200, { top: top.map(({ uid, ...s }) => s), mine: mine.map(({ uid, ...s }) => s) });
    }
    if (p === '/api/score' && m === 'POST') {
      const b = await this.readBody(req);
      const n = (v, max) => Math.max(0, Math.min(max, Number(v) || 0));
      this.data.scores.push({ uid: user.id, name: user.username, km: +n(b.km, 100000).toFixed(2), days: +n(b.days, 10000).toFixed(1), kills: Math.floor(n(b.kills, 100000)), seed: String(b.seed || '').slice(0, 40), cause: String(b.cause || '').slice(0, 60), mp: !!b.mp, at: Date.now() });
      if (this.data.scores.length > 5000) this.data.scores.splice(0, this.data.scores.length - 5000);
      this.save();
      return this.json(res, 200, { ok: true });
    }
    if (p === '/api/change-password' && m === 'POST') {
      const b = await this.readBody(req);
      if (!user.passHash || !verifyPassword(String(b.old || ''), user.passHash)) return this.json(res, 403, { error: 'Altes Passwort falsch' });
      if (String(b.password || '').length < 8) return this.json(res, 400, { error: 'Passwort: mindestens 8 Zeichen' });
      user.passHash = hashPassword(b.password);
      this.save();
      return this.json(res, 200, { ok: true });
    }

    // ---- Admin
    if (!p.startsWith('/api/admin/')) return this.json(res, 404, { error: 'unbekannt' });
    if (user.role !== 'admin') return this.json(res, 403, { error: 'Nur für Admins' });
    if (p === '/api/admin/users' && m === 'GET') return this.json(res, 200, { users: this.data.users.map((u) => this.publicUser(u)), settings: this.data.settings, oidc: !!this.oidc, online: this.onlineCount?.() ?? 0 });
    if (p === '/api/admin/settings' && m === 'POST') {
      const b = await this.readBody(req);
      this.data.settings.ssoAutoCreate = !!b.ssoAutoCreate;
      this.save();
      return this.json(res, 200, { ok: true });
    }
    if (p === '/api/admin/users' && m === 'POST') {
      const b = await this.readBody(req);
      if (!this.validName(b.username)) return this.json(res, 400, { error: 'Benutzername: 3–20 Zeichen (A–Z, 0–9, _ . -)' });
      if (this.findByName(b.username)) return this.json(res, 409, { error: 'Benutzername existiert bereits' });
      const sso = !!b.sso;
      if (!sso && String(b.password || '').length < 8) return this.json(res, 400, { error: 'Passwort: mindestens 8 Zeichen' });
      if (sso && !b.email) return this.json(res, 400, { error: 'Für SSO-Freischaltung wird die E-Mail-Adresse benötigt' });
      const u = this.createUser({ username: b.username, password: sso ? null : b.password, email: String(b.email || '').toLowerCase(), role: b.role === 'admin' ? 'admin' : 'user', provider: sso ? 'oidc' : 'local' });
      return this.json(res, 200, { user: this.publicUser(u) });
    }
    const mm = p.match(/^\/api\/admin\/users\/([\w-]+)$/);
    if (mm) {
      const t = this.data.users.find((x) => x.id === mm[1]);
      if (!t) return this.json(res, 404, { error: 'Benutzer nicht gefunden' });
      if (m === 'DELETE') {
        if (t.role === 'admin' && this.adminCount() <= 1) return this.json(res, 400, { error: 'Der letzte Admin kann nicht gelöscht werden' });
        this.data.users = this.data.users.filter((x) => x !== t);
        this.dropUserSessions(t.id);
        this.save();
        return this.json(res, 200, { ok: true });
      }
      if (m === 'PATCH') {
        const b = await this.readBody(req);
        const wasAdmin = t.role === 'admin' && !t.disabled;
        if (b.role) t.role = b.role === 'admin' ? 'admin' : 'user';
        if (typeof b.disabled === 'boolean') t.disabled = b.disabled;
        if (typeof b.email === 'string') t.email = b.email.toLowerCase().slice(0, 100);
        if (b.password) {
          if (String(b.password).length < 8) return this.json(res, 400, { error: 'Passwort: mindestens 8 Zeichen' });
          t.passHash = hashPassword(b.password);
          this.dropUserSessions(t.id);
        }
        if (wasAdmin && (t.role !== 'admin' || t.disabled) && this.adminCount() < 1) {
          t.role = 'admin';
          t.disabled = false;
          return this.json(res, 400, { error: 'Es muss mindestens ein aktiver Admin bleiben' });
        }
        if (t.disabled) this.dropUserSessions(t.id);
        this.save();
        return this.json(res, 200, { user: this.publicUser(t) });
      }
    }
    return this.json(res, 404, { error: 'unbekannt' });
  }
}

// ---------------------------------------------------------------- Seiten
const STYLE = `
*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(ellipse at 50% 80%,#6b3d19,#120d08 70%);color:#f1e6cf;font-family:system-ui,Segoe UI,sans-serif;display:flex;align-items:center;justify-content:center;padding:16px}
.box{width:min(460px,100%);background:rgba(24,18,12,.88);border:1px solid rgba(224,162,59,.35);border-radius:10px;padding:28px;box-shadow:0 10px 50px #000a}
.wide{width:min(980px,100%)}h1{margin:0 0 6px;text-align:center;letter-spacing:.14em;color:#e0b878;font-size:30px;text-shadow:0 3px 0 #5a3a18}h2{color:#e0b878;margin:0 0 12px}
p.sub{text-align:center;color:#c9b58f;margin:0 0 18px}label{display:block;margin:10px 0;font-size:14px;color:#d9c8a4}
input,select{width:100%;margin-top:4px;padding:10px;background:#0006;border:1px solid #7b6238;color:#fff;border-radius:5px;font-size:15px}
button,.btn{display:block;width:100%;margin-top:12px;padding:11px;background:linear-gradient(#6a4a26,#4a321a);color:#f7ecd2;border:1px solid #a47b3d;border-radius:5px;font-size:15px;cursor:pointer;text-align:center;text-decoration:none}
button:hover,.btn:hover{background:linear-gradient(#85602f,#5c3f20)}button.small{display:inline-block;width:auto;margin:0 4px 0 0;padding:4px 9px;font-size:12px}
.err{background:#7a1f1a99;border:1px solid #c8443a;padding:8px 10px;border-radius:5px;margin:10px 0;font-size:14px}.ok{background:#1f6a2a99;border:1px solid #4ac85a;padding:8px 10px;border-radius:5px;margin:10px 0}
.sep{display:flex;align-items:center;gap:10px;color:#a2937a;margin:16px 0 4px;font-size:13px}.sep:before,.sep:after{content:"";flex:1;height:1px;background:#a2937a55}
table{width:100%;border-collapse:collapse;font-size:14px}td,th{padding:7px 8px;border-bottom:1px solid #fff2;text-align:left}th{color:#e0b878}.tag{padding:1px 7px;border-radius:9px;font-size:12px;background:#fff2}.tag.admin{background:#e0a23b;color:#201408}.tag.off{background:#c8443a}
.row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px}.tiny{font-size:12px;color:#a2937a;text-align:center;margin-top:12px}.hidden{display:none}
`;

function loginPage(message = '') {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dead Desert – Anmeldung</title><style>${STYLE}</style></head><body>
<div class="box"><h1>DEAD DESERT</h1><p class="sub" id="sub">Anmeldung erforderlich</p>
<div id="msg">${message ? `<div class="err">${message.replace(/[<>&]/g, '')}</div>` : ''}</div>
<form id="f"><label>Benutzername<input id="u" autocomplete="username" required></label>
<label>Passwort<input id="p" type="password" autocomplete="current-password" required></label>
<button id="go">Anmelden</button></form>
<div id="sso" class="hidden"><div class="sep">oder</div><a class="btn" id="ssob" href="/auth/oidc/start">Mit SSO anmelden</a></div>
<p class="tiny" id="hint"></p></div>
<script>
const $=id=>document.getElementById(id);let setup=false;
async function init(){const s=await (await fetch('/auth/status')).json();setup=s.setup;
 if(s.disabled){location='/';return}
 if(setup){$('sub').textContent='Ersteinrichtung: Der erste Account wird Administrator.';$('go').textContent='Admin-Account anlegen';$('p').autocomplete='new-password';$('hint').textContent='Danach ist die Registrierung geschlossen – weitere Konten legt der Admin an.'}
 if(s.oidc){$('sso').classList.remove('hidden');$('ssob').textContent=(setup?'Admin per ':'Anmelden mit ')+s.oidcName+(setup?' registrieren':'')}
 const me=await fetch('/auth/me');if(me.ok)location='/';}
$('f').onsubmit=async e=>{e.preventDefault();$('msg').innerHTML='';
 const r=await fetch(setup?'/auth/register':'/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('u').value,password:$('p').value})});
 const j=await r.json();if(r.ok)location='/';else $('msg').innerHTML='<div class="err"></div>',$('msg').firstChild.textContent=j.error||'Fehler'};
init();
</script></body></html>`;
}

function adminPage() {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Dead Desert – Admin</title><style>${STYLE}</style></head><body>
<div class="box wide"><h2>Benutzerverwaltung</h2>
<div id="msg"></div>
<table><thead><tr><th>Name</th><th>E-Mail</th><th>Rolle</th><th>Login-Art</th><th>Letzter Login</th><th></th></tr></thead><tbody id="rows"></tbody></table>
<h2 style="margin-top:22px">Konto anlegen</h2>
<form id="f"><div class="row"><label>Benutzername<input id="n" required></label><label>E-Mail (für SSO nötig)<input id="e" type="email"></label>
<label>Art<select id="k"><option value="local">Lokal (Passwort)</option><option value="sso">SSO-Freischaltung (per E-Mail)</option></select></label>
<label>Passwort (min. 8)<input id="pw" type="password" autocomplete="new-password"></label><label>Rolle<select id="r"><option value="user">Spieler</option><option value="admin">Admin</option></select></label></div>
<button>Konto anlegen</button></form>
<h2 style="margin-top:22px">Einstellungen</h2>
<label><input type="checkbox" id="auto" style="width:auto"> SSO-Benutzer automatisch anlegen (jeder, der sich bei deinem SSO anmelden kann, darf spielen)</label>
<p class="tiny" id="info"></p>
<a class="btn" href="/">Zum Spiel</a></div>
<script>
const $=id=>document.getElementById(id);const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const say=(t,ok)=>{$('msg').innerHTML='<div class="'+(ok?'ok':'err')+'"></div>';$('msg').firstChild.textContent=t};
async function api(p,m='GET',b){const r=await fetch(p,{method:m,headers:{'Content-Type':'application/json'},body:b?JSON.stringify(b):undefined});const j=await r.json().catch(()=>({}));if(!r.ok)throw new Error(j.error||r.status);return j}
async function load(){const j=await api('/api/admin/users');$('auto').checked=j.settings.ssoAutoCreate;$('info').textContent='Gerade online (WebSocket): '+j.online+' · SSO '+(j.oidc?'aktiv':'nicht konfiguriert (OIDC_ISSUER/OIDC_CLIENT_ID setzen)');
 $('rows').innerHTML=j.users.map(u=>'<tr><td>'+esc(u.username)+'</td><td>'+esc(u.email)+'</td><td><span class="tag '+(u.role==='admin'?'admin':'')+'">'+u.role+'</span>'+(u.disabled?' <span class="tag off">gesperrt</span>':'')+'</td><td>'+u.provider+'</td><td>'+(u.lastLogin?new Date(u.lastLogin).toLocaleString():'–')+'</td><td>'
 +'<button class="small" data-a="role" data-id="'+u.id+'" data-v="'+u.role+'">'+(u.role==='admin'?'→ Spieler':'→ Admin')+'</button>'
 +'<button class="small" data-a="dis" data-id="'+u.id+'" data-v="'+u.disabled+'">'+(u.disabled?'Entsperren':'Sperren')+'</button>'
 +(u.provider==='local'?'<button class="small" data-a="pw" data-id="'+u.id+'">Passwort</button>':'')
 +'<button class="small" data-a="del" data-id="'+u.id+'">Löschen</button></td></tr>').join('')}
$('rows').onclick=async e=>{const b=e.target.closest('button');if(!b)return;const id=b.dataset.id;try{
 if(b.dataset.a==='role')await api('/api/admin/users/'+id,'PATCH',{role:b.dataset.v==='admin'?'user':'admin'});
 if(b.dataset.a==='dis')await api('/api/admin/users/'+id,'PATCH',{disabled:b.dataset.v!=='true'});
 if(b.dataset.a==='pw'){const p=prompt('Neues Passwort (min. 8 Zeichen):');if(!p)return;await api('/api/admin/users/'+id,'PATCH',{password:p});say('Passwort geändert',1)}
 if(b.dataset.a==='del'){if(!confirm('Konto wirklich löschen?'))return;await api('/api/admin/users/'+id,'DELETE')}
 load()}catch(err){say(err.message)}};
$('f').onsubmit=async e=>{e.preventDefault();try{await api('/api/admin/users','POST',{username:$('n').value,email:$('e').value,sso:$('k').value==='sso',password:$('pw').value,role:$('r').value});$('f').reset();say('Konto angelegt',1);load()}catch(err){say(err.message)}};
$('auto').onchange=()=>api('/api/admin/settings','POST',{ssoAutoCreate:$('auto').checked}).catch(e=>say(e.message));
load().catch(e=>say(e.message));
</script></body></html>`;
}
