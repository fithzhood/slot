/* =====================================================================
   SLOT REGNO — motore + interfaccia
   ===================================================================== */
'use strict';

const SALVATAGGIO = 'slotregno_run_v2';

/* ============================== MOTORE ============================== */
class Gioco {
  constructor(seed) {
    this.seedIniziale = seed;
    this.setSeed(seed);
  }

  /* ---- casualità (seminabile, così il simulatore è ripetibile) ---- */
  setSeed(seed) {
    if (seed === undefined || seed === null) { this._rnd = Math.random; return; }
    let s = seed >>> 0;
    this._rnd = function () {
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  rnd() { return this._rnd(); }
  rndInt(n) { return Math.floor(this._rnd() * n); }
  scegli(arr) { return arr[this.rndInt(arr.length)]; }
  mescola(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = this.rndInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* ------------------------------ nuova run ------------------------ */
  nuovaRun() {
    this.round = 0;
    this.gettoni = 6;
    this.rulli = [RULLO_INIZIALE.slice(), RULLO_INIZIALE.slice(), RULLO_INIZIALE.slice()];
    this.cimeli = [];               // {id}
    this.modificatori = [null, null, null]; // per casella
    this.consumabili = [];          // {id}
    this.pot = { tetto: 0, giri: 0, fondo: 0, slotcimeli: 0, slotcons: 0 };
    this.tettoBonus = 1;
    this.bossVisti = [];
    this.infinito = false;
    this.vinta = false;
    this.negozio = null;
    this.rerollCosto = TUNING.REROLL_BASE;
    this.statistiche = { giriTotali: 0, vinciteMax: 0, trisTotali: 0 };
    this.prossimoRound();
  }

  /* --------------------------- stat derivate ----------------------- */
  haCimelio(id) { return this.cimeli.some(c => c.id === id && !c.spento); }
  cimeliAttivi() { return this.cimeli.map(c => CIMELI_BY_ID[c.id]).filter((d, i) => d && !this.cimeli[i].spento); }
  modAttivi() {
    if (this.boss && this.boss.eff.modificatoriOff) return [null, null, null];
    return this.modificatori.map(m => (m ? MOD_BY_ID[m] : null));
  }

  mods() {
    const m = { giri: 0, fondoPct: 0, premioGiro: 0, luckyMult: 2, interesseOgni: TUNING.INTERESSE_OGNI,
                interesseMax: TUNING.INTERESSE_MAX, rerollGratis: false, premioGiroX2: false };
    for (const d of this.cimeliAttivi()) {
      if (!d.mods) continue;
      for (const k in d.mods) {
        if (k === 'luckyMult' || k === 'interesseOgni' || k === 'interesseMax') m[k] = d.mods[k];
        else if (typeof d.mods[k] === 'boolean') m[k] = m[k] || d.mods[k];
        else m[k] += d.mods[k];
      }
    }
    return m;
  }

  livelloDi(r) { return Math.ceil(r / TUNING.ROUND_PER_LIVELLO); }
  tipoDi(r) { return (r - 1) % TUNING.ROUND_PER_LIVELLO; } // 0 piccola 1 grande 2 boss

  obiettivoBase(r) {
    const L = this.livelloDi(r), t = this.tipoDi(r);
    const base = TUNING.OBIETTIVO_BASE * Math.pow(TUNING.OBIETTIVO_CRESCITA, L - 1);
    return Math.max(10, Math.round(base * TUNING.OBIETTIVO_TIPO[t] / 5) * 5);
  }

  tettoBase(r) {
    const L = this.livelloDi(r);
    return TUNING.TETTO_BASE * Math.pow(TUNING.TETTO_CRESCITA, L - 1);
  }

  tetto() {
    let t = this.tettoBase(this.round) * Math.pow(TUNING.TETTO_UPGRADE, this.pot.tetto) * (this.tettoBonus || 1);
    if (this.boss && this.boss.eff.tettoMult) t *= this.boss.eff.tettoMult;
    return Math.max(1, Math.round(t));
  }

  slotCimeli() { return TUNING.SLOT_CIMELI + this.pot.slotcimeli; }
  slotConsumabili() { return TUNING.SLOT_CONSUMABILI + this.pot.slotcons; }

  simboliInGioco() {
    const s = new Set();
    this.rulli.forEach(r => r.forEach(x => s.add(x)));
    return [...s];
  }

  valoreDi(id) {
    let v = SIM[id] ? SIM[id].valore : 0;
    if (this.disattivato === id) return 0;
    for (const d of this.cimeliAttivi()) if (d.valoreSimbolo) v = d.valoreSimbolo(id, v);
    return v;
  }

  aliasDi(id) {
    let a = id;
    for (const d of this.cimeliAttivi()) if (d.aliasSimbolo) a = d.aliasSimbolo(a);
    return a;
  }

  /* --------------------------- ciclo dei round --------------------- */
  prossimoRound() {
    this.round++;
    this.fase = 'intro';
    this.boss = this.bossDi(this.round);
  }

  bossDi(r) {
    if (this.tipoDi(r) !== 2) return null;
    if (r === TUNING.ROUND_TOTALI) return BOSS_FINALE;
    const L = this.livelloDi(r);
    let pool = (r > TUNING.ROUND_TOTALI)
      ? BOSS.concat(BOSS_INFINITI)
      : BOSS.filter(b => (b.minLiv || 1) <= L);
    let liberi = pool.filter(b => !this.bossVisti.includes(b.id));
    if (!liberi.length) liberi = pool;
    const b = liberi[this.rndInt(liberi.length)];
    this.bossVisti.push(b.id);
    return b;
  }

  obiettivo(r) {
    let o = this.obiettivoBase(r);
    if (this.boss && this.boss.eff.obiettivoMult) o = Math.round(o * this.boss.eff.obiettivoMult);
    if (r > TUNING.ROUND_TOTALI) {
      // modalità infinita: continua a salire
      const extra = r - TUNING.ROUND_TOTALI;
      o = Math.round(o * Math.pow(1.12, extra));
    }
    return o;
  }

  iniziaRound() {
    const eff = this.boss ? this.boss.eff : {};
    const m = this.mods();

    this.obiettivoCorrente = this.obiettivo(this.round);
    this.giriRimasti = Math.max(2, TUNING.GIRI_BASE + m.giri + this.pot.giri + (eff.giriDelta || 0));

    // il fondo non è solo una frazione dell'obiettivo: deve sempre bastare per
    // giocare l'intero round a puntata alta, altrimenti si va in bancarotta subito
    let fondoPct = TUNING.FONDO_PCT + m.fondoPct + this.pot.fondo * 0.08;
    let fondo = Math.max(this.obiettivoCorrente * fondoPct,
                         this.giriRimasti * this.tetto() * TUNING.FONDO_MIN_GIRI);
    fondo = Math.min(fondo, this.obiettivoCorrente * TUNING.FONDO_MAX_PCT);
    if (eff.fondoMult) fondo *= eff.fondoMult;
    this.cassa = Math.max(5, Math.round(fondo));
    this.fondoIniziale = this.cassa;
    this.giriIniziali = this.giriRimasti;
    this.giroNum = 0;
    this.perseDiFila = 0;
    this.giroPrecedentePerso = false;
    this.gettoniExtra = 0;
    this.puntataMinima = 1;
    this.jollyRound = null;
    this.disattivato = null;
    this.congelate = [false, false, false];
    this.ultimiIds = null;
    this.trisGarantito = false;
    this.moltProssimo = 0;
    this.doppioProssimo = false;
    this.powProssimo = false;
    this.giroGratis = false;
    this.rulloBloccatoId = null;

    // rulli effettivi del round (i boss possono alterarli)
    this.rulliRound = this.rulli.map(r => r.slice());
    if (eff.nemiciRaddoppiati) {
      this.rulliRound = this.rulliRound.map(r => {
        const agg = r.filter(x => SIM[x] && SIM[x].nemico);
        return r.concat(agg);
      });
    }
    if (eff.rimescola) this.rulliRound = this.rulliRound.map(r => this.mescola(r));

    // cimeli spenti dal boss
    this.cimeli.forEach(c => c.spento = false);
    if (eff.cimeliOff) {
      const idx = this.mescola(this.cimeli.map((_, i) => i)).slice(0, eff.cimeliOff);
      idx.forEach(i => this.cimeli[i].spento = true);
    }

    // simbolo disattivato
    if (eff.disattivaSimbolo) {
      const pool = this.simboliInGioco();
      this.disattivato = pool[this.rndInt(pool.length)];
    }

    // rullo bloccato
    if (eff.rulloBloccato !== undefined) {
      const i = eff.rulloBloccato;
      this.rulloBloccatoId = this.scegli(this.rulliRound[i]);
    }

    // simbolo Lucky
    if (eff.noLucky) this.lucky = null;
    else { const pool = this.simboliInGioco(); this.lucky = pool[this.rndInt(pool.length)]; }
    this.luckyNascosto = !!eff.luckyNascosto;

    // ganci di inizio round
    for (const d of this.cimeliAttivi()) if (d.onRoundStart) d.onRoundStart(this);

    this.fase = 'gioco';
    this.esito = null;
  }

  puntataMin() {
    const eff = this.boss ? this.boss.eff : {};
    let p = this.puntataMinima;
    if (eff.puntataMinFrazione) p = Math.max(p, Math.ceil(this.tetto() * eff.puntataMinFrazione));
    return Math.min(p, this.tetto());
  }

  velocitaRullo(i) {
    let v = 1;
    const eff = this.boss ? this.boss.eff : {};
    if (eff.velTutti) v *= eff.velTutti;
    if (eff.velRullo) v *= eff.velRullo[i];
    for (const d of this.cimeliAttivi()) if (d.vel) v *= d.vel(i);
    return v;
  }

  /* rulli forzati (bloccati/congelati) per il prossimo giro */
  forzati() {
    const f = [null, null, null];
    const eff = this.boss ? this.boss.eff : {};
    if (eff.rulloBloccato !== undefined) f[eff.rulloBloccato] = this.rulloBloccatoId;
    for (let i = 0; i < 3; i++) if (this.congelate[i] && this.ultimiIds) f[i] = this.ultimiIds[i];
    if (this.trisGarantito) {
      const pool = this.simboliInGioco().filter(id => this.rulli.every(r => r.includes(id)));
      const best = (pool.length ? pool : this.simboliInGioco())
        .slice().sort((a, b) => this.valoreDi(b) - this.valoreDi(a))[0];
      return [best, best, best];
    }
    return f;
  }

  /* pesca casuale su un rullo (usata dal simulatore e come fallback) */
  pescaRullo(i) { return this.scegli(this.rulliRound[i]); }

  /* trucchi applicati quando il rullo i si ferma */
  correggiFermata(i, id, idsParziali) {
    const ids = idsParziali.slice(); ids[i] = id;
    for (const d of this.cimeliAttivi()) if (d.truccaRulli) d.truccaRulli(this, ids);
    const mods = this.modAttivi();
    for (let j = 0; j < 3; j++) if (mods[j] && mods[j].trucca) mods[j].trucca(this, ids, j);
    let out = ids[i];
    if (!this.rulliRound[i].includes(out)) out = id;
    return out;
  }

  costoGiro(puntata, n) {
    const gn = (n === undefined) ? this.giroNum : n;
    if (this.giroGratis) return 0;
    let c = puntata;
    for (const d of this.cimeliAttivi()) if (d.costoGiro) c = d.costoGiro(this, c, gn);
    return c;
  }

  /* ------------------------ valutazione del giro ------------------- */
  valuta(ids, puntata) {
    const eff = this.boss ? this.boss.eff : {};
    const mods = this.modAttivi();

    // POW: nemici diventano monete
    let vis = ids.slice();
    if (this.powProssimo) vis = vis.map(x => (SIM[x] && SIM[x].nemico ? 'coin' : x));

    // jolly: caselle con modificatore Jolly + simbolo jolly del round (Kamek)
    const wild = [false, false, false];
    for (let i = 0; i < 3; i++) {
      if (mods[i] && mods[i].jolly) wild[i] = true;
      if (this.jollyRound && vis[i] === this.jollyRound) wild[i] = true;
    }
    // simbolo disattivato: non può formare combo
    const morto = vis.map(x => x === this.disattivato);

    const chiavi = vis.map(x => this.aliasDi(x));
    const c = {
      ids: vis, chiavi, wild, val: 0, molt: 0, combo: 'niente', comboSym: null,
      part: [false, false, false], rimborso: 0, note: [], promuoviTris: false,
    };

    // ricerca combo tenendo conto dei jolly
    const nonWild = [];
    for (let i = 0; i < 3; i++) if (!wild[i] && !morto[i]) nonWild.push(i);
    const nWild = 3 - nonWild.length - morto.filter((m, i) => m && !wild[i]).length;
    const candidati = new Set(nonWild.map(i => chiavi[i]));
    if (!candidati.size) this.simboliInGioco().forEach(x => candidati.add(this.aliasDi(x)));

    let miglior = null;
    for (const k of candidati) {
      const uguali = nonWild.filter(i => chiavi[i] === k);
      const tot = uguali.length + nWild;
      const v = this.valoreDi(uguali.length ? vis[uguali[0]] : k);
      const punteggio = tot >= 3 ? 1000 + v : (tot === 2 ? v : -1);
      if (punteggio > 0 && (!miglior || punteggio > miglior.punteggio)) {
        miglior = { k, uguali, tot, v, punteggio, rif: uguali.length ? vis[uguali[0]] : k };
      }
    }

    if (miglior && miglior.tot >= 3) {
      c.combo = 'tris'; c.comboSym = miglior.rif; c.part = [true, true, true];
    } else if (miglior && miglior.tot === 2) {
      c.combo = 'coppia'; c.comboSym = miglior.rif;
      let usati = 0;
      for (let i = 0; i < 3; i++) {
        if (chiavi[i] === miglior.k && !morto[i]) { c.part[i] = true; usati++; }
      }
      for (let i = 0; i < 3 && usati < 2; i++) if (wild[i] && !c.part[i]) { c.part[i] = true; usati++; }
    }

    // ganci pre-combo (Boo)
    for (const d of this.cimeliAttivi()) if (d.preCombo) d.preCombo(c, this);
    if (c.promuoviTris && c.combo === 'coppia') { c.combo = 'tris'; c.part = [true, true, true]; }

    // boss: solo tris
    if (eff.soloTris && c.combo === 'coppia') { c.combo = 'niente'; c.part = [false, false, false]; c.comboSym = null; }

    // VAL e MOLT di base
    if (c.combo === 'tris') {
      c.val = TUNING.VAL_TRIS_SIM * this.valoreDi(c.comboSym) + TUNING.VAL_TRIS_BASE;
      c.molt = TUNING.MOLT_TRIS;
    } else if (c.combo === 'coppia') {
      c.val = TUNING.VAL_COPPIA_SIM * this.valoreDi(c.comboSym) + TUNING.VAL_COPPIA_BASE;
      c.molt = TUNING.MOLT_COPPIA;
    }

    if (eff.coppieMeta && c.combo === 'coppia') c.molt *= 0.5;

    // modificatori di casella
    for (let i = 0; i < 3; i++) if (mods[i] && mods[i].punteggio) mods[i].punteggio(c, this, i);
    // cimeli
    for (const d of this.cimeliAttivi()) if (d.punteggio) d.punteggio(c, this);

    // consumabili "prossimo giro"
    if (this.moltProssimo && c.combo !== 'niente') { c.molt *= this.moltProssimo; c.note.push('MOLT ×' + this.moltProssimo); }

    // Lucky
    const luckyMult = this.mods().luckyMult;
    c.luckyAttivo = false;
    if (this.lucky && vis.includes(this.lucky) && c.combo !== 'niente') {
      c.molt *= luckyMult; c.luckyAttivo = true; c.note.push('LUCKY ×' + luckyMult);
    }

    // vincita
    let vincita = 0;
    if (c.combo !== 'niente') vincita = c.val * c.molt / TUNING.DIVISORE;
    else if (c.rimborso > 0) vincita = c.rimborso;
    vincita = vincita * puntata;

    if (this.doppioProssimo) vincita *= 2;
    if (eff.primoNonPaga && this.giroNum === 1) { vincita = 0; c.note.push('Thwomp: niente!'); }
    if (eff.vinciteMult) vincita *= eff.vinciteMult;
    if (eff.capVincita && vincita > eff.capVincita * puntata) {
      vincita = eff.capVincita * puntata + (vincita - eff.capVincita * puntata) * 0.5;
      c.note.push('Vincita tagliata');
    }

    c.vincita = Math.round(vincita);
    return c;
  }

  /* esegue il giro completo: costo, valutazione, incasso */
  eseguiGiro(ids, puntata) {
    this.giroNum++;
    this.statistiche.giriTotali++;
    const costo = this.costoGiro(puntata);
    this.cassa -= costo;
    this.giriRimasti--;

    const c = this.valuta(ids, puntata);
    c.puntata = puntata; c.costo = costo;
    this.cassa += c.vincita;
    if (c.vincita > this.statistiche.vinciteMax) this.statistiche.vinciteMax = c.vincita;
    if (c.combo === 'tris') this.statistiche.trisTotali++;

    // ganci post-giro
    for (const d of this.cimeliAttivi()) if (d.onGiro) d.onGiro(this, c);
    const mods = this.modAttivi();
    for (let i = 0; i < 3; i++) if (mods[i] && mods[i].onGiro) mods[i].onGiro(this, c, i);

    // congelamento caselle
    this.congelate = [false, false, false];
    for (let i = 0; i < 3; i++) if (mods[i] && mods[i].congela && c.combo !== 'niente') this.congelate[i] = true;
    this.ultimiIds = ids.slice();

    // reset effetti a uso singolo
    this.moltProssimo = 0; this.doppioProssimo = false; this.powProssimo = false;
    this.giroGratis = false; this.trisGarantito = false;

    // stato "perdente"
    const perso = c.vincita < costo;
    this.giroPrecedentePerso = perso;
    this.perseDiFila = perso ? this.perseDiFila + 1 : 0;

    // malus progressivi del boss
    const eff = this.boss ? this.boss.eff : {};
    if (eff.puntataMinCresce) this.puntataMinima += eff.puntataMinCresce;
    if (eff.obiettivoCresce) this.obiettivoCorrente = Math.round(this.obiettivoCorrente * (1 + eff.obiettivoCresce));

    // esito
    if (this.cassa >= this.obiettivoCorrente) this.esito = 'vinto';
    else if (this.giriRimasti <= 0) this.esito = 'perso';
    else if (this.cassa < this.puntataMin()) this.esito = 'perso';

    return c;
  }

  /* ------------------------- fine round / premi -------------------- */
  premi() {
    const m = this.mods();
    const t = this.tipoDi(this.round);
    const r = { gettoni: 0, righe: [] };
    const base = TUNING.PREMIO_TIPO[t];
    r.gettoni += base; r.righe.push(['Round superato', base]);

    let perGiro = TUNING.PREMIO_GIRO + m.premioGiro;
    if (m.premioGiroX2) perGiro *= 2;
    const giri = Math.min(this.giriRimasti, TUNING.PREMIO_GIRO_MAX);
    if (giri > 0) { r.gettoni += giri * perGiro; r.righe.push([giri + ' giri avanzati', giri * perGiro]); }

    const ints = Math.min(Math.floor(this.gettoni / m.interesseOgni), m.interesseMax);
    if (ints > 0) { r.gettoni += ints; r.righe.push(['Interesse', ints]); }

    if (this.gettoniExtra) { r.gettoni += this.gettoniExtra; r.righe.push(['Bonus del round', this.gettoniExtra]); }

    for (const d of this.cimeliAttivi()) if (d.onRoundEnd) d.onRoundEnd(this, r);

    r.gettoni = Math.max(0, r.gettoni);
    return r;
  }

  chiudiRound(premio) {
    this.gettoni += premio.gettoni;
    if (this.round === TUNING.ROUND_TOTALI && !this.infinito) this.vinta = true;
    this.fase = 'negozio';
    this.rerollCosto = TUNING.REROLL_BASE;
    this.generaNegozio();
  }

  /* ------------------------------ negozio -------------------------- */
  generaNegozio() {
    const posseduti = this.cimeli.map(c => c.id);
    const dispo = CIMELI.filter(c => !posseduti.includes(c.id));
    const cimeli = this.mescola(dispo).slice(0, TUNING.NEGOZIO_CIMELI)
      .map(c => ({ tipo: 'cimelio', id: c.id, prezzo: c.prezzo }));

    const altro = [];
    const tipi = ['mod', 'cons', 'rullo', 'rullo', 'cons', 'mod'];
    const mescolati = this.mescola(tipi);
    for (let i = 0; i < TUNING.NEGOZIO_ALTRO; i++) altro.push(this.generaOfferta(mescolati[i]));

    this.negozio = { offerte: cimeli.concat(altro), comprati: [] };
  }

  generaOfferta(tipo) {
    if (tipo === 'mod') {
      const m = this.scegli(MODIFICATORI);
      return { tipo: 'mod', id: m.id, prezzo: m.prezzo };
    }
    if (tipo === 'cons') {
      const c = this.scegli(CONSUMABILI);
      return { tipo: 'cons', id: c.id, prezzo: c.prezzo };
    }
    // modifiche ai rulli
    const scelte = ['aggiungi', 'aggiungiTutti', 'rimuovi', 'duplica', 'trasforma'];
    const k = this.scegli(scelte);
    const sid = this.scegli(SIMBOLI_NEGOZIO);
    const val = SIM[sid].valore;
    let prezzo;
    if (k === 'aggiungi') prezzo = 3 + Math.round(val * 0.5);
    else if (k === 'aggiungiTutti') prezzo = 6 + Math.round(val * 1.1);
    else if (k === 'rimuovi') prezzo = 4;
    else if (k === 'duplica') prezzo = 5;
    else prezzo = 4 + Math.round(val * 0.5);
    return { tipo: 'rullo', azione: k, sid, prezzo };
  }

  reroll() {
    const gratis = this.mods().rerollGratis;
    const costo = gratis ? 0 : this.rerollCosto;
    if (this.gettoni < costo) return false;
    this.gettoni -= costo;
    if (!gratis) this.rerollCosto += TUNING.REROLL_INCR;
    this.generaNegozio();
    return true;
  }

  prezzoPot(id) {
    const p = POTENZIAMENTI.find(x => x.id === id);
    return p.prezzo(this.pot[id]);
  }
  potMax(id) {
    const p = POTENZIAMENTI.find(x => x.id === id);
    return this.pot[id] >= p.max;
  }
  compraPot(id) {
    if (this.potMax(id)) return false;
    const c = this.prezzoPot(id);
    if (this.gettoni < c) return false;
    this.gettoni -= c; this.pot[id]++;
    return true;
  }

  vendiCimelio(i) {
    const d = CIMELI_BY_ID[this.cimeli[i].id];
    this.gettoni += Math.max(1, Math.floor(d.prezzo / 2));
    this.cimeli.splice(i, 1);
  }
  vendiConsumabile(i) {
    const d = CONS_BY_ID[this.consumabili[i].id];
    this.gettoni += Math.max(1, Math.floor(d.prezzo / 2));
    this.consumabili.splice(i, 1);
  }

  /* -------------------------- uso consumabili ---------------------- */
  usaConsumabile(i, arg) {
    const c = this.consumabili[i];
    if (!c) return null;
    const d = CONS_BY_ID[c.id];
    let msg;
    if (d.usa) msg = d.usa(this);
    else if (d.applica && arg) msg = d.applica(this, arg.rullo, arg.k, arg.sid);
    else return null;
    this.consumabili.splice(i, 1);
    if (this.fase === 'gioco') this.rulliRound = this.rulli.map(r => r.slice());
    return msg;
  }

  /* ------------------------------ salvataggio ---------------------- */
  salva() {
    try {
      const d = {
        round: this.round, gettoni: this.gettoni, rulli: this.rulli,
        cimeli: this.cimeli.map(c => ({ id: c.id })), modificatori: this.modificatori,
        consumabili: this.consumabili.map(c => ({ id: c.id })), pot: this.pot,
        tettoBonus: this.tettoBonus, bossVisti: this.bossVisti, infinito: this.infinito,
        vinta: this.vinta, fase: this.fase, negozio: this.negozio, rerollCosto: this.rerollCosto,
        boss: this.boss ? this.boss.id : null, statistiche: this.statistiche,
      };
      localStorage.setItem(SALVATAGGIO, JSON.stringify(d));
    } catch (e) { /* niente */ }
  }

  carica() {
    try {
      const raw = localStorage.getItem(SALVATAGGIO);
      if (!raw) return false;
      const d = JSON.parse(raw);
      if (!d || !d.rulli) return false;
      Object.assign(this, {
        round: d.round, gettoni: d.gettoni, rulli: d.rulli, cimeli: d.cimeli,
        modificatori: d.modificatori, consumabili: d.consumabili, pot: d.pot,
        tettoBonus: d.tettoBonus || 1, bossVisti: d.bossVisti || [], infinito: !!d.infinito,
        vinta: !!d.vinta, fase: d.fase || 'intro', negozio: d.negozio,
        rerollCosto: d.rerollCosto || TUNING.REROLL_BASE,
        statistiche: d.statistiche || { giriTotali: 0, vinciteMax: 0, trisTotali: 0 },
      });
      const tutti = BOSS.concat([BOSS_FINALE], BOSS_INFINITI);
      this.boss = d.boss ? (tutti.find(b => b.id === d.boss) || null) : null;
      if (this.fase === 'gioco') this.fase = 'intro'; // riparte dall'inizio del round
      return true;
    } catch (e) { return false; }
  }

  static esisteSalvataggio() {
    try { return !!localStorage.getItem(SALVATAGGIO); } catch (e) { return false; }
  }
  static cancellaSalvataggio() {
    try { localStorage.removeItem(SALVATAGGIO); } catch (e) { }
  }
}

/* ========================== INTERFACCIA ============================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const fmt = (n) => Math.round(n).toLocaleString('it-IT');

class Interfaccia {
  constructor() {
    this.g = new Gioco();
    this.rulliEl = [];
    this.pos = [0, 0, 0];
    this.girando = [false, false, false];
    this.spinAttivo = false;
    this.altezzaSimbolo = 0;
    this.gif = { attiva: false, assets: [], statici: {} };
    this.bersaglio = null;
    this.costruisci();
    this.leghe();
    this.mostraSchermata('titolo');
  }

  /* ------------------------------ costruzione ---------------------- */
  costruisci() {
    this.el = {
      scrTitolo: $('#scrTitolo'), scrGioco: $('#scrGioco'),
      hudRound: $('#hudRound'), hudTipo: $('#hudTipo'), hudGettoni: $('#hudGettoni'),
      hudCassa: $('#hudCassa'), hudObiettivo: $('#hudObiettivo'), hudGiri: $('#hudGiri'),
      hudProg: $('#hudProg'), bossBanner: $('#bossBanner'),
      cimeliBar: $('#cimeliBar'), consBar: $('#consBar'),
      machine: $('#machine'), readout: $('#readout'),
      luckyChip: $('#luckyChip'), luckyImg: $('#luckyImg'),
      betVal: $('#betVal'), spinBtn: $('#spinBtn'),
      cellmods: $$('.cellmod'), particelle: $('#particelle'),
    };
    for (let i = 0; i < 3; i++) {
      this.rulliEl.push({ box: $(`.reel[data-i="${i}"]`), strip: $(`.reel[data-i="${i}"] .strip`) });
    }
    this.puntata = 1;
  }

  leghe() {
    $('#btnNuova').onclick = () => this.nuovaPartita();
    $('#btnContinua').onclick = () => this.continua();
    $('#btnAiuto').onclick = () => this.mostraAiuto();
    $('#btnMenu').onclick = () => this.apriMenu();

    $('#betGiu').onclick = () => this.cambiaPuntata(-1);
    $('#betSu').onclick = () => this.cambiaPuntata(1);
    $('#betMax').onclick = () => this.puntataMax();
    this.el.spinBtn.onclick = () => this.azioneGiro();

    // tocco sulla macchina = gira / ferma
    this.el.machine.addEventListener('click', (e) => { e.preventDefault(); this.azioneGiro(); });

    // easter egg GIF: 3 secondi sul pannello LUCKY
    let t = null;
    const giu = () => { clearTimeout(t); t = setTimeout(() => this.apriZipGif(), 3000); };
    const su = () => clearTimeout(t);
    ['mousedown', 'touchstart'].forEach(ev => this.el.luckyChip.addEventListener(ev, giu, { passive: true }));
    ['mouseup', 'mouseleave', 'touchend', 'touchcancel'].forEach(ev => this.el.luckyChip.addEventListener(ev, su, { passive: true }));

    window.addEventListener('resize', () => this.misura());
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.azioneGiro(); }
    });
  }

  mostraSchermata(nome) {
    this.el.scrTitolo.classList.toggle('hidden', nome !== 'titolo');
    this.el.scrGioco.classList.toggle('hidden', nome !== 'gioco');
    $('#btnContinua').classList.toggle('hidden', !Gioco.esisteSalvataggio());
  }

  /* ------------------------------ partita -------------------------- */
  nuovaPartita() {
    Gioco.cancellaSalvataggio();
    this.g.nuovaRun();
    this.mostraSchermata('gioco');
    this.preparaRound();
  }

  continua() {
    if (!this.g.carica()) { this.nuovaPartita(); return; }
    this.mostraSchermata('gioco');
    if (this.g.fase === 'negozio') { this.disegnaTutto(); this.apriNegozio(); }
    else this.preparaRound();
  }

  preparaRound() {
    const g = this.g;
    if (g.fase !== 'intro') g.fase = 'intro';
    g.boss = g.boss || g.bossDi(g.round);
    if (g.tipoDi(g.round) !== 2) g.boss = null;
    this.mostraIntroRound();
  }

  mostraIntroRound() {
    const g = this.g;
    const tipo = ['Manche Piccola', 'Manche Grande', 'BOSS'][g.tipoDi(g.round)];
    const ob = g.obiettivo(g.round);
    const box = $('#ovRoundBody');
    box.innerHTML = '';
    box.appendChild(el('div', 'ov-kicker', `Round ${g.round}${g.infinito ? '' : ' / ' + TUNING.ROUND_TOTALI}`));
    box.appendChild(el('div', 'ov-title' + (g.boss ? ' boss' : ''), g.boss ? `${g.boss.ico} ${g.boss.nome}` : tipo));
    if (g.boss) box.appendChild(el('div', 'ov-malus', g.boss.desc));
    const st = el('div', 'ov-stats');
    st.appendChild(el('div', 'ov-stat', `<span>Obiettivo</span><b>${fmt(ob)}</b>`));
    st.appendChild(el('div', 'ov-stat', `<span>Premio</span><b>🎟️ ${TUNING.PREMIO_TIPO[g.tipoDi(g.round)]}+</b>`));
    box.appendChild(st);
    $('#ovRound').classList.remove('hidden');
    $('#ovRoundGo').onclick = () => {
      $('#ovRound').classList.add('hidden');
      g.iniziaRound();
      this.puntata = Math.min(Math.max(g.puntataMin(), Math.ceil(g.tetto() * 0.4)), g.tetto(), g.cassa);
      this.costruisciRulli();
      this.disegnaTutto();
      this.setReadout('Fai girare i rulli!', '');
      g.salva();
    };
  }

  /* ------------------------------- rulli --------------------------- */
  costruisciRulli() {
    const g = this.g;
    this.misura();
    for (let i = 0; i < 3; i++) {
      const seq = g.rulliRound[i];
      const strip = this.rulliEl[i].strip;
      strip.innerHTML = '';
      for (let rep = 0; rep < 3; rep++) {
        for (let k = 0; k < seq.length; k++) {
          const s = el('div', 'sym');
          const img = document.createElement('img');
          img.src = this.immagineDi(seq[k]);
          img.alt = SIM[seq[k]].nome;
          s.appendChild(img);
          s.dataset.id = seq[k];
          strip.appendChild(s);
        }
      }
      this.pos[i] = seq.length + this.g.rndInt(seq.length);
      this.applicaPos(i);
    }
    this.misura();
  }

  immagineDi(id) {
    if (this.gif.attiva && this.gif.mappa && this.gif.mappa[id]) return this.gif.mappa[id].statico || this.gif.mappa[id].url;
    return SIM[id].img;
  }

  misura() {
    const wrap = $('#machineWrap');
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (W > 0 && H > 0) {
      const w = Math.min(W, H * 728 / 512, 400);
      this.el.machine.style.width = Math.floor(w) + 'px';
      this.el.machine.style.height = Math.floor(w * 512 / 728) + 'px';
    }
    const h = this.rulliEl[0].box.clientHeight;
    if (!h) return;
    this.altezzaSimbolo = h;
    document.documentElement.style.setProperty('--symH', h + 'px');
    for (let i = 0; i < 3; i++) this.applicaPos(i);
  }

  applicaPos(i) {
    const H = this.altezzaSimbolo || this.rulliEl[0].box.clientHeight || 70;
    this.rulliEl[i].strip.style.transform = `translateY(${-this.pos[i] * H}px)`;
  }

  simboloVisibile(i) {
    const L = this.g.rulliRound[i].length;
    const k = ((Math.round(this.pos[i]) % L) + L) % L;
    return { k, id: this.g.rulliRound[i][k] };
  }

  /* ------------------------------ il giro -------------------------- */
  azioneGiro() {
    const g = this.g;
    if (g.fase !== 'gioco' || this.bloccato) return;
    if (this.spinAttivo) {
      const i = this.girando.indexOf(true);
      if (i >= 0) this.fermaRullo(i);
      return;
    }
    this.avviaGiro();
  }

  avviaGiro() {
    const g = this.g;
    const min = g.puntataMin();
    if (this.puntata < min) this.puntata = Math.min(min, g.tetto());
    const costo = g.costoGiro(this.puntata, g.giroNum + 1);
    if (g.cassa < costo) { this.setReadout('Cassa insufficiente!', 'Abbassa la puntata'); this.scuoti(); this.vibra(150); return; }
    if (g.giriRimasti <= 0) return;

    this.spinAttivo = true;
    this.idsFermati = [null, null, null];
    this.forzati = g.forzati();
    this.el.spinBtn.textContent = 'FERMA';
    this.el.spinBtn.classList.add('stop');
    this.setReadout('', '');
    document.body.classList.toggle('invisibile', !!(g.boss && g.boss.eff.invisibile));

    for (let i = 0; i < 3; i++) {
      if (this.forzati[i]) { this.girando[i] = false; this.portaA(i, this.forzati[i], 0); this.idsFermati[i] = this.forzati[i]; }
      else this.girando[i] = true;
    }
    this.tempoUltimo = performance.now();
    this.autoStop = [1400, 2100, 2800];
    this.tempoInizio = performance.now();
    if (this.turbo) this.autoStop = [90, 150, 210];
    this.avviaLoop();
    if (!this.girando.includes(true)) setTimeout(() => this.concludiGiro(), this.turbo ? 60 : 300);
  }

  fermaRullo(i) {
    if (!this.girando[i]) return;
    this.girando[i] = false;
    const vis = this.simboloVisibile(i);
    const finale = this.g.correggiFermata(i, vis.id, this.idsFermati.map((x, j) => x || (j === i ? vis.id : this.simboloVisibile(j).id)));
    this.idsFermati[i] = finale;
    this.portaA(i, finale, finale === vis.id ? 260 : 520);
    this.pulsa(i);
    this.vibra(12);
    if (!this.girando.includes(true)) setTimeout(() => this.concludiGiro(), this.turbo ? 80 : 620);
  }

  portaA(i, id, durata) {
    const seq = this.g.rulliRound[i];
    const L = seq.length;
    let best = null;
    for (let k = 0; k < L; k++) {
      if (seq[k] !== id) continue;
      let v = k + L * Math.floor((this.pos[i] - k) / L);
      if (v > this.pos[i]) v -= L;
      if (best === null || v > best) best = v;
    }
    if (best === null) best = Math.round(this.pos[i]);
    if (this.turbo) durata = Math.round(durata * 0.12);
    if (!durata) { this.pos[i] = best; this.normalizza(i); this.applicaPos(i); return; }
    this.anim = this.anim || {};
    this.anim[i] = { da: this.pos[i], a: best, t0: performance.now(), dur: durata };
    this.avviaLoop();
  }

  normalizza(i) {
    const L = this.g.rulliRound[i].length;
    while (this.pos[i] < L) this.pos[i] += L;
    while (this.pos[i] >= 2 * L) this.pos[i] -= L;
  }

  avviaLoop() {
    if (this.loopVivo) return;
    this.loopVivo = true;
    this.tempoUltimo = performance.now();
    this.loop();
  }

  loop() {
    const passo = (t) => {
      const dt = Math.min(0.05, (t - (this.tempoUltimo || t)) / 1000);
      this.tempoUltimo = t;
      if (this.spinAttivo) {
        for (let i = 0; i < 3; i++) {
          if (this.girando[i]) {
            const v = 7.5 * this.g.velocitaRullo(i);
            this.pos[i] -= v * dt;
            this.normalizza(i);
            this.applicaPos(i);
            if (t - this.tempoInizio > this.autoStop[i]) this.fermaRullo(i);
          }
        }
      }
      if (this.anim) {
        for (const k in this.anim) {
          const a = this.anim[k];
          const p = Math.min(1, (t - a.t0) / a.dur);
          const e = 1 - Math.pow(1 - p, 3);
          this.pos[k] = a.da + (a.a - a.da) * e;
          this.applicaPos(k);
          if (p >= 1) { this.normalizza(k); this.applicaPos(k); delete this.anim[k]; }
        }
      }
      // il ciclo si spegne da solo quando non c'è niente da animare:
      // così il telefono non brucia batteria a schermo fermo
      if (this.spinAttivo || (this.anim && Object.keys(this.anim).length)) requestAnimationFrame(passo);
      else this.loopVivo = false;
    };
    requestAnimationFrame(passo);
  }

  concludiGiro() {
    const g = this.g;
    this.spinAttivo = false;
    document.body.classList.remove('invisibile');
    this.el.spinBtn.textContent = 'GIRA';
    this.el.spinBtn.classList.remove('stop');
    const ids = this.idsFermati.map((x, i) => x || this.simboloVisibile(i).id);
    const cassaPrima = g.cassa;
    const res = g.eseguiGiro(ids, this.puntata);
    this.mostraRisultato(res, cassaPrima);
    this.disegnaTutto();
    g.salva();

    if (g.esito) {
      this.bloccato = true;
      setTimeout(() => { this.bloccato = false; this.fineRound(); }, this.turbo ? 60 : 1100);
    }
  }

  mostraRisultato(res, cassaPrima) {
    const g = this.g;
    let titolo, sotto;
    if (res.combo === 'niente') {
      titolo = res.vincita > 0 ? 'Rimborso' : 'Niente';
      sotto = res.vincita > 0 ? `+${fmt(res.vincita)}` : `−${fmt(res.costo)}`;
    } else {
      const nome = res.combo === 'tris' ? 'TRIS' : 'COPPIA';
      titolo = `${nome} · ${SIM[res.comboSym] ? SIM[res.comboSym].nome : ''}`;
      const molt = Math.round(res.molt * 100) / 100;
      sotto = `VAL ${fmt(res.val)} × MOLT ${molt} × ${res.puntata} = <b>${fmt(res.vincita)}</b>`;
    }
    this.setReadout(titolo, sotto, res.combo !== 'niente');
    if (res.note && res.note.length) this.bolle(res.note);
    if (res.combo === 'tris') { this.particelle(); this.mostraGifVincente(res); this.vibra([40, 60, 40, 60, 90]); }
    else if (res.combo === 'coppia') this.vibra(28);
    if (res.combo !== 'niente') {
      for (let i = 0; i < 3; i++) if (res.part[i]) this.rulliEl[i].box.classList.add('vincente');
      setTimeout(() => this.rulliEl.forEach(r => r.box.classList.remove('vincente')), 1200);
    }
    if (res.luckyAttivo) {
      this.el.luckyChip.classList.add('acceso');
      setTimeout(() => this.el.luckyChip.classList.remove('acceso'), 1200);
    }
  }

  setReadout(t, s, buono) {
    this.el.readout.innerHTML = `<div class="ro-t">${t || ''}</div><div class="ro-s">${s || ''}</div>`;
    this.el.readout.classList.toggle('buono', !!buono);
    if (t) { this.el.readout.classList.remove('pop'); void this.el.readout.offsetWidth; this.el.readout.classList.add('pop'); }
  }

  bolle(note) {
    note.slice(0, 4).forEach((n, i) => {
      const b = el('div', 'bolla', n);
      b.style.left = (18 + i * 22) + '%';
      this.el.particelle.appendChild(b);
      setTimeout(() => b.remove(), 1400);
    });
  }

  particelle() {
    const em = ['🍄', '⭐', '🪙', '🌸', '🍒', '✨', '💰', '7️⃣'];
    for (let i = 0; i < 16; i++) {
      const p = el('div', 'particella', em[Math.floor(Math.random() * em.length)]);
      p.style.left = Math.random() * 100 + '%';
      p.style.animationDelay = (Math.random() * 0.6) + 's';
      this.el.particelle.appendChild(p);
      setTimeout(() => p.remove(), 2600);
    }
  }

  vibra(p) { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { } }

  scuoti() {
    this.el.machine.classList.remove('scuoti'); void this.el.machine.offsetWidth;
    this.el.machine.classList.add('scuoti');
  }
  pulsa(i) {
    const b = this.rulliEl[i].box;
    b.classList.remove('stop'); void b.offsetWidth; b.classList.add('stop');
  }

  /* ---------------------------- fine round ------------------------- */
  fineRound() {
    const g = this.g;
    const vinto = g.esito === 'vinto';
    const box = $('#ovEsitoBody');
    box.innerHTML = '';
    box.appendChild(el('div', 'ov-title ' + (vinto ? 'ok' : 'ko'), vinto ? 'ROUND SUPERATO!' : 'ROUND FALLITO'));
    box.appendChild(el('div', 'ov-kicker', `Cassa ${fmt(g.cassa)} / obiettivo ${fmt(g.obiettivoCorrente)}`));
    this.vibra(vinto ? [60, 40, 60] : [220, 90, 220]);

    if (vinto) {
      const premio = g.premi();
      const lista = el('div', 'premi');
      premio.righe.forEach(([n, v]) => lista.appendChild(el('div', 'premio-riga', `<span>${n}</span><b>${v > 0 ? '+' : ''}${v}</b>`)));
      lista.appendChild(el('div', 'premio-riga tot', `<span>Totale</span><b>🎟️ ${premio.gettoni}</b>`));
      box.appendChild(lista);
      $('#ovEsitoGo').textContent = 'AL NEGOZIO';
      $('#ovEsitoGo').onclick = () => {
        $('#ovEsito').classList.add('hidden');
        const finale = (g.round === TUNING.ROUND_TOTALI && !g.infinito);
        g.chiudiRound(premio);
        g.salva();
        if (finale) this.mostraVittoria(); else this.apriNegozio();
      };
    } else {
      const s = el('div', 'premi');
      s.appendChild(el('div', 'premio-riga', `<span>Round raggiunto</span><b>${g.round}</b>`));
      s.appendChild(el('div', 'premio-riga', `<span>Giri giocati</span><b>${g.statistiche.giriTotali}</b>`));
      s.appendChild(el('div', 'premio-riga', `<span>Vincita più alta</span><b>${fmt(g.statistiche.vinciteMax)}</b>`));
      box.appendChild(s);
      $('#ovEsitoGo').textContent = 'RICOMINCIA';
      $('#ovEsitoGo').onclick = () => {
        $('#ovEsito').classList.add('hidden');
        Gioco.cancellaSalvataggio();
        this.mostraSchermata('titolo');
      };
    }
    $('#ovEsito').classList.remove('hidden');
  }

  mostraVittoria() {
    $('#ovVittoria').classList.remove('hidden');
    $('#ovVinciChiudi').onclick = () => {
      $('#ovVittoria').classList.add('hidden');
      Gioco.cancellaSalvataggio();
      this.mostraSchermata('titolo');
    };
    $('#ovVinciAvanti').onclick = () => {
      $('#ovVittoria').classList.add('hidden');
      this.g.infinito = true;
      this.g.salva();
      this.apriNegozio();
    };
  }

  /* ------------------------------ negozio -------------------------- */
  apriNegozio() {
    this.disegnaNegozio();
    $('#ovNegozio').classList.remove('hidden');
    $('#negAvanti').onclick = () => {
      $('#ovNegozio').classList.add('hidden');
      this.g.prossimoRound();
      this.g.salva();
      this.preparaRound();
    };
    $('#negReroll').onclick = () => { if (this.g.reroll()) this.disegnaNegozio(); else this.scuotiEl($('#negReroll')); };
    $('#negRulli').onclick = () => this.mostraRulli();
  }

  disegnaNegozio() {
    const g = this.g;
    $('#negGettoni').textContent = g.gettoni;
    const gratis = g.mods().rerollGratis;
    $('#negReroll').innerHTML = `🔄 Cambia<br><small>${gratis ? 'gratis' : '🎟️ ' + g.rerollCosto}</small>`;

    const box = $('#negOfferte');
    box.innerHTML = '';
    g.negozio.offerte.forEach((o, i) => {
      if (g.negozio.comprati.includes(i)) { box.appendChild(el('div', 'card vuota', '<span>venduto</span>')); return; }
      const c = el('div', 'card t-' + o.tipo);
      const d = this.descrizioneOfferta(o);
      c.innerHTML = `<div class="c-ico">${d.ico}</div><div class="c-nome">${d.nome}</div>
                     <div class="c-desc">${d.desc}</div><div class="c-prezzo">🎟️ ${o.prezzo}</div>`;
      if (g.gettoni < o.prezzo) c.classList.add('caro');
      c.onclick = () => this.compra(i);
      box.appendChild(c);
    });

    const pot = $('#negPot');
    pot.innerHTML = '';
    POTENZIAMENTI.forEach(p => {
      const max = g.potMax(p.id);
      const pr = g.prezzoPot(p.id);
      const b = el('button', 'potbtn' + (max ? ' max' : (g.gettoni < pr ? ' caro' : '')));
      b.innerHTML = `<span class="p-ico">${p.ico}</span><span class="p-nome">${p.nome}</span>
                     <span class="p-prezzo">${max ? 'MAX' : '🎟️ ' + pr}</span>`;
      b.title = p.desc();
      b.onclick = () => {
        if (max) return;
        if (g.compraPot(p.id)) { this.disegnaNegozio(); g.salva(); this.flash(p.nome + ' migliorato!'); }
        else this.scuotiEl(b);
      };
      pot.appendChild(b);
    });

    this.disegnaCimeli($('#negCimeli'), true);
    $('#negInfo').textContent = `Tetto puntata prossimo round: ${fmt(g.tettoBase(g.round + 1) * Math.pow(TUNING.TETTO_UPGRADE, g.pot.tetto) * (g.tettoBonus || 1))}`;
  }

  descrizioneOfferta(o) {
    if (o.tipo === 'cimelio') {
      const d = CIMELI_BY_ID[o.id];
      return { ico: d.ico, nome: d.nome, desc: d.desc + ` <i>(${RARITA[d.rar]})</i>` };
    }
    if (o.tipo === 'mod') {
      const d = MOD_BY_ID[o.id];
      return { ico: d.ico, nome: 'Casella ' + d.nome, desc: d.desc };
    }
    if (o.tipo === 'cons') {
      const d = CONS_BY_ID[o.id];
      return { ico: d.ico, nome: d.nome, desc: d.desc };
    }
    const s = SIM[o.sid];
    const img = `<img class="mini" src="${s.img}" alt="">`;
    switch (o.azione) {
      case 'aggiungi': return { ico: '➕', nome: 'Aggiungi ' + s.nome, desc: `${img} Aggiunge un ${s.nome} (valore ${s.valore}) a un rullo a tua scelta.` };
      case 'aggiungiTutti': return { ico: '⏫', nome: s.nome + ' ovunque', desc: `${img} Aggiunge un ${s.nome} a <b>tutti e tre</b> i rulli.` };
      case 'rimuovi': return { ico: '🗑️', nome: 'Togli un simbolo', desc: 'Elimina per sempre un simbolo da un rullo a tua scelta.' };
      case 'duplica': return { ico: '👯', nome: 'Duplica un simbolo', desc: 'Raddoppia le probabilità di un simbolo su un rullo.' };
      default: return { ico: '🎨', nome: 'Trasforma in ' + s.nome, desc: `${img} Trasforma un simbolo di un rullo in un ${s.nome}.` };
    }
  }

  compra(i) {
    const g = this.g;
    const o = g.negozio.offerte[i];
    if (!o || g.negozio.comprati.includes(i)) return;
    if (g.gettoni < o.prezzo) { this.flash('Non hai abbastanza gettoni'); return; }

    if (o.tipo === 'cimelio') {
      if (g.cimeli.length >= g.slotCimeli()) { this.flash('Mensola piena: vendi un cimelio'); return; }
      g.gettoni -= o.prezzo; g.cimeli.push({ id: o.id });
      g.negozio.comprati.push(i); this.dopoAcquisto();
      return;
    }
    if (o.tipo === 'cons') {
      if (g.consumabili.length >= g.slotConsumabili()) { this.flash('Tasche piene: vendi un consumabile'); return; }
      g.gettoni -= o.prezzo; g.consumabili.push({ id: o.id });
      g.negozio.comprati.push(i); this.dopoAcquisto();
      return;
    }
    if (o.tipo === 'mod') {
      this.scegliCasella(MOD_BY_ID[o.id], (cella) => {
        g.gettoni -= o.prezzo; g.modificatori[cella] = o.id;
        g.negozio.comprati.push(i); this.dopoAcquisto();
      });
      return;
    }
    // modifiche ai rulli
    if (o.azione === 'aggiungiTutti') {
      g.gettoni -= o.prezzo; g.rulli.forEach(r => r.push(o.sid));
      g.negozio.comprati.push(i); this.dopoAcquisto();
      return;
    }
    if (o.azione === 'aggiungi') {
      this.scegliRullo(`Su quale rullo aggiungere ${SIM[o.sid].nome}?`, (r) => {
        g.gettoni -= o.prezzo; g.rulli[r].push(o.sid);
        g.negozio.comprati.push(i); this.dopoAcquisto();
      });
      return;
    }
    const testi = { rimuovi: 'Tocca il simbolo da eliminare', duplica: 'Tocca il simbolo da duplicare', trasforma: `Tocca il simbolo da trasformare in ${SIM[o.sid].nome}` };
    this.scegliSimbolo(testi[o.azione], (r, k) => {
      if (o.azione === 'rimuovi') {
        if (g.rulli[r].length <= 3) { this.flash('Un rullo deve avere almeno 3 simboli'); return false; }
        g.rulli[r].splice(k, 1);
      } else if (o.azione === 'duplica') g.rulli[r].splice(k, 0, g.rulli[r][k]);
      else g.rulli[r][k] = o.sid;
      g.gettoni -= o.prezzo; g.negozio.comprati.push(i); this.dopoAcquisto();
      return true;
    });
  }

  dopoAcquisto() {
    this.g.salva();
    this.disegnaNegozio();
    this.disegnaTutto();
  }

  /* --------------------------- selettori --------------------------- */
  apriSelettore(titolo, contenuto) {
    $('#selTitolo').textContent = titolo;
    const b = $('#selBody'); b.innerHTML = ''; b.appendChild(contenuto);
    $('#ovSel').classList.remove('hidden');
    $('#selAnnulla').onclick = () => $('#ovSel').classList.add('hidden');
  }
  chiudiSelettore() { $('#ovSel').classList.add('hidden'); }

  scegliCasella(mod, cb) {
    const wrap = el('div', 'sel-caselle');
    for (let i = 0; i < 3; i++) {
      const attuale = this.g.modificatori[i];
      const b = el('button', 'sel-cella');
      b.innerHTML = `<div class="sc-n">Casella ${i + 1}</div>
        <div class="sc-m">${attuale ? MOD_BY_ID[attuale].ico + ' ' + MOD_BY_ID[attuale].nome : '— libera —'}</div>`;
      b.onclick = () => { this.chiudiSelettore(); cb(i); };
      wrap.appendChild(b);
    }
    const nota = el('div', 'sel-nota', `${mod.ico} <b>${mod.nome}</b> — ${mod.desc}<br>Se la casella è già occupata, il vecchio modificatore viene sostituito.`);
    const box = el('div'); box.appendChild(nota); box.appendChild(wrap);
    this.apriSelettore('Scegli la casella', box);
  }

  scegliRullo(titolo, cb) {
    const wrap = el('div', 'sel-caselle');
    for (let i = 0; i < 3; i++) {
      const b = el('button', 'sel-cella');
      b.innerHTML = `<div class="sc-n">Rullo ${i + 1}</div><div class="sc-m">${this.g.rulli[i].length} simboli</div>`;
      b.onclick = () => { this.chiudiSelettore(); cb(i); };
      wrap.appendChild(b);
    }
    this.apriSelettore(titolo, wrap);
  }

  scegliSimbolo(titolo, cb) {
    const wrap = el('div', 'strisce');
    for (let r = 0; r < 3; r++) {
      const riga = el('div', 'striscia');
      riga.appendChild(el('div', 'striscia-n', 'R' + (r + 1)));
      const cont = el('div', 'striscia-sym');
      this.g.rulli[r].forEach((sid, k) => {
        const s = el('button', 'chip-sym');
        s.innerHTML = `<img src="${SIM[sid].img}" alt="${SIM[sid].nome}"><i>${SIM[sid].valore}</i>`;
        s.onclick = () => { const ok = cb(r, k); if (ok !== false) this.chiudiSelettore(); };
        cont.appendChild(s);
      });
      riga.appendChild(cont);
      wrap.appendChild(riga);
    }
    this.apriSelettore(titolo, wrap);
  }

  mostraRulli() {
    const wrap = el('div', 'strisce');
    for (let r = 0; r < 3; r++) {
      const riga = el('div', 'striscia');
      riga.appendChild(el('div', 'striscia-n', 'R' + (r + 1)));
      const cont = el('div', 'striscia-sym');
      this.g.rulli[r].forEach(sid => {
        const s = el('div', 'chip-sym');
        s.innerHTML = `<img src="${SIM[sid].img}" alt="${SIM[sid].nome}"><i>${SIM[sid].valore}</i>`;
        cont.appendChild(s);
      });
      riga.appendChild(cont); wrap.appendChild(riga);
    }
    this.apriSelettore('I tuoi rulli', wrap);
  }

  /* ------------------------------ disegno -------------------------- */
  disegnaTutto() {
    const g = this.g;
    this.el.hudRound.textContent = g.round;
    $('#hudRoundTot').textContent = g.infinito ? '∞' : TUNING.ROUND_TOTALI;
    const tipi = ['Piccola', 'Grande', 'BOSS'];
    this.el.hudTipo.textContent = tipi[g.tipoDi(g.round)];
    this.el.hudTipo.classList.toggle('boss', g.tipoDi(g.round) === 2);
    this.el.hudGettoni.textContent = g.gettoni;

    const nascosta = g.boss && g.boss.eff.cassaNascosta;
    this.el.hudCassa.textContent = nascosta ? '???' : fmt(g.cassa || 0);
    this.el.hudObiettivo.textContent = fmt(g.obiettivoCorrente || g.obiettivo(g.round));
    this.el.hudGiri.textContent = g.giriRimasti !== undefined ? g.giriRimasti : '—';
    const p = nascosta ? 0 : Math.max(0, Math.min(1, (g.cassa || 0) / (g.obiettivoCorrente || 1)));
    this.el.hudProg.style.width = (p * 100) + '%';
    this.el.hudProg.classList.toggle('pieno', p >= 1);

    // boss
    if (g.boss && g.fase === 'gioco') {
      this.el.bossBanner.classList.remove('hidden');
      this.el.bossBanner.innerHTML = `<span class="bb-ico">${g.boss.ico}</span><span class="bb-txt"><b>${g.boss.nome}</b> — ${g.boss.desc}</span>`;
    } else this.el.bossBanner.classList.add('hidden');

    this.disegnaCimeli(this.el.cimeliBar, false);
    this.disegnaConsumabili();
    this.disegnaCellMods();
    this.disegnaLucky();
    this.disegnaPuntata();
  }

  /* tabella dei pagamenti: quanto pagherebbe ogni simbolo alla puntata attuale */
  disegnaTabella() {
    const g = this.g;
    const box = $('#tabella');
    if (!box) return;
    const p = this.puntata;
    const ids = [...new Set(g.rulliRound ? [].concat(...g.rulliRound) : [].concat(...g.rulli))]
      .sort((a, b) => g.valoreDi(b) - g.valoreDi(a)).slice(0, 4);
    box.innerHTML = '';
    ids.forEach(id => {
      const v = g.valoreDi(id);
      const c2 = Math.round(p * (TUNING.VAL_COPPIA_SIM * v + TUNING.VAL_COPPIA_BASE) * TUNING.MOLT_COPPIA / TUNING.DIVISORE);
      const c3 = Math.round(p * (TUNING.VAL_TRIS_SIM * v + TUNING.VAL_TRIS_BASE) * TUNING.MOLT_TRIS / TUNING.DIVISORE);
      const e = el('div', 'pay' + (id === g.lucky ? ' lucky' : '') + (id === g.disattivato ? ' morto' : ''));
      e.innerHTML = `<img src="${SIM[id].img}" alt="${SIM[id].nome}">
        <span><i>2×</i>${fmt(c2)}<br><i>3×</i>${fmt(c3)}</span>`;
      box.appendChild(e);
    });
  }

  disegnaCimeli(box, vendibile) {
    const g = this.g;
    box.innerHTML = '';
    for (let i = 0; i < g.slotCimeli(); i++) {
      const c = g.cimeli[i];
      if (!c) { box.appendChild(el('div', 'cimelio vuoto', '')); continue; }
      const d = CIMELI_BY_ID[c.id];
      const e = el('div', 'cimelio r' + d.rar + (c.spento ? ' spento' : ''), `<span>${d.ico}</span>`);
      e.onclick = () => this.infoCimelio(i, vendibile);
      box.appendChild(e);
    }
  }

  infoCimelio(i, vendibile) {
    const g = this.g;
    const d = CIMELI_BY_ID[g.cimeli[i].id];
    const box = el('div', 'info-cimelio');
    box.innerHTML = `<div class="ic-ico">${d.ico}</div><div class="ic-nome">${d.nome}</div>
      <div class="ic-rar r${d.rar}">${RARITA[d.rar]}</div><div class="ic-desc">${d.desc}</div>`;
    if (vendibile) {
      const b = el('button', 'btn danger', `Vendi per 🎟️ ${Math.max(1, Math.floor(d.prezzo / 2))}`);
      b.onclick = () => { g.vendiCimelio(i); this.chiudiSelettore(); this.dopoAcquisto(); };
      box.appendChild(b);
    }
    this.apriSelettore('Cimelio', box);
  }

  disegnaConsumabili() {
    const g = this.g;
    const box = this.el.consBar;
    box.innerHTML = '';
    for (let i = 0; i < g.slotConsumabili(); i++) {
      const c = g.consumabili[i];
      if (!c) { box.appendChild(el('div', 'cons vuoto', '')); continue; }
      const d = CONS_BY_ID[c.id];
      const e = el('div', 'cons', `<span class="co-ico">${d.ico}</span><span class="co-n">${d.nome}</span>`);
      e.onclick = () => this.infoConsumabile(i);
      box.appendChild(e);
    }
  }

  infoConsumabile(i) {
    const g = this.g;
    const d = CONS_BY_ID[g.consumabili[i].id];
    const box = el('div', 'info-cimelio');
    box.innerHTML = `<div class="ic-ico">${d.ico}</div><div class="ic-nome">${d.nome}</div><div class="ic-desc">${d.desc}</div>`;
    if (g.fase === 'gioco' && !this.spinAttivo) {
      const b = el('button', 'btn primary', 'USA');
      b.onclick = () => { this.chiudiSelettore(); this.usaConsumabile(i); };
      box.appendChild(b);
    } else {
      box.appendChild(el('div', 'ic-nota', g.fase === 'gioco' ? 'Aspetta che i rulli si fermino.' : 'Si usa durante un round.'));
    }
    const v = el('button', 'btn danger', `Vendi per 🎟️ ${Math.max(1, Math.floor(d.prezzo / 2))}`);
    v.onclick = () => { g.vendiConsumabile(i); this.chiudiSelettore(); this.dopoAcquisto(); };
    if (g.fase === 'negozio') box.appendChild(v);
    this.apriSelettore('Consumabile', box);
  }

  usaConsumabile(i) {
    const g = this.g;
    const d = CONS_BY_ID[g.consumabili[i].id];
    if (d.bersaglio === 'simbolo') {
      this.scegliSimbolo('Tocca il simbolo da distruggere', (r, k) => {
        if (g.rulli[r].length <= 3) { this.flash('Un rullo deve avere almeno 3 simboli'); return false; }
        const m = g.usaConsumabile(i, { rullo: r, k });
        this.flash(m); this.costruisciRulli(); this.disegnaTutto(); g.salva(); return true;
      });
      return;
    }
    if (d.bersaglio === 'simbolo+scelta') {
      this.scegliSimbolo('Tocca il simbolo da trasformare', (r, k) => {
        this.scegliDaCatalogo('In quale simbolo?', (sid) => {
          const m = g.usaConsumabile(i, { rullo: r, k, sid });
          this.flash(m); this.costruisciRulli(); this.disegnaTutto(); g.salva();
        });
        return true;
      });
      return;
    }
    if (d.bersaglio === 'lucky') {
      this.scegliDaCatalogo('Nuovo simbolo Lucky', (sid) => {
        const m = g.usaConsumabile(i, { sid });
        this.flash(m); this.disegnaTutto(); g.salva();
      }, g.simboliInGioco());
      return;
    }
    const m = g.usaConsumabile(i);
    this.flash(m); this.disegnaTutto(); g.salva();
  }

  scegliDaCatalogo(titolo, cb, lista) {
    const ids = lista || SIMBOLI.map(s => s.id);
    const wrap = el('div', 'catalogo');
    ids.forEach(sid => {
      const b = el('button', 'chip-sym grande');
      b.innerHTML = `<img src="${SIM[sid].img}" alt=""><i>${SIM[sid].valore}</i>`;
      b.onclick = () => { this.chiudiSelettore(); cb(sid); };
      wrap.appendChild(b);
    });
    this.apriSelettore(titolo, wrap);
  }

  disegnaCellMods() {
    const g = this.g;
    const off = g.boss && g.boss.eff.modificatoriOff;
    this.el.cellmods.forEach((e, i) => {
      const m = g.modificatori[i];
      e.className = 'cellmod' + (m ? ' pieno' : '') + (off && m ? ' off' : '');
      e.innerHTML = m ? `<b>${i + 1}</b><span>${MOD_BY_ID[m].ico}</span>${MOD_BY_ID[m].nome}` : '';
      e.onclick = (ev) => {
        ev.stopPropagation();
        if (!m) return;
        const d = MOD_BY_ID[m];
        const box = el('div', 'info-cimelio');
        box.innerHTML = `<div class="ic-ico">${d.ico}</div><div class="ic-nome">Casella ${i + 1}: ${d.nome}</div><div class="ic-desc">${d.desc}</div>`;
        this.apriSelettore('Modificatore', box);
      };
    });
  }

  disegnaLucky() {
    const g = this.g;
    if (!g.lucky) { this.el.luckyChip.classList.add('spento'); this.el.luckyImg.removeAttribute('src'); return; }
    this.el.luckyChip.classList.remove('spento');
    if (g.luckyNascosto) { this.el.luckyChip.classList.add('nascosto'); this.el.luckyImg.removeAttribute('src'); }
    else {
      this.el.luckyChip.classList.remove('nascosto');
      this.el.luckyImg.src = this.immagineAnimataDi(g.lucky);
    }
    $('#luckyMult').textContent = '×' + g.mods().luckyMult;
  }

  immagineAnimataDi(id) {
    if (this.gif.attiva && this.gif.mappa && this.gif.mappa[id]) return this.gif.mappa[id].url;
    return SIM[id].img;
  }

  disegnaPuntata() {
    const g = this.g;
    const tetto = g.tetto ? g.tetto() : 1;
    const min = g.puntataMin ? g.puntataMin() : 1;
    this.puntata = Math.max(min, Math.min(this.puntata, tetto));
    this.el.betVal.textContent = fmt(this.puntata);
    $('#betTetto').textContent = 'max ' + fmt(tetto);
    const costo = g.costoGiro ? g.costoGiro(this.puntata, (g.giroNum || 0) + 1) : this.puntata;
    $('#betCosto').textContent = costo === 0 ? 'GRATIS' : '';
    this.disegnaTabella();
  }

  passoPuntata() {
    const t = this.g.tetto();
    return t <= 12 ? 1 : Math.max(1, Math.round(t / 12));
  }
  cambiaPuntata(d) {
    if (this.spinAttivo || !this.g.pot) return;
    this.puntata = this.puntata + d * this.passoPuntata();
    this.disegnaPuntata();
  }
  puntataMax() {
    if (this.spinAttivo || !this.g.pot) return;
    this.puntata = Math.min(this.g.tetto(), Math.max(this.g.puntataMin(), this.g.cassa));
    this.disegnaPuntata();
  }

  flash(msg) {
    if (!msg) return;
    const f = el('div', 'flash', msg);
    document.body.appendChild(f);
    setTimeout(() => f.classList.add('via'), 1200);
    setTimeout(() => f.remove(), 1700);
  }
  scuotiEl(e) { e.classList.remove('scuoti'); void e.offsetWidth; e.classList.add('scuoti'); }

  /* ------------------------------- menu ---------------------------- */
  apriMenu() {
    const box = el('div', 'menu-box');
    const b1 = el('button', 'btn', '📖 Come si gioca');
    b1.onclick = () => { this.chiudiSelettore(); this.mostraAiuto(); };
    const b2 = el('button', 'btn', '🎰 Guarda i rulli');
    b2.onclick = () => { this.chiudiSelettore(); this.mostraRulli(); };
    const b3 = el('button', 'btn danger', '🏳️ Abbandona la run');
    b3.onclick = () => {
      Gioco.cancellaSalvataggio(); this.chiudiSelettore();
      $$('.overlay').forEach(o => o.classList.add('hidden'));
      this.mostraSchermata('titolo');
    };
    box.appendChild(b1); box.appendChild(b2); box.appendChild(b3);
    this.apriSelettore('Menu', box);
  }

  mostraAiuto() { $('#ovAiuto').classList.remove('hidden'); $('#aiutoChiudi').onclick = () => $('#ovAiuto').classList.add('hidden'); }

  /* ---------------------------- modalità GIF ----------------------- */
  async apriZipGif() {
    if (!this.inputZip) {
      this.inputZip = document.createElement('input');
      this.inputZip.type = 'file'; this.inputZip.accept = '.zip,application/zip';
      this.inputZip.style.display = 'none';
      this.inputZip.addEventListener('change', async (e) => {
        const f = e.target.files && e.target.files[0];
        if (f) await this.caricaZipGif(f);
        this.inputZip.value = '';
      });
      document.body.appendChild(this.inputZip);
    }
    this.inputZip.click();
  }

  async caricaZipGif(file) {
    try {
      if (!window.JSZip) {
        await new Promise((ok, ko) => {
          const s = document.createElement('script');
          s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
          s.onload = ok; s.onerror = ko; document.head.appendChild(s);
        });
      }
      const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
      const voci = [];
      zip.forEach((p, e) => { if (!e.dir && p.toLowerCase().endsWith('.gif')) voci.push(e); });
      if (voci.length < 4) { this.flash('Servono almeno 4 GIF'); return; }
      const blobs = await Promise.all(voci.map(v => v.async('blob')));
      const urls = blobs.map(b => URL.createObjectURL(b));
      this.gif.mappa = {};
      SIMBOLI.forEach((s, i) => { this.gif.mappa[s.id] = { url: urls[i % urls.length] }; });
      this.gif.attiva = true;
      document.documentElement.classList.add('tema-gif');
      const H = this.altezzaSimbolo || 70;
      for (const id in this.gif.mappa) {
        try { this.gif.mappa[id].statico = await this.congelaGif(this.gif.mappa[id].url, Math.round(H * 0.95), H); } catch (e) { }
      }
      this.costruisciRulli(); this.disegnaTutto();
      this.flash('Modalità GIF attiva!');
    } catch (e) { this.flash('ZIP non valido'); }
  }

  async congelaGif(url, w, h) {
    const b = await (await fetch(url)).blob();
    const bm = await createImageBitmap(b);
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d');
    const sc = Math.max(w / bm.width, h / bm.height);
    const dw = bm.width * sc, dh = bm.height * sc;
    cx.drawImage(bm, (w - dw) / 2, (h - dh) / 2, dw, dh);
    return new Promise(r => cv.toBlob(bl => r(URL.createObjectURL(bl))));
  }

  mostraGifVincente(res) {
    if (!this.gif.attiva || !res.comboSym) return;
    const m = this.gif.mappa[res.comboSym];
    if (!m) return;
    const ov = el('div', 'gif-full');
    const img = document.createElement('img'); img.src = m.url;
    ov.appendChild(img); document.body.appendChild(ov);
    const via = () => ov.remove();
    ov.onclick = via;
    setTimeout(via, Math.min(12000, 2000 + res.vincita * 8));
  }
}

