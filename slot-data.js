/* =====================================================================
   SLOT REGNO — dati di gioco (contenuto roguelite)
   Tutto il "contenuto" sta qui: simboli, cimeli, modificatori, boss.
   Il motore (slot.js) legge solo queste strutture.
   ===================================================================== */

const TUNING = {
  ROUND_TOTALI: 24,          // round 24 = boss finale, poi modalità infinita
  ROUND_PER_LIVELLO: 3,

  OBIETTIVO_BASE: 30,        // obiettivo del round 1
  OBIETTIVO_CRESCITA: 1.95,  // per livello
  OBIETTIVO_TIPO: [1, 1.5, 1.9],  // piccola, grande, boss

  FONDO_PCT: 0.40,           // fondo cassa iniziale = % dell'obiettivo…
  FONDO_MIN_GIRI: 0.80,      // …mai meno di (giri × tetto × questo)…
  FONDO_MAX_PCT: 0.72,       // …e mai più di questa frazione dell'obiettivo
  GIRI_BASE: 9,

  TETTO_BASE: 5,
  TETTO_CRESCITA: 1.36,      // per livello
  TETTO_UPGRADE: 1.22,       // per potenziamento comprato

  SLOT_CIMELI: 4,
  SLOT_CONSUMABILI: 2,

  PREMIO_TIPO: [4, 5, 7],    // gettoni base per piccola / grande / boss
  PREMIO_GIRO: 1,            // gettoni per giro avanzato
  PREMIO_GIRO_MAX: 6,
  INTERESSE_OGNI: 5,
  INTERESSE_MAX: 5,

  NEGOZIO_CIMELI: 2,
  NEGOZIO_ALTRO: 3,
  REROLL_BASE: 2,
  REROLL_INCR: 1,

  /* combo — VINCITA = puntata × VAL × MOLT ÷ 10
     coppia: VAL = 5×valore + 20, MOLT 1   → paga 2,5…6 volte la puntata
     tris  : VAL = 10×valore + 40, MOLT 3  → paga 15…36 volte la puntata */
  DIVISORE: 10,
  VAL_COPPIA_BASE: 20, VAL_COPPIA_SIM: 5, MOLT_COPPIA: 1,
  VAL_TRIS_BASE: 40, VAL_TRIS_SIM: 10, MOLT_TRIS: 3,
};

/* ---------------------------------------------------------------- SIMBOLI */
const SIMBOLI = [
  { id: 'seven',      nome: 'Sette',            valore: 12, img: 'img/seven.png' },
  { id: 'star',       nome: 'Stella',           valore: 8,  img: 'img/star.png' },
  { id: '1up',        nome: 'Fungo 1UP',        valore: 7,  img: 'img/1up.png' },
  { id: 'iceflower',  nome: 'Fiore di Ghiaccio',valore: 6,  img: 'img/iceflower.png' },
  { id: 'fireflower', nome: 'Fiore di Fuoco',   valore: 5,  img: 'img/fireflower.png' },
  { id: 'mushroom',   nome: 'Super Fungo',      valore: 4,  img: 'img/mushroom.png' },
  { id: 'coin',       nome: 'Moneta',           valore: 3,  img: 'img/coin.png' },
  { id: 'cherry',     nome: 'Ciliegia',         valore: 2,  img: 'img/cherry.png' },
  { id: 'onion',      nome: 'Cipolla',          valore: 2,  img: 'img/onion.png' },
  { id: 'goomba',     nome: 'Goomba',           valore: 1,  img: 'img/goomba.png', nemico: true },
  { id: 'shyguy',     nome: 'Shy Guy',          valore: 1,  img: 'img/shyguy.png', nemico: true },
];

const SIM = {};
SIMBOLI.forEach(s => SIM[s.id] = s);

