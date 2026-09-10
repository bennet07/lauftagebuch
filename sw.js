/* Service Worker für das Lauftagebuch – Offline-Betrieb.
   Bei jeder Änderung an dieser Datei die Versionsnummer erhöhen. */
const CACHE = 'lauftagebuch-v1';

const PFLICHT = ['./', './index.html'];
const SYMBOL = './apple-touch-icon-180.png';

/* Holt eine Datei am HTTP-Zwischenspeicher vorbei und legt sie ab.
   Nur erfolgreiche Antworten (200–299) werden gespeichert. */
async function ablegen(cache, pfad) {
  const antwort = await fetch(new Request(pfad, { cache: 'reload' }));
  if (!antwort.ok) throw new Error(pfad + ': ' + antwort.status);
  await cache.put(pfad, antwort);
}

self.addEventListener('install', (ereignis) => {
  self.skipWaiting();
  ereignis.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    /* Jede Datei einzeln: Das Symbol darf fehlschlagen, ohne den Worker
       mitzureißen. Scheitert eine Pflichtdatei, scheitert der install –
       ein Worker ohne HTML im Cache wäre offline nutzlos, der bisherige
       bleibt dann im Einsatz. */
    const ergebnisse = await Promise.allSettled([
      ...PFLICHT.map((pfad) => ablegen(cache, pfad)),
      ablegen(cache, SYMBOL)
    ]);
    const pflichtFehler = ergebnisse.slice(0, PFLICHT.length)
      .find((ergebnis) => ergebnis.status === 'rejected');
    if (pflichtFehler) throw pflichtFehler.reason;
  })());
});

self.addEventListener('activate', (ereignis) => {
  ereignis.waitUntil((async () => {
    const namen = await caches.keys();
    await Promise.all(namen
      .filter((name) => name.startsWith('lauftagebuch-') && name !== CACHE)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function istHtml(anfrage, adresse) {
  return anfrage.mode === 'navigate' ||
    anfrage.destination === 'document' ||
    adresse.pathname.endsWith('/') ||
    adresse.pathname.endsWith('.html');
}

self.addEventListener('fetch', (ereignis) => {
  const anfrage = ereignis.request;

  /* 1. Nur GET – alles andere geht unberührt ans Netz. */
  if (anfrage.method !== 'GET') return;

  /* 2. Nur gleiche Herkunft – api.github.com läuft vollständig vorbei. */
  const adresse = new URL(anfrage.url);
  if (adresse.origin !== self.location.origin) return;

  /* 3. Navigation und HTML: Netzwerk zuerst, Cache nur als Rückfall. */
  if (istHtml(anfrage, adresse)) {
    ereignis.respondWith(netzZuerst(ereignis, anfrage, adresse));
    return;
  }

  /* 4. Übriges gleicher Herkunft (das Symbol): Cache zuerst, sonst Netz. */
  ereignis.respondWith((async () => {
    const treffer = await caches.match(anfrage, { ignoreSearch: true });
    return treffer || fetch(anfrage);
  })());
});

async function netzZuerst(ereignis, anfrage, adresse) {
  const cache = await caches.open(CACHE);
  try {
    /* no-cache: beim Server nachfragen statt eine womöglich veraltete Fassung
       aus dem HTTP-Zwischenspeicher zu nehmen – neue Fassungen kommen sofort an. */
    const antwort = await fetch(anfrage, { cache: 'no-cache' });
    if (antwort.ok) {
      /* Abgelegt ohne Anhang (?v=1 usw.), damit offline immer die zuletzt
         geladene Fassung gefunden wird. Start-Adresse und index.html sind
         dieselbe Datei, darum beide Einträge auffrischen. */
      const schluessel = adresse.origin + adresse.pathname;
      const wurzel = new URL('./', self.registration.scope).href;
      const eintraege = (schluessel === wurzel || schluessel === wurzel + 'index.html')
        ? ['./', './index.html']
        : [schluessel];
      ereignis.waitUntil(Promise.all(eintraege.map((eintrag) =>
        cache.put(eintrag, antwort.clone()))).catch(() => {}));
    }
    return antwort;
  } catch (fehler) {
    const treffer = await cache.match(anfrage, { ignoreSearch: true }) ||
      await cache.match('./');
    if (treffer) return treffer;
    throw fehler;
  }
}