/* ========================== SIMULATORE ============================== */
/* ?sim=200  → gioca N run con un giocatore automatico e stampa le curve */
function simula(n, seed0) {
  const risultati = [];
  const morteA = {};
  for (let s = 0; s < n; s++) {
    const g = new Gioco((seed0 || 1) + s * 7919);
    g.nuovaRun();
    let vivo = true;
    while (vivo && g.round <= TUNING.ROUND_TOTALI) {
      g.iniziaRound();
      while (!g.esito) {
        const tetto = g.tetto();
        const manca = g.obiettivoCorrente - g.cassa;
        const giri = g.giriRimasti;
        // politica: punta quanto serve per arrivare in tempo, ma non suicidarti
        // finché hai giri (il guadagno netto atteso è circa +1,4 volte la puntata)
        let p = Math.ceil(manca / Math.max(1, giri * 1.4));
        const quota = giri > 2 ? 0.34 : (giri > 1 ? 0.6 : 1);
        p = Math.min(p, Math.max(1, Math.floor(g.cassa * quota)));
        p = Math.max(p, g.puntataMin());
        p = Math.min(p, g.cassa, tetto);
        if (p < 1) p = 1;
        const forz = g.forzati();
        const ids = [0, 1, 2].map(i => forz[i] || g.pescaRullo(i));
        for (let i = 0; i < 3; i++) ids[i] = g.correggiFermata(i, ids[i], ids);
        g.eseguiGiro(ids, p);
      }
      if (g.esito === 'perso') { vivo = false; morteA[g.round] = (morteA[g.round] || 0) + 1; break; }
      const premio = g.premi();
      g.chiudiRound(premio);
      compraAuto(g);
      if (g.round >= TUNING.ROUND_TOTALI) break;
      g.prossimoRound();
    }
    risultati.push({ round: g.round, vinta: vivo, gettoni: g.gettoni });
  }
  const vinte = risultati.filter(r => r.vinta).length;
  const medio = risultati.reduce((a, r) => a + r.round, 0) / n;
  const out = { run: n, vittorie: vinte, percentuale: (100 * vinte / n).toFixed(1) + '%', roundMedio: medio.toFixed(1), morti: morteA };
  console.log('=== SIMULAZIONE ===', out);
  return out;
}