// striscia di partenza, uguale sui tre rulli (6 simboli: combo frequenti ma diluibili)
const RULLO_INIZIALE = ['goomba', 'shyguy', 'cherry', 'coin', 'fireflower', 'star'];

// simboli che il negozio può offrire di aggiungere (i pregiati costano di più)
const SIMBOLI_NEGOZIO = ['coin', 'mushroom', 'fireflower', 'iceflower', '1up', 'star', 'seven'];

/* ----------------------------------------------------------------- CIMELI
   Ganci disponibili:
     mods         : { giri, fondoPct, tettoMult, ... } modificatori passivi
     onRoundStart(g)
     punteggio(c, g) : c = contesto di punteggio, si modificano c.val / c.molt
     onGiro(g, res)  : dopo il pagamento del giro
     costoGiro(g, costo) -> nuovo costo
     onRoundEnd(g, r): r.gettoni += ...
     vel(i)          : moltiplicatore di velocità del rullo i
   -------------------------------------------------------------------- */
const CIMELI = [
  { id: 'fungodoro', nome: "Fungo d'Oro", ico: '🍄', rar: 0, prezzo: 5,
    desc: '+15 VAL per ogni Super Fungo sulla linea.',
    punteggio: (c) => { const n = c.ids.filter(i => i === 'mushroom').length; if (n) { c.val += 15 * n; c.note.push('+' + (15 * n) + ' VAL'); } } },

  { id: 'fiorefuoco', nome: 'Fiore di Fuoco', ico: '🔥', rar: 0, prezzo: 5,
    desc: '+1 MOLT se sulla linea c\'è un Fiore di Fuoco.',
    punteggio: (c) => { if (c.ids.includes('fireflower')) { c.molt += 1; c.note.push('+1 MOLT'); } } },

  { id: 'tuboverde', nome: 'Tubo Verde', ico: '🟩', rar: 0, prezzo: 5,
    desc: 'Quando non vinci, recuperi metà della puntata.',
    punteggio: (c) => { if (c.combo === 'niente') c.rimborso = Math.max(c.rimborso, 0.5); } },

  { id: 'blocco', nome: 'Blocco ?', ico: '❓', rar: 0, prezzo: 6,
    desc: 'Il primo giro di ogni round ha MOLT ×3.',
    punteggio: (c, g) => { if (g.giroNum === 1 && c.combo !== 'niente') { c.molt *= 3; c.note.push('MOLT ×3'); } } },

  { id: 'stellainv', nome: 'Stella Invincibile', ico: '⭐', rar: 1, prezzo: 8,
    desc: 'Ogni 5° giro del round è gratuito.',
    costoGiro: (g, costo, n) => (n % 5 === 0 ? 0 : costo) },

  { id: 'pswitch', nome: 'P-Switch', ico: '🔵', rar: 0, prezzo: 5,
    desc: 'I Goomba valgono 5 invece di 1.',
    valoreSimbolo: (id, v) => (id === 'goomba' ? 5 : v) },

  { id: 'gusciorosso', nome: 'Guscio Rosso', ico: '🔴', rar: 0, prezzo: 5,
    desc: 'Dopo un giro perdente, il successivo ha +2 MOLT.',
    punteggio: (c, g) => { if (g.giroPrecedentePerso && c.combo !== 'niente') { c.molt += 2; c.note.push('+2 MOLT'); } } },

  { id: 'guscioblu', nome: 'Guscio Blu', ico: '🔷', rar: 1, prezzo: 7,
    desc: 'Con tre simboli diversi ti riprendi comunque la puntata.',
    punteggio: (c) => { if (c.combo === 'niente') c.rimborso = Math.max(c.rimborso, 1); } },

  { id: 'piuma', nome: 'Piuma', ico: '🪶', rar: 1, prezzo: 8,
    desc: '+1 giro in ogni round.', mods: { giri: 1 } },

  { id: 'monetafortunata', nome: 'Moneta Fortunata', ico: '🍀', rar: 0, prezzo: 5,
    desc: '+2 gettoni per ogni tris che realizzi.',
    onGiro: (g, res) => { if (res.combo === 'tris') { g.gettoniExtra += 2; res.note.push('+2 🎟️'); } } },

  { id: 'cronometro', nome: 'Cronometro', ico: '⏱️', rar: 0, prezzo: 5,
    desc: 'Ogni giro avanzato vale 2 gettoni invece di 1.', mods: { premioGiro: 1 } },

  { id: 'salvadanaio', nome: 'Salvadanaio', ico: '🐷', rar: 0, prezzo: 4,
    desc: '+3 gettoni alla fine di ogni round.',
    onRoundEnd: (g, r) => { r.gettoni += 3; r.righe.push(['Salvadanaio', 3]); } },

  { id: 'interesse', nome: 'Interesse Composto', ico: '🏦', rar: 1, prezzo: 7,
    desc: 'Interesse: 1 gettone ogni 3 posseduti (max 8).',
    mods: { interesseOgni: 3, interesseMax: 8 } },

  { id: 'martellobowser', nome: 'Martello di Bowser', ico: '🔨', rar: 1, prezzo: 7,
    desc: '+2 MOLT su ogni vincita, ma −1 giro per round.',
    mods: { giri: -1 },
    punteggio: (c) => { if (c.combo !== 'niente') { c.molt += 2; c.note.push('+2 MOLT'); } } },

  { id: 'kamek', nome: 'Bacchetta di Kamek', ico: '🪄', rar: 2, prezzo: 10,
    desc: 'A inizio round un simbolo a caso diventa Jolly per tutto il round.',
    onRoundStart: (g) => { const pool = g.simboliInGioco(); g.jollyRound = pool[g.rndInt(pool.length)]; } },

  { id: 'lakitucloud', nome: 'Nuvola di Lakitu', ico: '☁️', rar: 1, prezzo: 8,
    desc: 'Il simbolo Lucky moltiplica ×3 invece di ×2.', mods: { luckyMult: 3 } },

  { id: 'boo', nome: 'Boo', ico: '👻', rar: 2, prezzo: 10,
    desc: 'Le coppie hanno il 25% di contare come tris.',
    preCombo: (c, g) => { if (c.combo === 'coppia' && g.rnd() < 0.25) { c.promuoviTris = true; c.note.push('TRIS FANTASMA!'); } } },

  { id: 'bobomb', nome: 'Bob-omb', ico: '💣', rar: 1, prezzo: 7,
    desc: 'Dopo 3 giri persi di fila, il giro successivo ha MOLT ×5.',
    punteggio: (c, g) => { if (g.perseDiFila >= 3 && c.combo !== 'niente') { c.molt *= 5; c.note.push('BOOM! MOLT ×5'); } } },

  { id: 'guantowario', nome: 'Guanto di Wario', ico: '🧤', rar: 1, prezzo: 8,
    desc: '+8% al tetto di puntata alla fine di ogni round (cumulativo).',
    onRoundEnd: (g) => { g.tettoBonus = (g.tettoBonus || 1) * 1.08; } },

  { id: 'stivale', nome: 'Stivale di Goomba', ico: '👢', rar: 0, prezzo: 5,
    desc: 'Goomba e Shy Guy contano come lo stesso simbolo.',
    aliasSimbolo: (id) => (id === 'shyguy' ? 'goomba' : id) },

  { id: 'trifoglio', nome: 'Trifoglio', ico: '☘️', rar: 2, prezzo: 11,
    desc: 'Il 3° rullo ha il 20% di copiare il 2°.',
    truccaRulli: (g, ids) => { if (g.rnd() < 0.20) ids[2] = ids[1]; } },

  { id: 'lente', nome: 'Lente di Ingrandimento', ico: '🔍', rar: 0, prezzo: 4,
    desc: 'I rulli girano il 25% più lenti: è più facile mirare.',
    vel: () => 0.75 },

  { id: 'linguayoshi', nome: 'Lingua di Yoshi', ico: '👅', rar: 1, prezzo: 6,
    desc: 'Se sulla linea c\'è un nemico: +20 VAL e +1 MOLT.',
    punteggio: (c) => { if (c.ids.some(i => SIM[i] && SIM[i].nemico)) { c.val += 20; c.molt += 1; c.note.push('Gnam! +20 VAL +1 MOLT'); } } },

  { id: 'corona', nome: 'Corona', ico: '👑', rar: 2, prezzo: 12,
    desc: 'MOLT ×2 su ogni vincita.',
    punteggio: (c) => { if (c.combo !== 'niente') { c.molt *= 2; c.note.push('MOLT ×2'); } } },

  { id: 'fungovelenoso', nome: 'Fungo Velenoso', ico: '🍄‍🟫', rar: 1, prezzo: 6,
    desc: '+45 VAL su ogni vincita, ma −2 gettoni a fine round.',
    punteggio: (c) => { if (c.combo !== 'niente') { c.val += 45; c.note.push('+45 VAL'); } },
    onRoundEnd: (g, r) => { r.gettoni -= 2; r.righe.push(['Fungo Velenoso', -2]); } },

  { id: 'cassaforte', nome: 'Cassaforte', ico: '🔐', rar: 1, prezzo: 8,
    desc: '+20% al fondo cassa iniziale di ogni round.', mods: { fondoPct: 0.20 } },

  { id: 'fuochi', nome: "Fuochi d'Artificio", ico: '🎆', rar: 1, prezzo: 8,
    desc: 'Ogni tris ti restituisce 1 giro.',
    onGiro: (g, res) => { if (res.combo === 'tris') { g.giriRimasti += 1; res.note.push('+1 giro'); } } },

  { id: 'calamita', nome: 'Calamita', ico: '🧲', rar: 1, prezzo: 9,
    desc: 'Il simbolo Lucky esce con probabilità doppia.',
    truccaRulli: (g, ids) => {
      if (!g.lucky) return;
      for (let i = 0; i < 3; i++) if (ids[i] !== g.lucky && g.rnd() < 0.14 && g.rulli[i].includes(g.lucky)) ids[i] = g.lucky;
    } },

  { id: 'dadodoro', nome: "Dado d'Oro", ico: '🎲', rar: 0, prezzo: 5,
    desc: 'I reroll del negozio sono gratis.', mods: { rerollGratis: true } },

  { id: 'bandiera', nome: 'Bandiera del Traguardo', ico: '🏁', rar: 2, prezzo: 11,
    desc: 'I gettoni per i giri avanzati sono raddoppiati.', mods: { premioGiroX2: true } },

  { id: 'occhialilakitu', nome: 'Occhiali di Lakitu', ico: '🕶️', rar: 0, prezzo: 4,
    desc: '+15 VAL per ogni simbolo diverso sulla linea.',
    punteggio: (c) => { if (c.combo !== 'niente') { const n = new Set(c.ids).size; c.val += 15 * n; c.note.push('+' + (15 * n) + ' VAL'); } } },

  { id: 'settefortunato', nome: 'Sette Fortunato', ico: '7️⃣', rar: 2, prezzo: 10,
    desc: 'Ogni Sette sulla linea dà MOLT ×2.',
    punteggio: (c) => { const n = c.ids.filter(i => i === 'seven').length; if (n && c.combo !== 'niente') { c.molt *= Math.pow(2, n); c.note.push('MOLT ×' + Math.pow(2, n)); } } },

  { id: 'scarpachiodata', nome: 'Scarpa Chiodata', ico: '🥾', rar: 1, prezzo: 7,
    desc: 'I nemici (Goomba e Shy Guy) valgono 4 invece di 1.',
    valoreSimbolo: (id, v) => ((id === 'goomba' || id === 'shyguy') ? 4 : v) },
];

