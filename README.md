# DEAD DESERT

3D-Browser-Survival-Roadtrip mit **Three.js** (Vanilla JS, ES-Module, Vite).
Du wachst in einer verlassenen Garage mitten in einer toten Wüste auf. Dein Wagen liegt in Einzelteilen herum –
baue ihn zusammen, tanke, und fahr so weit du kannst. Die Welt ist endlos, prozedural und hat keine Straßen.

Alle Grafiken sind prozedural bzw. aus Primitiven/Low-Poly-Geometrie erzeugt, alle Sounds werden zur Laufzeit mit der
Web Audio API synthetisiert. Es werden keine fremden Assets verwendet.

## Schnellstart

```bash
npm install
npm run dev          # Spiel im Browser: http://localhost:5173
```

Mehrspieler-Server (optional, nur für Koop nötig):

```bash
npm run server                   # lokal, Port 8080
# oder als Container:
docker compose up --build        # http://localhost:8080 (liefert auch den gebauten Client aus)
```

Weitere Befehle: `npm run build` (Produktions-Build nach `dist/`), `npm run preview`, `npm test`
(Unit-Tests für Terrain/Weltgenerierung/Kollision/KI/Überleben sowie ein Stabilitätstest der Fahrphysik).

> Browser: aktuelles Chrome/Edge/Firefox mit WebGL2. Die Maus wird per Pointer Lock gesteuert – Klick ins Fenster startet/setzt fort.
> Touch-Geräte werden automatisch erkannt (virtueller Joystick + Buttons); mit `?touch=1` lässt sich der Touch-Modus erzwingen.

## Steuerung

| Taste | Aktion |
|---|---|
| `WASD` / Maus | Bewegen / Umsehen |
| `Shift` · `Leertaste` · `Strg` | Sprinten · Springen · Ducken |
| `E` | Aufheben / Einsteigen / Aussteigen / Teil einbauen (**halten**) / auf Ladefläche legen |
| `F` oder Linksklick | Gegenstand benutzen: essen, trinken, Medkit, Taschenlampe, Lagerfeuer, **tanken** (halten), Auto **reparieren**, Waffe/Nahkampf |
| `Q` / `G` | Fallen lassen / Werfen (auch auf die Ladefläche) |
| `1`–`5`, Mausrad | Hotbar |
| `R` | Im Auto: Motor an/aus · zu Fuß: Waffe nachladen |
| Im Auto: `W`/`S`, `A`/`D` | Gas / Bremse (Rückwärts), Lenken |
| Im Auto: `Leertaste`, `H`, `L`, `C` | Handbremse, Hupe, Licht, Kamera (Cockpit/Verfolger) |
| `Tab` / `I` | Inventar (Klick: verschieben, Rechtsklick: benutzen) |
| `T` | Chat (Mehrspieler) |
| `F3` | Debug (FPS, Koordinaten, Chunk-Grenzen, Seed) |
| `Esc` | Pausenmenü (Speichern, Einstellungen, Export) |

Alle Tasten lassen sich unter *Einstellungen → Tastenbelegung* ändern.

## Spielablauf

1. **Teile sammeln.** Motor, Batterie, Zündkerzen, Radiator und zwei Räder liegen in der Garage (Werkbank, Regale, Boden).
   Der **Schuppen im Westen** (grüner Kompass-Marker) hält Tank, zwei weitere Räder, Türen und Motorhaube bereit,
   die **Tankstelle im Südosten** (gelber Marker) hat Zapfsäulen mit Sprit.
2. **Einbauen.** Teil in die Hände nehmen, auf das Auto zielen (grüner Geist zeigt den Einbaupunkt) und `E` halten.
   Pflicht: Motor, Batterie, Tank, 4 Räder, Zündkerzen (nach dem Motor). Optional: Kühler, Türen, Haube
   (ohne Kühler überhitzt der Motor viel schneller).
