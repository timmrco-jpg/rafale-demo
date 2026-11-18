// Mesure d'une version du jeu sur le téléphone, lancée par versions.html.
// Chargé en tête de chaque page de jeu reconstituée (vjeu_<id>.html), avant le code du jeu ; actif seulement avec ?versions=<id>.
// Il ne demande rien au code du jeu (qui change d'une version à l'autre) : il enveloppe requestAnimationFrame et le contexte WebGL,
// appuie sur le bouton de départ (scen=vol : « Décoller » de la Conquête, départ en vol ; scen=combat : « Décoller » du Combat),
// puis mesure :
//   1) 20 s « comme en jeu » : intervalle entre deux images (ce que voit le joueur) ;
//   2) 10 s « vrai temps » : après chaque image, lecture d'un point de l'image, qui oblige la carte graphique à avoir fini.
// Le résultat va dans localStorage « fighterz-versions-res », puis retour à versions.html, qui lance la mesure suivante.
(() => {
  const P = new URLSearchParams(location.search);
  const ID = P.get('versions');
  if (!ID) return;
  const SCEN = P.get('scen') || 'vol';
  const RANG = P.get('rang') || '';
  const lire = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } };
  const ecrire = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} };

  // Safari peut recharger seul une page qui a manqué de mémoire : au troisième chargement de la même mesure, on la note en échec.
  const cours = lire('fighterz-versions-cours', null);
  let essais = 1;
  if (cours && cours.id === ID && cours.scen === SCEN && cours.rang === RANG) essais = (cours.essais || 0) + 1;
  ecrire('fighterz-versions-cours', { id: ID, scen: SCEN, rang: RANG, essais });

  const M = { gl: null, phase: 0, iv: [], sync: [], js: [], draws: 0, drawsTot: 0, n: 0, last: 0, px: new Uint8Array(4) };
  const gc = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    const c = gc.call(this, type, attrs);
    if (c && type === 'webgl2' && !M.gl) {
      M.gl = c;
      for (const k of ['drawElements', 'drawArrays', 'drawElementsInstanced', 'drawArraysInstanced', 'drawRangeElements']) {
        const o = c[k].bind(c);
        c[k] = function (...a) { M.draws++; return o(...a); };
      }
    }
    return c;
  };

  const raf = window.requestAnimationFrame.bind(window);
  let file = new Map(), n = 0, prevu = false;
  window.requestAnimationFrame = cb => { const i = ++n; file.set(i, cb); if (!prevu) { prevu = true; raf(tour); } return i; };
  window.cancelAnimationFrame = i => { file.delete(i); };
  function tour(ts) {
    prevu = false; const q = file; file = new Map();
    M.draws = 0;
    const t0 = performance.now();
    for (const cb of q.values()) { try { cb(ts); } catch (e) { setTimeout(() => { throw e; }); } }
    const t1 = performance.now();
    if (M.phase === 1 && M.last) { M.iv.push(t0 - M.last); M.drawsTot += M.draws; M.n++; }
    if (M.phase === 2 && M.gl) {
      const gl = M.gl, lu = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
      gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, M.px);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, lu);
      M.sync.push(performance.now() - t0); M.js.push(t1 - t0);
    }
    M.last = t0;
  }

  let bandeau = null;
  const montrer = t => {
    if (!bandeau && document.body) {
      bandeau = document.createElement('div');
      bandeau.style.cssText = 'position:fixed;left:50%;top:6px;transform:translateX(-50%);z-index:99999;padding:3px 10px;border-radius:8px;background:#000a;color:#fff;font:600 13px/1.3 ui-monospace,Menlo,monospace;pointer-events:none';
      document.body.appendChild(bandeau);
    }
    if (bandeau) bandeau.textContent = t;
  };
  const pause = ms => new Promise(ok => setTimeout(ok, ms));
  const quantile = (a, p) => { const v = [...a].sort((x, y) => x - y); return v.length ? v[Math.min(v.length - 1, Math.floor(p * v.length))] : 0; };
  const erreurs = [];
  window.addEventListener('error', e => { if (erreurs.length < 3) erreurs.push(String(e.message || e).slice(0, 120)); });

  async function derouler() {
    if (essais >= 3) return fin({ echec: 'rechargée' });
    const idBouton = SCEN === 'combat' ? 'bCombat' : 'bStart';
    let b = null;
    for (let i = 0; i < 240; i++) {
      b = document.getElementById(idBouton);
      if (b && !b.disabled && M.gl) break;
      montrer(`${RANG} · ${Math.round(i / 2)} s`);
      await pause(500);
    }
    if (!b || b.disabled) return fin({ echec: 'menu' });
    await pause(1500);
    b.click();
    for (let s = 8; s > 0; s--) { montrer(`${RANG} · ${s}`); await pause(1000); }
    M.phase = 1;
    for (let s = 20; s > 0; s--) { montrer(`${RANG} · ● ${s}`); await pause(1000); }
    M.phase = 2;
    for (let s = 10; s > 0; s--) { montrer(`${RANG} · ◆ ${s}`); await pause(1000); }
    M.phase = 0;
    const iv = M.iv, moy = iv.reduce((a, x) => a + x, 0) / Math.max(1, iv.length);
    fin({
      ips: Math.round(1000 / moy * 10) / 10,
      a60: Math.round(100 * iv.filter(x => x < 20).length / Math.max(1, iv.length)),
      lent: Math.round(quantile(iv, 0.99)),
      acoups: iv.filter(x => x > 50).length,
      vrai: Math.round(quantile(M.sync, 0.5) * 10) / 10,
      vrai90: Math.round(quantile(M.sync, 0.9) * 10) / 10,
      js: Math.round(quantile(M.js, 0.5) * 10) / 10,
      dessins: Math.round(M.drawsTot / Math.max(1, M.n)),
      ecran: `${screen.width}×${screen.height}`, dpr: devicePixelRatio,
    });
  }
  function fin(r) {
    const res = lire('fighterz-versions-res', []);
    res.push({ id: ID, scen: SCEN, rang: RANG, chauffe: P.has('chauffe'), date: new Date().toISOString(), essais, erreurs, ...r });
    ecrire('fighterz-versions-res', res);
    try { localStorage.removeItem('fighterz-versions-cours'); } catch (e) {}
    location.replace('versions.html?suite=1');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', derouler); else derouler();
})();