const CIMELI_BY_ID = {};
CIMELI.forEach(c => CIMELI_BY_ID[c.id] = c);

const RARITA = ['Comune', 'Raro', 'Leggendario'];

/* ----------------------------------------------- MODIFICATORI DI CASELLA
   Vanno su una delle 3 caselle della linea di pagamento.
   -------------------------------------------------------------------- */
const MODIFICATORI = [
  { id: 'x2', nome: '×2', ico: '✖️', prezzo: 6,
    desc: 'Se il simbolo di questa casella entra nella combo, la vincita è ×2.',
    punteggio: (c, g, i) => { if (c.part[i]) { c.molt *= 2; c.note.push('Casella ×2'); } } },

  { id: 'x3', nome: '×3', ico: '✳️', prezzo: 10,
    desc: 'Se il simbolo di questa casella entra nella combo, la vincita è ×3.',
    punteggio: (c, g, i) => { if (c.part[i]) { c.molt *= 3; c.note.push('Casella ×3'); } } },

  { id: 'val45', nome: '+45 VAL', ico: '➕', prezzo: 6,
    desc: 'Se il simbolo di questa casella entra nella combo, +45 VAL.',
    punteggio: (c, g, i) => { if (c.part[i]) { c.val += 45; c.note.push('+45 VAL'); } } },

  { id: 'jolly', nome: 'Jolly', ico: '🃏', prezzo: 12,
    desc: 'Il simbolo di questa casella conta come qualsiasi simbolo.',
    jolly: true },

  { id: 'oro', nome: 'Oro', ico: '💰', prezzo: 5,
    desc: 'Ogni volta che qui si ferma una Moneta: +3 gettoni.',
    onGiro: (g, res, i) => { if (res.ids[i] === 'coin') { g.gettoniExtra += 3; res.note.push('+3 🎟️'); } } },

  { id: 'fuoco', nome: 'Fuoco', ico: '🔥', prezzo: 6,
    desc: 'Se qui si ferma un nemico: +3 MOLT.',
    punteggio: (c, g, i) => { const s = SIM[c.ids[i]]; if (s && s.nemico) { c.molt += 3; c.note.push('+3 MOLT'); } } },

  { id: 'fortuna', nome: 'Fortuna', ico: '🎰', prezzo: 7,
    desc: '20% di riavere indietro la puntata, comunque vada.',
    punteggio: (c, g) => { if (g.rnd() < 0.20) { c.rimborso = Math.max(c.rimborso, 1); c.note.push('Rimborso!'); } } },

  { id: 'calamitaC', nome: 'Calamita', ico: '🧲', prezzo: 7,
    desc: 'Su questa casella il simbolo Lucky esce molto più spesso.',
    trucca: (g, ids, i) => { if (g.lucky && ids[i] !== g.lucky && g.rulli[i].includes(g.lucky) && g.rnd() < 0.3) ids[i] = g.lucky; } },

  { id: 'ghiaccio', nome: 'Ghiaccio', ico: '❄️', prezzo: 8,
    desc: 'Dopo una vincita, questa casella resta bloccata per il giro dopo.',
    congela: true },

  { id: 'prisma', nome: 'Prisma', ico: '🔮', prezzo: 8,
    desc: '+5 VAL per ogni punto di valore del simbolo di questa casella (se entra nella combo).',
    punteggio: (c, g, i) => { if (c.part[i]) { const v = 5 * g.valoreDi(c.ids[i]); c.val += v; c.note.push('+' + v + ' VAL'); } } },
];

