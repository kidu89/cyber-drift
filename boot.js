// The page's first script (classic, not a module: it runs before the module graph (~40 files) has loaded): the device's
// tier and the crash recovery, then the downloads the city's build waits on start now instead of once main.js runs
// (~0.5 s later). mindblown/assets.js fetchBytes picks the responses up (globalThis.SF_PRE: the fetched URL ->
// Promise<Response>). data-gz (dist): the binaries are <file>.gz.
(function () {
  var Q = new URLSearchParams(location.search);
  // Teleoperator's build (./build.sh taxi: data-variant="taxi"): the taxi mode alone (config.js reads SF_VARIANT)
  if (document.currentScript && document.currentScript.getAttribute('data-variant') === 'taxi') globalThis.SF_VARIANT = 'taxi';
  // ------------------------------------------------------------ the device tier
  //   'desktop';
  //   'mobile' (phones, tablets, a device with <= 4 GB: iOS kills a tab's process past ~1-1.5 GB - its JS, decoded images
  //     and audio, and its GPU memory - so the city's radii, textures, shadows, traffic and props are cut to ~0.6 GB);
  //   'safe' (the lightest: a smaller city round the car, 0.6 render scale, no shadows, no ocean simulation, no baked sky
  //     visibility) - taken on its own when the last start did not end (the crash recovery below), or ?tier=safe.
  // Phones and tablets: iOS (iPadOS says it is a Mac: MacIntel with a touch screen), Android, any "Mobile" UA, and a
  // device whose only pointer is a finger (an unknown touch device is taken for a phone). ?tier=desktop|mobile|safe
  // forces one. SF_LITE: any tier but desktop. (main.js also asks the GPU adapter: a phone's GPU behind a desktop UA)
  var UA = navigator.userAgent, touch = navigator.maxTouchPoints > 1;
  var ios = /iPhone|iPad|iPod/.test(UA) || (touch && /Mac/.test(navigator.platform || '') && !/Windows/.test(UA));
  globalThis.SF_IOS = ios;
  var coarseOnly = false; try { coarseOnly = navigator.maxTouchPoints > 0 && matchMedia('(pointer: coarse)').matches && !matchMedia('(any-pointer: fine)').matches; } catch (e) { /* */ }
  var mobile = ios || /Android|Mobile|Silk|Kindle|PlayBook|BlackBerry|Opera Mini|IEMobile/i.test(UA) || coarseOnly || Q.has('mobile');
  var lowMem = navigator.deviceMemory && navigator.deviceMemory <= 4;
  // (round 25) an older or smaller iPhone (no deviceMemory on iOS; WebGPU there needs iOS 26: the iPhone 11 and later): a
  // 2x screen (the 11 / XR) or one 375 points wide (the X / XS / 11 Pro, the minis, the SE) - an A13 / A14 or a small
  // battery: the battery saver. The iPhone 12 / 13 / 14 and later (390-440 points, 3x) take the mobile level.
  var oldPhone = /iPhone/.test(UA) && ((window.devicePixelRatio || 3) < 2.5 || Math.min(screen.width, screen.height) <= 375);
  // ------------------------------------------------------------ the graphics level (round 25: one setting, the menu's)
  //   saver (the safe tier) < mobile (the mobile tier) < perf < high < ultra (the desktop tier at that quality);
  //   'auto' (the default): the device's own - mobile on phones and tablets (saver on an older iPhone), high otherwise.
  // Picked in the pause menu (ui/pause.js: localStorage 'sf-drive.gfx', applied by a reload); ?gfx= does the same for
  // one load, and the older ?tier=desktop|mobile|safe / ?q=perf|high|ultra still work. SF_TIER is the city's tier
  // (desktop | mobile | safe; SF_LITE: any but desktop), SF_Q the renderer's quality (config.js, main.js).
  var LV = ['saver', 'mobile', 'perf', 'high', 'ultra'], LVT = { saver: 'safe', mobile: 'mobile', perf: 'desktop', high: 'desktop', ultra: 'desktop' };
  var LVQ = { saver: 'perf', mobile: 'perf', perf: 'perf', high: 'high', ultra: 'ultra' }, NAME = { saver: 'Battery saver', mobile: 'Mobile', perf: 'Performance', high: 'High', ultra: 'Ultra' };
  var KEY = 'sf-drive.boot', CAP = 'sf-drive.cap', GFX = 'sf-drive.gfx', own = oldPhone ? 'saver' : mobile || lowMem ? 'mobile' : 'high';
  var note = '', store = null;
  try { store = window.localStorage; store.getItem(KEY); } catch (e) { store = null; }
  var picked = 'auto'; try { if (store) picked = store.getItem(GFX) || 'auto'; } catch (e) { /* */ }
  if (picked === 'auto' && own === 'high' && store) try { var oq = (JSON.parse(store.getItem('sf-drive.settings') || '{}') || {}).quality; if (oq === 'perf' || oq === 'ultra') picked = oq; } catch (e) { /* */ }   // (the older menu's quality, a desktop's)
  var url = Q.get('gfx') || (Q.get('tier') === 'safe' ? 'saver' : Q.get('tier') === 'mobile' ? 'mobile' : Q.get('tier') === 'desktop' || Q.get('q') ? (LV.indexOf(Q.get('q')) >= 2 ? Q.get('q') : 'high') : null);
  // (round 31) the auto level as this device measured it (main.js / ui/autogfx.js: the first start's few-second benchmark,
  // or a step down after a sustained low frame rate): never above the device's own, kept 30 days for this browser
  var AUTO = 'sf-drive.auto', tuned = null;
  try { if (store) { tuned = JSON.parse(store.getItem(AUTO) || 'null'); if (!tuned || tuned.ua !== UA || Date.now() - tuned.t > 30 * 864e5 || LV.indexOf(tuned.lvl) < 0) tuned = null; } } catch (e) { tuned = null; }
  if (tuned && LV.indexOf(tuned.lvl) < LV.indexOf(own) && (!Q.has('test') || Q.has('autogfx'))) own = tuned.lvl;
  var choice = LV.indexOf(url) >= 0 || url === 'auto' ? url : LV.indexOf(picked) >= 0 ? picked : 'auto';
  var want = choice === 'auto' ? own : choice, lvl = want;
  // the crash recovery: a flag set as the load starts, cleared once it is up (SF_BOOT.ready) and kept fresh while the game
  // runs (cleared on pagehide / when hidden). Found set: the last start was killed - iOS's black "A problem repeatedly
  // occurred" page is its tab reloading and dying again - so this one runs a level lighter (ultra -> high -> perf ->
  // mobile -> saver), and later ones with the same choice stay there (CAP: { lvl, for: the choice that crashed }). A new
  // pick in the menu lifts it (ui/pause.js); picking the same one again tries it again.
  if (store) try {
    var prev = JSON.parse(store.getItem(KEY) || 'null'), age = prev ? Date.now() - prev.t : 1e12;
    var crashed = prev && age < 864e5 && (prev.phase === 'load' || (prev.phase === 'run' && age < 120e3));
    var pl = prev && (LV.indexOf(prev.lvl) >= 0 ? prev.lvl : prev.tier === 'safe' ? 'saver' : prev.tier === 'mobile' ? 'mobile' : 'high');   // (an older flag: its tier)
    if (crashed && pl !== 'saver') { var down = LV[Math.max(0, LV.indexOf(pl) - 1)]; store.setItem(CAP, JSON.stringify({ lvl: down, for: prev.choice || 'auto' }));
      note = 'Running ' + NAME[down] + ' after an interrupted ' + NAME[pl] + ' session · retry in Menu → Graphics'; }
    var cap = store.getItem(CAP); try { cap = JSON.parse(cap); } catch (e) { cap = { lvl: cap === 'safe' ? 'saver' : cap, for: 'auto' }; }   // (an older cap: a tier name)
    if (cap && LV.indexOf(cap.lvl) >= 0 && (cap.for || 'auto') === choice && LV.indexOf(cap.lvl) < LV.indexOf(lvl)) { lvl = cap.lvl;
      if (!note) note = 'Running ' + NAME[lvl] + ' after an interrupted ' + NAME[want] + ' session · retry in Menu → Graphics'; }
  } catch (e) { /* (no storage: no recovery) */ }
  var tier = LVT[lvl];
  globalThis.SF_TIER = tier; globalThis.SF_LITE = tier !== 'desktop'; globalThis.SF_TIER_FORCED = choice !== 'auto'; globalThis.SF_TIER_NOTE = note;
  globalThis.SF_GFX = { choice: choice, lvl: lvl, own: own, want: want, url: !!url, levels: LV, names: NAME, tuned: tuned };   // (the pause menu shows these)
  globalThis.SF_Q = LVQ[lvl];
  var phase = 'load', put = function (p) { phase = p; try { if (store) store.setItem(KEY, JSON.stringify({ phase: p, t: Date.now(), tier: tier, lvl: lvl, choice: choice })); } catch (e) { /* (full) */ } };
  var clear = function () { try { if (store) store.removeItem(KEY); } catch (e) { /* */ } };
  // (a reload, a tab closed or put in the background: no crash - cleared; set again when it shows)
  addEventListener('pagehide', clear); document.addEventListener('visibilitychange', function () { if (document.hidden) clear(); else put(phase); });
  globalThis.SF_BOOT = {
    ready: function () {   // (main.js, once the title card's Drive shows)
      put('run'); setInterval(function () { if (phase === 'run' && !document.hidden) put('run'); }, 10000);
    },
    fail: function () { phase = 'failed'; clear(); },   // (the load stopped on an error, not killed: no lighter tier next time)
    // An explicit allocation failure must survive an ordinary reload too. On a
    // phone running desktop graphics, go directly to Mobile rather than failing
    // through Ultra, High and Performance on successive launches. Never auto-reload.
    recover: function () {
      var down = LV[Math.max(0, LV.indexOf(lvl) - 1)];
      if (mobile && LV.indexOf(down) > 1) down = 'mobile';
      try { if (store) store.setItem(CAP, JSON.stringify({ lvl: down, for: choice })); } catch (e) { /* */ }
      phase = 'failed'; clear(); return { level: down, changed: down !== lvl };
    },
    // (main.js: a phone's GPU behind a desktop UA - the auto level only: the mobile one from then on)
    lower: function (t) { try { store.setItem(CAP, JSON.stringify({ lvl: t === 'safe' ? 'saver' : t, for: 'auto' })); } catch (e) { /* */ } clear(); },
    // (ui/pause.js: a level picked in the menu - saved, any crash cap lifted, the URL's own choice dropped; applied live
    // by main.js, the crash flag recording it from now on; returns the level it resolves to)
    pick: function (c) { try { if (store) { store.setItem(GFX, c); store.removeItem(CAP); } } catch (e) { /* */ }
      choice = c; lvl = c === 'auto' ? own : c; var G = globalThis.SF_GFX; G.choice = c; G.lvl = lvl; G.want = lvl; G.url = false; globalThis.SF_TIER_NOTE = '';
      if (phase === 'run' || phase === 'load') put(phase);
      try { var u = new URL(location.href); ['gfx', 'tier', 'q'].forEach(function (k) { u.searchParams.delete(k); }); if (!store && c !== 'auto') u.searchParams.set('gfx', c); history.replaceState(history.state, '', u.toString()); } catch (e) { /* */ }
      return lvl; },
    restart: function () { clear(); location.reload(); },
    // (round 31: ui/autogfx.js) the auto level measured on this device - saved (null: measured, the device's own kept);
    // the running level follows when the choice is auto; returns the level now running
    tune: function (l, why) { var G = globalThis.SF_GFX; G.tuned = { lvl: l || own, ua: UA, t: Date.now(), why: why || '' };
      try { if (store) store.setItem(AUTO, JSON.stringify(G.tuned)); } catch (e) { /* */ }
      if (l && LV.indexOf(l) < LV.indexOf(own)) { own = l; G.own = l; if (choice === 'auto') { lvl = l; G.lvl = l; G.want = l; if (phase === 'run' || phase === 'load') put(phase); } }
      return lvl; },   // (the rest of a level - the city's detail, the textures - built at the load)
  };
  put('load');
  // ------------------------------------------------------------ the GPU, the workers, the downloads
  // the GPU adapter and device (the renderer's init takes them: ~0.7 s of promises that waited on the main thread otherwise)
  if (navigator.gpu) globalThis.SF_GPU = navigator.gpu.requestAdapter({ powerPreference: 'high-performance' }).then(function (a) {
    if (!a) return null;
    var want = ['timestamp-query', 'shader-f16'].filter(function (f) { return a.features.has(f); }), lim = Math.min(a.limits.maxSampledTexturesPerShaderStage || 16, 32);
    return a.requestDevice({ requiredFeatures: want, requiredLimits: lim > 16 ? { maxSampledTexturesPerShaderStage: lim } : {} }).then(function (d) { return { adapter: a, device: d, texLimit: lim }; },
      function () { return (lim > 16 ? a.requestDevice({ requiredLimits: { maxSampledTexturesPerShaderStage: lim } }).then(function (d) { return { adapter: a, device: d, texLimit: lim }; }) : Promise.reject(0))   // (round 31: a feature refused - the limit kept)
        .catch(function () { return a.requestDevice().then(function (d) { return { adapter: a, device: d, texLimit: 16 }; }); }); });   // (a limit refused too: the defaults)
  }).catch(function () { return null; });
  if (!navigator.gpu) return;   // (no WebGPU: main.js says so; nothing to download)
  var gz = !!(document.currentScript && document.currentScript.hasAttribute('data-gz'));
  var taxi = globalThis.SF_VARIANT === 'taxi' || /[?&](mode=(waymo|taxi)|variant=taxi)\b/i.test(location.search);
  // the workers (src/workers/*.js: the textures' decoders, the car's geometry, the sky), started before the downloads
  // queue up (a worker's script is fetched like any file, and its start-up needs the main thread): globalThis.SF_WORKERS
  try {
    var mk = function (n) { var w = new Worker((gz ? './workers/' : './src/workers/') + n + '.js', { type: 'module' }); w.addEventListener('message', function (e) { if (e.data && e.data.hi) w.sfUp = true; }); return w; };
    var ni = globalThis.SF_LITE ? 2 : Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 2)), img = [];
    for (var k = 0; k < ni; k++) img.push(mk('img'));
    globalThis.SF_WORKERS = { img: img, car: taxi ? null : mk('car'), sky: mk('sky') };   // (the taxi mode: no 458 to prepare)
  } catch (e) { globalThis.SF_WORKERS = null; }
  if (typeof fetch !== 'function' || Q.has('grid')) return;
  var P = globalThis.SF_PRE = new Map();
  var get = function (url, pr) { var p = fetch(url, { priority: pr }); p.catch(function () {}); P.set(url, p); };
  ['roads', 'terrain', 'buildings', 'props', 'coast', 'ground', 'green', 'btags'].concat(Q.has('nosky') || tier === 'safe' || ((gz || Q.has('latesky')) && !Q.has('nolatesky')) ? [] : ['sky'])   // (safe: no baked sky visibility, main.js; forza59: a dist's after the others - main.js LATESKY)
    .forEach(function (f) { get('assets/real/' + f + '.bin' + (gz ? '.gz' : ''), 'high'); });
  if (tier === 'desktop' && !Q.has('nohero')) get('assets/veg/trees.bin' + (gz ? '.gz' : ''), 'high');   // (round 22: the baked hero trees, before the props are built)
})();