3. **Tanken.** Kanister an der Zapfsäule füllen (`F` halten), dann am Auto auskippen (`F` halten).
4. **Losfahren.** Einsteigen, `R` zum Starten (bei verschlissenem Motor/Zündkerzen kann der Start misslingen).
5. **Überleben.** Hunger, Durst, Ausdauer, Gesundheit und Körpertemperatur im Blick behalten. Tagsüber brennt die Sonne
   (mehr Durst), nachts wird es eiskalt – Lagerfeuer (3 Holz + Feuerzeug) und der geheizte Innenraum wärmen.
   Nachts und in Ruinen lauern Zombies; Hupe, laufender Motor, Licht und Lagerfeuer locken sie an.
   Sandstürme reduzieren die Sicht drastisch.
6. Beim Tod erscheint eine Statistik (Kilometer, Tage, Kills). Danach: *gleicher Seed* oder *neue Welt*.

## Funktionsumfang

- **Endlose Welt:** 128-m-Chunks, Seed-basiertes Simplex-Noise (Dünen, Felsplateaus, Canyons, Salzebenen), LOD pro Chunk
  (48/32/16/12 Segmente), Skirts gegen Nähte, Nebel, Frustum Culling, Instancing für Felsen und Pflanzen,
  Chunks werden um den Spieler geladen/entladen.
- **Points of Interest:** Tankstellen (funktionierende Zapfsäulen mit begrenztem Vorrat), Häuserruinen, Autowracks,
  Wassertürme, Funkmasten, Siedlungen, Militärposten – jeweils mit Loot-Tabellen und Zombie-Spawns.
- **Fahrzeug:** eigene Raycast-Vehicle-Physik (4 Federbeine mit Dämpfern, Reibungskreis pro Rad, Grip auf Sand/Fels/Salz,
  Handbremse/Drift, Automatik-Getriebe, Rollwiderstand im Sand, Aufsetzen/Überschlag). Werte: Treibstoff, Motorzustand,
  Batterie (Anlasser, Lichter, Lichtmaschine), Reifenzustand, Kühlwassertemperatur (Überhitzung bei Vollgas), Karosserie.
  Verschleiß beim Fahren, Unfallschäden, Reifenpannen. Ladefläche: Gegenstände bleiben physisch beim Fahren darin.
  Armaturenbrett mit Tacho, Drehzahl, Tank, Temperatur, Batterie, Reifen, Kilometerzähler.
- **Gegenstände:** physisch (aufheben, tragen, werfen), Taschen-Inventar + Hotbar, große Teile nur in den Händen,
  stapelbare Munition/Holz, Kanister mit Füllstand, Werkzeugkasten, Reifenflickzeug, Waffen mit Magazin/Nachladen.
- **Gegner:** KI-Zustände *wandern → hören/sehen → untersuchen → verfolgen → angreifen*; verschiedene Typen
  (normal, Läufer, Brocken); sie greifen auch das Auto an; Überfahren verursacht Schaden (Auto leicht beschädigt);
  Treffer-Feedback, Kopfschüsse, Umfall-Animation.
- **Atmosphäre:** Tag-Nacht-Zyklus (20 Min/Tag), Sonnenstand, Sterne, Mond, kalte Nächte, Sandstürme mit Nebel und
  Partikeln, Wärmeflimmern, Sonnenblendung, ausgeblichener Look (eigene Post-Processing-Stufe).
- **Sound:** komplett prozedural (Motor nach Drehzahl, Wind, Schritte, Zombie-Stöhnen, Schüsse, Hupe, Anlasser …).
- **Speichern:** IndexedDB, Autosave alle 60 s + manuell, mehrere Spielstände, Export/Import als JSON.
  Gespeichert werden Seed, Spielerwerte, Inventar, Auto-Zustand, veränderte Welt (aufgesammelte/verschobene
  Gegenstände, Zapfsäulen-Füllstände, Lagerfeuer), Tageszeit.