const MOD_BY_ID = {};
MODIFICATORI.forEach(m => MOD_BY_ID[m.id] = m);

/* ------------------------------------------------------------ CONSUMABILI */
const CONSUMABILI = [
  { id: 'oneup', nome: 'Fungo 1UP', ico: '🍄', prezzo: 5,
    desc: '+3 giri subito, in questo round.',
    usa: (g) => { g.giriRimasti += 3; return '+3 giri'; } },

  { id: 'superstella', nome: 'Super Stella', ico: '🌟', prezzo: 7,
    desc: 'Il prossimo giro è un tris garantito del simbolo più prezioso dei rulli.',
    usa: (g) => { g.trisGarantito = true; return 'Prossimo giro: TRIS!'; } },

  { id: 'sacchetto', nome: 'Sacchetto di Monete', ico: '💰', prezzo: 5,
    desc: '+40% alla cassa attuale del round.',
    usa: (g) => { const d = Math.max(5, Math.round(g.cassa * 0.4)); g.cassa += d; return '+' + d + ' in cassa'; } },

  { id: 'quadrifoglio', nome: 'Quadrifoglio', ico: '🍀', prezzo: 6,
    desc: 'Il prossimo giro ha MOLT ×4.',
    usa: (g) => { g.moltProssimo = 4; return 'Prossimo giro MOLT ×4'; } },

  { id: 'martello', nome: 'Martello', ico: '🔨', prezzo: 4,
    desc: 'Distruggi un simbolo da un rullo.', bersaglio: 'simbolo',
    applica: (g, r, k) => { g.rulli[r].splice(k, 1); return 'Simbolo distrutto'; } },

  { id: 'pennello', nome: 'Pennello di Bowser Jr.', ico: '🖌️', prezzo: 6,
    desc: 'Trasforma un simbolo di un rullo in un altro a tua scelta.',
    bersaglio: 'simbolo+scelta',
    applica: (g, r, k, sid) => { g.rulli[r][k] = sid; return 'Simbolo trasformato'; } },

  { id: 'pow', nome: 'Blocco POW', ico: '💥', prezzo: 5,
    desc: 'Nel prossimo giro tutti i nemici sulla linea diventano Monete.',
    usa: (g) => { g.powProssimo = true; return 'POW pronto!'; } },

  { id: 'campanello', nome: 'Campanello', ico: '🔔', prezzo: 4,
    desc: 'Cambia il simbolo Lucky con uno a tua scelta.', bersaglio: 'lucky',
    applica: (g, r, k, sid) => { g.lucky = sid; return 'Nuovo Lucky: ' + SIM[sid].nome; } },

  { id: 'tubo', nome: 'Tubo Bonus', ico: '🚇', prezzo: 5,
    desc: 'Il prossimo giro è gratis (non paghi la puntata).',
    usa: (g) => { g.giroGratis = true; return 'Prossimo giro gratis'; } },

  { id: 'lingotto', nome: 'Lingotto', ico: '🧱', prezzo: 6,
    desc: 'Il prossimo giro paga il doppio.',
    usa: (g) => { g.doppioProssimo = true; return 'Prossimo giro ×2'; } },
];