function compraAuto(g) {
  // giocatore automatico: prima il tetto, poi cimeli, poi giri
  let sicurezza = 0;
  while (sicurezza++ < 20) {
    let fatto = false;
    if (!g.potMax('tetto') && g.gettoni >= g.prezzoPot('tetto') + 4) { g.compraPot('tetto'); fatto = true; }
    for (let i = 0; i < g.negozio.offerte.length; i++) {
      if (g.negozio.comprati.includes(i)) continue;
      const o = g.negozio.offerte[i];
      if (g.gettoni < o.prezzo) continue;
      if (o.tipo === 'cimelio' && g.cimeli.length < g.slotCimeli()) {
        g.gettoni -= o.prezzo; g.cimeli.push({ id: o.id }); g.negozio.comprati.push(i); fatto = true;
      } else if (o.tipo === 'mod' && g.modificatori.includes(null)) {
        g.gettoni -= o.prezzo; g.modificatori[g.modificatori.indexOf(null)] = o.id; g.negozio.comprati.push(i); fatto = true;
      } else if (o.tipo === 'rullo') {
        const s = o.sid, v = SIM[s].valore;
        if (o.azione === 'aggiungi' && v >= 5) { g.gettoni -= o.prezzo; g.rulli[g.rndInt(3)].push(s); g.negozio.comprati.push(i); fatto = true; }
        else if (o.azione === 'aggiungiTutti' && v >= 5) { g.gettoni -= o.prezzo; g.rulli.forEach(r => r.push(s)); g.negozio.comprati.push(i); fatto = true; }
        else if (o.azione === 'trasforma' && v >= 6) {
          const r = g.rndInt(3);
          let peggiore = 0;
          g.rulli[r].forEach((x, k) => { if (SIM[x].valore < SIM[g.rulli[r][peggiore]].valore) peggiore = k; });
          g.rulli[r][peggiore] = s; g.gettoni -= o.prezzo; g.negozio.comprati.push(i); fatto = true;
        } else if (o.azione === 'rimuovi') {
          const r = g.rndInt(3);
          if (g.rulli[r].length > 4) {
            let peggiore = 0;
            g.rulli[r].forEach((x, k) => { if (SIM[x].valore < SIM[g.rulli[r][peggiore]].valore) peggiore = k; });
            g.rulli[r].splice(peggiore, 1); g.gettoni -= o.prezzo; g.negozio.comprati.push(i); fatto = true;
          }
        }
      }
    }
    if (!g.potMax('giri') && g.gettoni >= g.prezzoPot('giri') + 8) { g.compraPot('giri'); fatto = true; }
    if (!fatto) break;
  }
}

/* ============================== AVVIO =============================== */
document.addEventListener('DOMContentLoaded', () => {
  const par = new URLSearchParams(location.search);
  if (window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()) {
    document.body.classList.add('capacitor');
  }
  const ui = new Interfaccia();
  if (par.has('turbo')) ui.turbo = true;
  window.__slot = { ui, Gioco, simula, TUNING };
  if (par.has('sim')) {
    const n = parseInt(par.get('sim'), 10) || 100;
    setTimeout(() => { window.__risultatoSim = simula(n); }, 50);
  }
});