- **Mehrspieler (Koop):** Host erstellt eine Lobby (Seed), andere treten per 6-stelligem Code bei.
  Synchronisiert werden Spieler, Auto (Fahrer + Beifahrer), Gegenstände, Zapfsäulen, Feuer und Zombies
  (server-autoritativ – der Server nutzt dieselbe Weltgenerierung und KI-Simulation wie der Client).
  Namen über den Köpfen, Chat mit `T`.

## Projektstruktur

```
index.html               Einstieg, HUD- und Menü-Markup
src/
  main.js                Bootstrap, Menü-/Spielstand-/Mehrspieler-Glue
  game.js                Spielkern: Renderer, Schleife, Verkabelung aller Systeme
  core/                  RNG/Hashing, Einstellungen (Tastenbelegung), Input (Pointer Lock, Touch)
  world/                 Terrain (heightfield), Chunk-Manager, Weltgenerierung/POIs, Kollision,
                         Himmel/Wetter/Post-FX, Partikel, Primitive-Mesher
  vehicle/               Fahrzeugdefinition, Mesh, Physik/Systeme (car.js)
  player/                Controller, Vitalwerte, Inventar, Viewmodel, Kampf, Interaktion
  items/                 Gegenstandsdefinitionen/-modelle, physischer ItemManager
  ai/                    Zombie-Simulation (rein, auch serverseitig) und Darstellung
  ui/                    HUD, Menüs, Inventar-UI, Icons (3D-gerendert), Touch-Steuerung, CSS
  audio/                 prozedurale Sounds (Web Audio)
  save/                  IndexedDB-Speicherstände
  net/                   WebSocket-Client, Mitspieler-Darstellung, Mehrspieler-Anbindung
server/server.js         Mehrspieler-Server (ws), liefert optional dist/ aus
tests/unit.mjs           Unit-Tests (Terrain, Weltgen, Kollision, KI, Überleben)
tests/car.mjs            Stabilitäts-/Plausibilitätstests der Fahrphysik
Dockerfile, docker-compose.yml
```

## Anmeldung, Accounts und SSO

Im Server-Betrieb (`npm run server` / Docker) ist **alles hinter einer Anmeldung**: ohne Session sieht man nur die Login-Seite,
Client-Dateien und WebSocket sind gesperrt.

- **Erster Account = Admin.** Beim allerersten Aufruf von `/login` kann einmalig ein Account registriert werden – lokal
  (Benutzername + Passwort) **oder per SSO**. Dieser Account wird Administrator. Danach ist die Registrierung geschlossen.
- **Weitere Konten legt der Admin an** unter `/admin` (Link im Hauptmenü): lokale Konten mit Passwort, oder
  *SSO-Freischaltung* per E-Mail-Adresse (der Nutzer meldet sich dann einfach per SSO an und wird verknüpft).
  Optional kann der Admin „SSO-Benutzer automatisch anlegen" einschalten.
  Der Admin kann Rollen ändern, Konten sperren/löschen und Passwörter zurücksetzen (der letzte Admin ist geschützt).
- **SSO (OpenID Connect, Authorization-Code-Flow mit PKCE)** – funktioniert mit Authentik, Keycloak, Authelia, Google u. a.:

  | Variable | Bedeutung |
  |---|---|
  | `OIDC_ISSUER` | Issuer-URL (Discovery unter `<issuer>/.well-known/openid-configuration`) |
  | `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` | Zugangsdaten der Anwendung |
  | `OIDC_NAME` | Beschriftung des Buttons (z. B. `Authentik`) |
  | `PUBLIC_URL` | öffentliche Adresse, z. B. `https://spiel.example.de` |

  Redirect-URI im Provider: `<PUBLIC_URL>/auth/oidc/callback`. Scopes: `openid profile email`.
  *Authentik:* Provider vom Typ „OAuth2/OpenID", Client-Typ „Confidential", Redirect-URI wie oben, Scopes `openid email profile`.