const CONS_BY_ID = {};
CONSUMABILI.forEach(c => CONS_BY_ID[c.id] = c);

/* ------------------------------------------------------- POTENZIAMENTI FISSI
   Sempre disponibili in negozio, prezzo crescente.
   -------------------------------------------------------------------- */
const POTENZIAMENTI = [
  { id: 'tetto', nome: 'Tetto di Puntata', ico: '📈',
    desc: () => 'Alza del 22% la puntata massima.',
    prezzo: (n) => 4 + 3 * n + n * n, max: 10 },
  { id: 'giri', nome: 'Giro in più', ico: '🔁',
    desc: () => '+1 giro in ogni round.',
    prezzo: (n) => 7 + 4 * n, max: 6 },
  { id: 'fondo', nome: 'Fondo Cassa', ico: '🏦',
    desc: () => '+8% al fondo cassa di ogni round.',
    prezzo: (n) => 5 + 2 * n, max: 8 },
  { id: 'slotcimeli', nome: 'Mensola per Cimeli', ico: '🗄️',
    desc: () => '+1 posto per i cimeli.',
    prezzo: (n) => 12 + 8 * n, max: 2 },
  { id: 'slotcons', nome: 'Tasca in più', ico: '🎒',
    desc: () => '+1 posto per i consumabili.',
    prezzo: (n) => 9 + 6 * n, max: 2 },
];

