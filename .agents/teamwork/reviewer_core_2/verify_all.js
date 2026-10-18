const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('====================================================');
console.log('  REVIEWER CORE 2: INDEPENDENT VERIFICATION SUITE   ');
console.log('====================================================\n');

const ROOT = path.resolve(__dirname, '..', '..', '..');

// 1. Inspect HTML and CSS
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');

console.log('--- 1. UI Integration Checks ---');
assert.ok(html.includes('data-tab="missions"'), 'Must have missions tab button in #setSide');
assert.ok(html.includes('data-sec="missions"'), 'Must have missions section in #setPane');
assert.ok(html.includes('id="missionResults"'), 'Must have #missionResults modal overlay');
assert.ok(html.includes('id="missionActiveHud"'), 'Must have #missionActiveHud floating HUD');
assert.ok(html.includes('id="cooldownZoneHud"'), 'Must have #cooldownZoneHud radar');
assert.ok(html.includes('src="./missions_hub.js"'), 'Must import missions_hub.js');
assert.ok(html.includes('src="./game_enhancements.js"'), 'Must import game_enhancements.js');

assert.ok(css.includes('.sec[data-sec="missions"]'), 'Must style .sec[data-sec="missions"]');
assert.ok(css.includes('.act-card'), 'Must style .act-card');
assert.ok(css.includes('#missionResults.on'), 'Must style #missionResults.on');
assert.ok(css.includes('.mission-active-hud'), 'Must style .mission-active-hud');
assert.ok(css.includes('.cooldown-zone-hud'), 'Must style .cooldown-zone-hud');
console.log('✓ UI integration markup and styles verified.');

// 2. Persistence & Missions Hub in Node Sandbox
console.log('\n--- 2. Missions Persistence & Adversarial Tests ---');

// Mock DOM & window
global.window = {};
global.document = {
  readyState: 'complete',
  getElementById: (id) => ({
    id,
    style: {},
    classList: { add(){}, remove(){}, toggle(){} },
    textContent: ''
  }),
  querySelectorAll: () => [],
  querySelector: () => null,
  addEventListener: () => {}
};

let store = {};
global.localStorage = {
  getItem: (k) => store[k] || null,
  setItem: (k, v) => { store[k] = String(v); },
  removeItem: (k) => { delete store[k]; },
  clear: () => { store = {}; }
};

const { pathToFileURL } = require('url');

pathToFileURL(path.join(ROOT, 'missions_hub.js')).href;
import(pathToFileURL(path.join(ROOT, 'missions_hub.js')).href).then(({ missionsHub, MissionPersistence, MISSION_CATALOG }) => {
  assert.ok(missionsHub, 'missionsHub must be exported');
  assert.ok(MissionPersistence, 'MissionPersistence must be exported');
  assert.ok(MISSION_CATALOG, 'MISSION_CATALOG must be exported');
  assert.strictEqual(Object.keys(MISSION_CATALOG).length, 10, 'Catalog must contain 10 missions');

  // Test 2.1: Save normal record
  const res1 = MissionPersistence.updateRecord({
    missionId: 'california',
    missionType: 'race',
    success: true,
    time: 70.5,
    score: 1000,
    stars: 3,
    medal: 'gold',
    cash: 3500,
    xp: 1200
  });
  assert.strictEqual(res1.isNewBest, true);
  let saved = JSON.parse(store['sf-drive.missions']);
  assert.strictEqual(saved.records.california.bestTime, 70.5);
  assert.strictEqual(saved.records.california.stars, 3);
  assert.strictEqual(saved.records.california.medal, 'gold');
  assert.strictEqual(saved.stats.totalCompleted, 1);
  assert.strictEqual(saved.stats.totalCash, 3500);
  assert.strictEqual(saved.stats.totalXP, 1200);

  // Test 2.2: Non-regression on worse attempt
  const res2 = MissionPersistence.updateRecord({
    missionId: 'california',
    missionType: 'race',
    success: true,
    time: 95.0, // worse time
    score: 500, // lower score
    stars: 1,   // fewer stars
    medal: 'bronze',
    cash: 1000,
    xp: 400
  });
  assert.strictEqual(res2.isNewBest, false);
  saved = JSON.parse(store['sf-drive.missions']);
  assert.strictEqual(saved.records.california.bestTime, 70.5, 'Best time must NOT regress');
  assert.strictEqual(saved.records.california.stars, 3, 'Stars must NOT regress');
  assert.strictEqual(saved.records.california.attempts, 2, 'Attempts must increment');
  assert.strictEqual(saved.stats.totalCompleted, 1, 'Total completed must not double count');
  assert.strictEqual(saved.stats.totalCash, 4500, 'Cash should accumulate');
  console.log('✓ Normal persistence and non-regression verified.');

  // Test 2.3: Corrupt localStorage recovery
  store['sf-drive.missions'] = '{malformed json...';
  const fallback = MissionPersistence.load();
  assert.deepStrictEqual(fallback.records, {}, 'Corrupt storage must fall back gracefully');
  assert.strictEqual(fallback.stats.totalCompleted, 0);
  console.log('✓ Corrupt localStorage recovery verified.');

  // Test 2.4: Guest wallet synchronization
  store['teleop2.guest'] = JSON.stringify({ name: 'Guest', earned: 1000, xp: 500, race: { money: 1000 }, cash: { base: 1000 } });
  MissionPersistence.creditGuestWallet(500, 250);
  const guest = JSON.parse(store['teleop2.guest']);
  assert.strictEqual(guest.earned, 1500);
  assert.strictEqual(guest.xp, 750);
  assert.strictEqual(guest.race.money, 1500);
  assert.strictEqual(guest.cash.base, 1500);
  console.log('✓ Guest wallet crediting verified.');

  // 3. Physics & Garage Inspection
  console.log('\n--- 3. Game Enhancements Physics & Garage Analysis ---');
  const enhCode = fs.readFileSync(path.join(ROOT, 'game_enhancements.js'), 'utf8');

  // Check handling mode implementation
  assert.ok(enhCode.includes('setHandlingMode'), 'Must implement setHandlingMode');
  assert.ok(enhCode.includes("mode === 'simulator'"), 'Must handle simulator vs arcade');
  assert.ok(enhCode.includes('v.S.rearGrip = 1.26'), 'Arcade grip must be elevated');
  assert.ok(enhCode.includes('v.S.rearGrip = 1.0'), 'Simulator grip must be standard');

  // Check discrepancy in nitro property:
  const hasNitroRefill = enhCode.includes('v.S.nitroRefill');
  const hasNitroFill = enhCode.includes('v.S.nitroFill');
  console.log('Handling mode sets v.S.nitroRefill:', hasNitroRefill);
  console.log('Handling mode sets v.S.nitroFill:', hasNitroFill);
  if (hasNitroRefill && !hasNitroFill) {
    console.log('⚠ FINDING: game_enhancements.js sets v.S.nitroRefill, but app.js physics engine uses v.S.nitroFill!');
  }

  // Check garage carbon finish & window tint
  assert.ok(enhCode.includes('setWindowTint'), 'Must implement setWindowTint');
  assert.ok(enhCode.includes("'carbon'"), 'Must register carbon');
  console.log('✓ Basic physics & garage functions defined in game_enhancements.js.');

  console.log('\n====================================================');
  console.log('  VERIFICATION SCRIPT COMPLETE                       ');
  console.log('====================================================');
  process.exit(0);
}).catch(err => {
  console.error('Test script failure:', err);
  process.exit(1);
});