- Passwörter werden mit scrypt gehasht, Sessions liegen als Hash serverseitig (HttpOnly-Cookie, SameSite=Lax, 30 Tage),
  Login ist gegen Brute-Force gedrosselt, schreibende Aufrufe prüfen den Origin.
- Daten (Accounts, Sessions, Bestenliste) liegen in `DATA_DIR` (`/data`, Docker-Volume `deaddesert-data`).
- Mehrspieler-Namen kommen vom Account (nicht fälschbar). Spielstände im Browser sind pro Account getrennt.
- Nur für lokale Tests: `AUTH_DISABLED=1`. Im reinen `npm run dev` ohne Server gibt es keine Anmeldung (Proxy auf Port 8080
  nutzen, wenn `npm run server` parallel läuft).

## Zusatzfunktionen

- **Autoradio** (`N`): drei prozedural erzeugte Sender (ruhiger Wüsten-Sound, Rock-Riff, Rauschen/Zahlenfunk); braucht Batterie.
- **Karte** (`M`, `+`/`−` Zoom): zeigt entdeckte Orte (Garage, Schuppen, Tankstellen, Siedlungen …), dich, das Auto, Lagerfeuer und Mitspieler.
- **Bestenliste** im Hauptmenü: weiteste Fahrten aller Accounts und die eigenen letzten Läufe.
- **Wolken** am Himmel, die sich mit Tageszeit und Sandsturm einfärben.

## Mehrspieler

1. Server starten (`npm run server` oder `docker compose up --build`).
2. Hauptmenü → *Mehrspieler*. Server-URL: im Dev-Betrieb `ws://localhost:8080`; wird der Client vom Server selbst
   ausgeliefert (Docker), ist sie automatisch korrekt (`ws(s)://<host>`).
3. Einer erstellt eine Lobby (optional mit Seed) und teilt den **Code**, die anderen treten bei.
4. Spielstände gibt es im Mehrspieler nicht (Lobby lebt, solange Spieler verbunden sind bzw. 5 Minuten danach).
   Bei Tod: *Respawn* in derselben Lobby.

Umgebungsvariablen des Servers: `PORT` (8080), `MAX_PLAYERS` (8).

## Performance

Ziel sind stabile 60 FPS auf einem Mittelklasse-Laptop:

- Grafikqualität *Niedrig/Mittel/Hoch* (Schatten, Auflösung, MSAA, Partikel, LOD), Sichtweite 2–9 Chunks.
- Chunk-Erzeugung auf höchstens einen Chunk pro Frame verteilt, Terrain-LOD-Rebuilds begrenzt.
- Instancing für Felsen, Pflanzen und **Loot** (ein `InstancedMesh` pro Gegenstandstyp, nur Ladeflächen-Items sind eigene Meshes),
  ein zusammengeführtes Mesh pro Chunk-Struktur.
- Physik nur in Spielernähe: Gegenstände werden jenseits von 110 m eingefroren, jenseits von 140 m ausgeblendet;
  das Auto schläft, wenn es steht; Zombies werden jenseits von 170 m entfernt.
- Feste Anzahl dynamischer Lichter (keine Shader-Neukompilierung).
- Debug-Overlay (`F3`) zeigt FPS, Draw-Calls, Dreiecke, Chunks, Koordinaten und Netzwerkstatistik.

## Hinweise zu Design-Entscheidungen

- Die Fahrphysik ist eine eigene Raycast-Vehicle-Implementierung gegen die Höhenfunktion des Terrains
  (statt cannon-es/Rapier mit Heightfield-Collidern): das passt zur endlosen Welt, ist schnell und gleichzeitig
  deterministisch genug für den Mehrspieler-Abgleich (der Fahrer simuliert, andere interpolieren).
- Weltveränderungen werden nicht als Chunk-Dateien, sondern als Differenz zur deterministischen Generierung gespeichert
  (aufgenommene Loot-IDs, abgelegte Gegenstände, Zapfsäulen, Feuer) – das hält Spielstände klein.