/* ------------------------------------------------------------------- BOSS */
/* effetto: campi dichiarativi letti dal motore                              */
const BOSS = [
  { id: 'goombagigante', nome: 'Goomba Gigante', ico: '👹',
    desc: 'Un simbolo a caso è disattivato: non forma combo e vale 0.',
    eff: { disattivaSimbolo: 1 }, minLiv: 1 },

  { id: 'koopa', nome: 'Koopa Corazzato', ico: '🐢',
    desc: "L'obiettivo è più alto del 60%.",
    eff: { obiettivoMult: 1.6 }, minLiv: 1 },

  { id: 'lakitu', nome: 'Lakitu', ico: '☁️',
    desc: 'Il primo rullo gira al 60% più veloce.',
    eff: { velRullo: [1.6, 1, 1] }, minLiv: 1 },

  { id: 'billbala', nome: 'Bill Bala', ico: '🚀',
    desc: 'Tutti i rulli girano al 50% più veloce.',
    eff: { velTutti: 1.5 }, minLiv: 2 },

  { id: 'reboo', nome: 'Re Boo', ico: '👻',
    desc: 'I simboli sono invisibili mentre i rulli girano.',
    eff: { invisibile: true }, minLiv: 2 },

  { id: 'kamekboss', nome: 'Kamek', ico: '🧙',
    desc: 'I modificatori di casella sono disattivati.',
    eff: { modificatoriOff: true }, minLiv: 2 },

  { id: 'wario', nome: 'Wario', ico: '💸',
    desc: 'Tutte le vincite sono ridotte del 30%.',
    eff: { vinciteMult: 0.7 }, minLiv: 1 },

  { id: 'waluigi', nome: 'Waluigi', ico: '🍆',
    desc: 'Il tetto di puntata è dimezzato.',
    eff: { tettoMult: 0.5 }, minLiv: 2 },

  { id: 'bowserjr', nome: 'Bowser Jr.', ico: '🖌️',
    desc: 'Hai 3 giri in meno.',
    eff: { giriDelta: -3 }, minLiv: 1 },

  { id: 'thwomp', nome: 'Thwomp', ico: '🗿',
    desc: 'Il primo giro non paga nulla.',
    eff: { primoNonPaga: true }, minLiv: 1 },

  { id: 'piranha', nome: 'Pianta Piranha', ico: '🌱',
    desc: 'Due cimeli a caso sono disattivati per tutto il round.',
    eff: { cimeliOff: 2 }, minLiv: 3 },

  { id: 'fiammablu', nome: 'Fiamma Blu', ico: '🔵',
    desc: 'Le coppie non pagano: solo i tris.',
    eff: { soloTris: true }, minLiv: 3 },

  { id: 'fantasma', nome: 'Fantasma', ico: '👤',
    desc: 'Il simbolo Lucky è nascosto: non sai quale sia.',
    eff: { luckyNascosto: true }, minLiv: 1 },

  { id: 'chainchomp', nome: 'Chain Chomp', ico: '⛓️',
    desc: 'La puntata minima cresce di 1 a ogni giro.',
    eff: { puntataMinCresce: 1 }, minLiv: 2 },

  { id: 'torre', nome: 'Torre di Bowser', ico: '🏰',
    desc: "L'obiettivo cresce del 6% a ogni giro.",
    eff: { obiettivoCresce: 0.06 }, minLiv: 3 },

  { id: 'tartosso', nome: 'Tartosso', ico: '💀',
    desc: 'I nemici raddoppiano su tutti i rulli per questo round.',
    eff: { nemiciRaddoppiati: true }, minLiv: 2 },

  { id: 'wart', nome: 'Nebbia di Wart', ico: '🌫️',
    desc: 'Non vedi la cassa finché il round non finisce.',
    eff: { cassaNascosta: true }, minLiv: 2 },

  { id: 'petey', nome: 'Petey Piranha', ico: '🌺',
    desc: 'Le vincite oltre 15 volte la puntata vengono dimezzate.',
    eff: { capVincita: 15 }, minLiv: 3 },

  { id: 'roy', nome: 'Roy', ico: '🔒',
    desc: 'Il terzo rullo è bloccato su un simbolo a caso per tutto il round.',
    eff: { rulloBloccato: 2 }, minLiv: 3 },

  { id: 'morton', nome: 'Morton', ico: '🪨',
    desc: 'Il fondo cassa iniziale è dimezzato.',
    eff: { fondoMult: 0.5 }, minLiv: 2 },

  { id: 'ludwig', nome: 'Ludwig', ico: '🎼',
    desc: 'Devi puntare almeno metà del tetto a ogni giro.',
    eff: { puntataMinFrazione: 0.5 }, minLiv: 3 },

  { id: 'iggy', nome: 'Iggy', ico: '🌀',
    desc: "L'ordine dei simboli sui rulli cambia a ogni giro.",
    eff: { rimescola: true }, minLiv: 2 },
];

const BOSS_FINALE = {
  id: 'bowser', nome: 'BOWSER — Re dei Rulli', ico: '🐲',
  desc: "Obiettivo +40%, le coppie pagano metà, un simbolo è disattivato. L'ultima sfida.",
  finale: true,
  eff: { obiettivoMult: 1.4, coppieMeta: true, disattivaSimbolo: 1 },
};

/* boss "supremi" della modalità infinita: due malus insieme */
const BOSS_INFINITI = [
  { id: 'inf_dry', nome: 'Bowser Secco', ico: '☠️', desc: 'Obiettivo +40% e 2 giri in meno.', eff: { obiettivoMult: 1.4, giriDelta: -2 } },
  { id: 'inf_fant', nome: 'Legione di Boo', ico: '👻', desc: 'Simboli invisibili e Lucky nascosto.', eff: { invisibile: true, luckyNascosto: true } },
  { id: 'inf_mago', nome: 'Kamek Supremo', ico: '🔮', desc: 'Modificatori disattivati e 3 cimeli spenti.', eff: { modificatoriOff: true, cimeliOff: 3 } },
  { id: 'inf_avaro', nome: 'Wario & Waluigi', ico: '💰', desc: 'Vincite −35% e tetto dimezzato.', eff: { vinciteMult: 0.65, tettoMult: 0.5 } },
  { id: 'inf_veloce', nome: 'Tempesta di Bill', ico: '🌪️', desc: 'Rulli al doppio della velocità e solo i tris pagano.', eff: { velTutti: 2, soloTris: true } },
];

/* --------------------------------------------------------------- PAGAMENTI */
const PAYTABLE_TESTO = [
  ['Tris (3 uguali)', 'VAL = valore ×10 + 40   ·   MOLT = 3'],
  ['Coppia (2 uguali)', 'VAL = valore ×5 + 20   ·   MOLT = 1'],
  ['Niente', 'perdi la puntata'],
  ['Lucky sulla linea', 'vincita ×2'],
];

if (typeof module !== 'undefined') module.exports = { TUNING, SIMBOLI, SIM, RULLO_INIZIALE, SIMBOLI_NEGOZIO, CIMELI, CIMELI_BY_ID, MODIFICATORI, MOD_BY_ID, CONSUMABILI, CONS_BY_ID, POTENZIAMENTI, BOSS, BOSS_FINALE, BOSS_INFINITI, RARITA, PAYTABLE_TESTO };
