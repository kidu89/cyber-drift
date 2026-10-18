/**
 * missions_hub.js - Open-World San Francisco Missions & Activities Subsystem
 *
 * Provides:
 * 1. Checkpoint Races (Time Trials with AI rivals, checkpoints, split times, medals)
 * 2. Police Pursuit Challenges (Heat 1-5, roadblocks, spike strips, helicopter, Cooldown Zones)
 * 3. Drift & Stunt Events (Lombard St downhill brick switchbacks, Twin Peaks ridge slide)
 * 4. VIP & Luxury Taxi Fares (Comfort rating, G-force monitoring, express countdown)
 * 5. In-game Active Mission HUD & 3D Waypoint / Checkpoint Markers
 * 6. Post-Mission Results Summary Modal Overlay with Rewards
 * 7. State Persistence to localStorage under 'sf-drive.missions' and 'teleop2.guest'
 * 8. Pause Menu Activities Tab & Interactive Activity Cards integration
 */

// ============================================================================
// MISSION CATALOG & CONFIGURATION
// ============================================================================

// Environment-safe animation frame helpers
const reqAnimFrame = (typeof requestAnimationFrame !== 'undefined')
  ? requestAnimationFrame
  : (cb => setTimeout(cb, 16));

const cancelAnimFrame = (typeof cancelAnimationFrame !== 'undefined')
  ? cancelAnimationFrame
  : (id => clearTimeout(id));

export const MISSION_CATALOG = {
  // 1. Checkpoint Races (Time Trials)
  california: {
    id: 'california',
    type: 'race',
    name: 'California Street Sprint',
    sub: 'Van Ness over Nob Hill to Financial District',
    desc: 'High-speed descent through the historic cable car corridor of California Street.',
    startPos: { x: -2541, z: 574, psi: 1.57 },
    finishPos: { x: -257, z: 205 },
    distance: 2350,
    targets: { gold: 75, silver: 88, bronze: 105 }, // seconds
    reward: { cash: 3500, xp: 1200 },
    checkpoints: [
      { x: -2541, z: 574 },
      { x: -2080, z: 510 },
      { x: -1620, z: 430 },
      { x: -1150, z: 340 },
      { x: -700, z: 270 },
      { x: -257, z: 205, fin: true }
    ]
  },
  powell: {
    id: 'powell',
    type: 'race',
    name: 'Powell to the Bay',
    sub: "Union Square up Nob Hill & down Hyde St to Fisherman's Wharf",
    desc: "Hill climb past cable cars and steep drop down towards the bay.",
    startPos: { x: -1264, z: 1114, psi: -1.57 },
    finishPos: { x: -2381, z: -1237 },
    distance: 2800,
    targets: { gold: 90, silver: 108, bronze: 130 },
    reward: { cash: 4200, xp: 1500 },
    checkpoints: [
      { x: -1264, z: 1114 },
      { x: -1310, z: 550 },
      { x: -1360, z: 0 },
      { x: -1850, z: -600 },
      { x: -2381, z: -1237, fin: true }
    ]
  },
  market: {
    id: 'market',
    type: 'race',
    name: 'Market Street High-Speed Run',
    sub: 'Van Ness boulevard sprint to the historic Ferry Building',
    desc: 'Wide diagonal boulevard sprint slicing through the heart of downtown San Francisco.',
    startPos: { x: -2270, z: 2254, psi: 0.8 },
    finishPos: { x: -132, z: 136 },
    distance: 3100,
    targets: { gold: 72, silver: 84, bronze: 98 },
    reward: { cash: 4800, xp: 1800 },
    checkpoints: [
      { x: -2270, z: 2254 },
      { x: -1750, z: 1720 },
      { x: -1200, z: 1200 },
      { x: -650, z: 660 },
      { x: -132, z: 136, fin: true }
    ]
  },

  // 2. Police Pursuit Challenges (Heat 1-5 & Cooldown Zone)
  pursuit_heat1: {
    id: 'pursuit_heat1',
    type: 'pursuit',
    name: 'City Patrol Evasion',
    sub: 'Outrun local patrol squad cars and escape into a Cooldown Zone',
    desc: 'Shake off active patrol units and break line of sight in an industrial alleyway.',
    heat: 1,
    startPos: { x: -1800, z: 800 },
    targets: { survivalSeconds: 45, cooldownRequired: 10 },
    reward: { cash: 2500, xp: 800 },
    cooldownZones: [
      { name: 'SOMA Industrial Alley', x: -1550, z: 1350, r: 85 },
      { name: 'Nob Hill Covered Garage', x: -1950, z: 400, r: 80 }
    ]
  },
  pursuit_heat3: {
    id: 'pursuit_heat3',
    type: 'pursuit',
    name: 'Tactical Pursuit & Roadblocks',
    sub: 'Aggressive tactical cruisers, PIT maneuvers & boulevard roadblocks',
    desc: 'Heavy police response. Evade tactical cruisers and roadblocks to reach an underpass Cooldown Zone.',
    heat: 3,
    startPos: { x: -1400, z: 1200 },
    targets: { survivalSeconds: 70, cooldownRequired: 12 },
    reward: { cash: 6000, xp: 2200 },
    cooldownZones: [
      { name: 'Embarcadero Freeway Underpass', x: -450, z: 1100, r: 90 },
      { name: 'Tenderloin Multi-Level Garage', x: -1600, z: 900, r: 80 }
    ]
  },
  pursuit_heat5: {
    id: 'pursuit_heat5',
    type: 'pursuit',
    name: 'Most Wanted Interceptors',
    sub: 'State Interceptors, Spike Strips & Police Helicopter Air Support',
    desc: 'Maximum Heat 5 pressure! State interceptors, helicopter spotlights, and spike strips. Escape to underground safehouse.',
    heat: 5,
    startPos: { x: -1000, z: 800 },
    targets: { survivalSeconds: 100, cooldownRequired: 15 },
    reward: { cash: 15000, xp: 5000 },
    cooldownZones: [
      { name: 'Yerba Buena Tunnel Service Depot', x: 1200, z: 600, r: 120 },
      { name: 'Presidio Military Bunker', x: -3800, z: -1100, r: 100 },
      { name: 'Fort Mason Pier Warehouse', x: -2900, z: -1500, r: 90 }
    ]
  },

  // 3. Drift & Stunt Events (Lombard & Twin Peaks)
  drift_lombard: {
    id: 'drift_lombard',
    type: 'drift',
    name: 'Lombard Street Switchbacks',
    sub: 'The Crookedest Street in the World — 8 tight brick hairpins',
    desc: 'Downhill precision drift through brick hairpin turns with crowds and ornamental gardens.',
    startPos: { x: -2227, z: -730, psi: -1.57 },
    finishPos: { x: -2450, z: -730 },
    targets: { gold: 60000, silver: 35000, bronze: 15000 },
    reward: { cash: 5000, xp: 2000 },
    timeLimit: 75,
    checkpoints: [
      { x: -2227, z: -730 },
      { x: -2275, z: -730 },
      { x: -2330, z: -730 },
      { x: -2390, z: -730 },
      { x: -2450, z: -730, fin: true }
    ]
  },
  drift_twinpeaks: {
    id: 'drift_twinpeaks',
    type: 'drift',
    name: 'Twin Peaks Summit Slide',
    sub: 'Sweeping high-velocity power slides along the scenic ridge',
    desc: 'High-speed drift curves winding around the twin peaks overlooking the bay and skyline.',
    startPos: { x: -4855, z: 4935, psi: 2.1 },
    finishPos: { x: -4500, z: 4200 },
    targets: { gold: 90000, silver: 50000, bronze: 20000 },
    reward: { cash: 7500, xp: 3000 },
    timeLimit: 90,
    checkpoints: [
      { x: -4855, z: 4935 },
      { x: -4780, z: 4750 },
      { x: -4690, z: 4500 },
      { x: -4590, z: 4320 },
      { x: -4500, z: 4200, fin: true }
    ]
  },

  // 4. VIP & Taxi Fares Mode
  fare_vip_comfort: {
    id: 'fare_vip_comfort',
    type: 'fare',
    name: 'Fairmont Hotel VIP Transfer',
    sub: 'Luxury passenger transfer from Nob Hill to Ferry Building',
    desc: 'High-profile dignitary requiring smooth driving. Avoid hard cornering, harsh braking, and all impacts.',
    pickupPos: { x: -1420, z: 500, name: 'Fairmont Hotel Nob Hill' },
    dropoffPos: { x: -200, z: 200, name: 'Ferry Building Executive Terminal' },
    targets: { minComfort: 85, timeLimit: 140 },
    reward: { cash: 4500, xp: 1400, bonusTip: 2500 }
  },
  fare_express_rush: {
    id: 'fare_express_rush',
    type: 'fare',
    name: 'Union Square Express Rush',
    sub: "Union Square to Pier 39 Fast Ferry Gate",
    desc: 'Passenger is running late for their ferry departure! High speed transit with time bonuses.',
    pickupPos: { x: -1260, z: 1100, name: 'Union Square Plaza' },
    dropoffPos: { x: -1850, z: -1450, name: 'Pier 39 Ferry Gate' },
    targets: { timeLimit: 85 },
    reward: { cash: 5200, xp: 1600, bonusTip: 3000 }
  }
};

// ============================================================================
// AUDIO SYNTHESIZER (DSP CHIMES & SOUND EFFECTS)
// ============================================================================

class SoundFX {
  constructor() {
    this.ctx = null;
  }

  init() {
    if (this.ctx) return;
    try {
      const AudioCtx = (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext));
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    } catch {
      // AudioContext unavailable
    }
  }

  playTone(freq, duration = 0.15, type = 'sine', gainVal = 0.2) {
    this.init();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
      gain.gain.setValueAtTime(gainVal, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start();
      osc.stop(this.ctx.currentTime + duration);
    } catch {
      // Audio playback failed silently
    }
  }

  countdown(high = false) {
    this.playTone(high ? 880 : 440, high ? 0.4 : 0.18, 'triangle', high ? 0.35 : 0.22);
  }

  checkpoint() {
    this.playTone(1050, 0.12, 'sine', 0.25);
    setTimeout(() => this.playTone(1320, 0.2, 'sine', 0.22), 60);
  }

  driftTick() {
    this.playTone(600 + Math.random() * 300, 0.06, 'sawtooth', 0.05);
  }

  cooldownSafe() {
    this.playTone(523, 0.15, 'sine', 0.2);
    setTimeout(() => this.playTone(659, 0.15, 'sine', 0.2), 120);
    setTimeout(() => this.playTone(784, 0.25, 'sine', 0.25), 240);
  }

  victory() {
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.35, 'triangle', 0.3), idx * 110);
    });
  }

  defeat() {
    const notes = [440, 415.3, 392, 369.99];
    notes.forEach((freq, idx) => {
      setTimeout(() => this.playTone(freq, 0.25, 'sawtooth', 0.2), idx * 130);
    });
  }
}

// ============================================================================
// PERSISTENCE MANAGER (sf-drive.missions & teleop2.guest)
// ============================================================================

const STORAGE_KEY = 'sf-drive.missions';
const GUEST_KEY = 'teleop2.guest';

export class MissionPersistence {
  static load() {
    if (typeof localStorage === 'undefined') {
      return { records: {}, stats: { totalCompleted: 0, totalCash: 0, totalXP: 0, stars: 0 } };
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    } catch (e) {
      console.warn('[MissionsHub] Could not read missions storage:', e);
    }
    return { records: {}, stats: { totalCompleted: 0, totalCash: 0, totalXP: 0, stars: 0 } };
  }

  static save(data) {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {
      console.warn('[MissionsHub] Could not save missions storage:', e);
    }
  }

  static getRecord(missionId) {
    const data = this.load();
    return data.records?.[missionId] || null;
  }

  static updateRecord(summary) {
    const data = this.load();
    if (!data.records) data.records = {};
    if (!data.stats) data.stats = { totalCompleted: 0, totalCash: 0, totalXP: 0, stars: 0 };

    const id = summary.missionId;
    const existing = data.records[id] || {
      completed: false,
      stars: 0,
      bestTime: 999999,
      bestScore: 0,
      attempts: 0
    };

    let isNewBest = false;
    existing.attempts = (existing.attempts || 0) + 1;
    existing.lastPlayed = Date.now();

    if (summary.success) {
      if (!existing.completed) {
        existing.completed = true;
        data.stats.totalCompleted = (data.stats.totalCompleted || 0) + 1;
      }

      if (summary.stars && summary.stars > (existing.stars || 0)) {
        data.stats.stars = (data.stats.stars || 0) + (summary.stars - (existing.stars || 0));
        existing.stars = summary.stars;
        isNewBest = true;
      }

      if (summary.time && summary.time < (existing.bestTime || 999999)) {
        existing.bestTime = summary.time;
        isNewBest = true;
      }

      if (summary.score && summary.score > (existing.bestScore || 0)) {
        existing.bestScore = summary.score;
        isNewBest = true;
      }

      if (summary.medal) {
        existing.medal = summary.medal;
      }

      // Add rewards
      const cash = summary.cash || 0;
      const xp = summary.xp || 0;
      data.stats.totalCash = (data.stats.totalCash || 0) + cash;
      data.stats.totalXP = (data.stats.totalXP || 0) + xp;

      // Also credit rewards to teleop2.guest wallet if available
      this.creditGuestWallet(cash, xp);
    }

    data.records[id] = existing;
    this.save(data);
    return { record: existing, isNewBest };
  }

  static creditGuestWallet(cash, xp) {
    if (typeof localStorage === 'undefined') return;
    try {
      const rawGuest = localStorage.getItem(GUEST_KEY);
      if (rawGuest) {
        const guest = JSON.parse(rawGuest);
        guest.earned = (guest.earned || 0) + cash;
        guest.xp = (guest.xp || 0) + xp;
        if (guest.race) {
          guest.race.money = (guest.race.money || 0) + cash;
        }
        if (guest.cash) {
          guest.cash.base = (guest.cash.base || 0) + cash;
        }
        guest.updated = Date.now();
        localStorage.setItem(GUEST_KEY, JSON.stringify(guest));
      }
    } catch (e) {
      console.warn('[MissionsHub] Could not update guest wallet:', e);
    }
  }
}

// ============================================================================
// MISSIONS CONTROLLER CLASS
// ============================================================================

export class MissionsHub {
  constructor() {
    this.catalog = MISSION_CATALOG;
    this.activeMission = null;
    this.missionState = null;
    this.sfx = new SoundFX();
    this.loopId = null;
    this.lastTime = 0;
    this.sceneMeshes = [];

    // DOM Elements cache
    this.dom = {
      pauseModal: null,
      resultsModal: null,
      activeHud: null,
      cooldownHud: null,
      filterButtons: [],
      cards: []
    };

    this.initDOM();
  }

  initDOM() {
    if (typeof document === 'undefined') return;

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => this.bindUI());
    } else {
      this.bindUI();
    }
  }

  bindUI() {
    this.dom.pauseModal = document.getElementById('pause');
    this.dom.resultsModal = document.getElementById('missionResults');
    this.dom.activeHud = document.getElementById('missionActiveHud');
    this.dom.cooldownHud = document.getElementById('cooldownZoneHud');

    // Filter Buttons
    const filterBtns = document.querySelectorAll('.act-chip[data-act-filter]');
    filterBtns.forEach(btn => {
      btn.onclick = () => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const filter = btn.dataset.actFilter;
        this.filterCards(filter);
      };
    });

    // Launch Buttons inside Cards
    const launchBtns = document.querySelectorAll('.act-launch-btn[data-launch]');
    launchBtns.forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const missionId = btn.dataset.launch;
        const type = btn.dataset.type;
        this.startMission(type, missionId);
      };
    });

    // Results Modal Action Buttons
    const retryBtn = document.getElementById('mresRetry');
    if (retryBtn) {
      retryBtn.onclick = () => {
        if (this.lastCompletedMission) {
          this.closeResultsModal();
          this.startMission(this.lastCompletedMission.type, this.lastCompletedMission.id);
        }
      };
    }

    const menuBtn = document.getElementById('mresOpenMenu');
    if (menuBtn) {
      menuBtn.onclick = () => {
        this.closeResultsModal();
        if (window.__sf?.pm) {
          window.__sf.pm.set(true);
          window.__sf.pm.show('missions');
        }
      };
    }

    const closeBtn = document.getElementById('mresClose');
    if (closeBtn) {
      closeBtn.onclick = () => {
        this.closeResultsModal();
      };
    }

    // In-game Abandon button
    const abandonBtn = document.getElementById('mahAbandonBtn');
    if (abandonBtn) {
      abandonBtn.onclick = () => {
        this.abandonMission();
      };
    }

    // Refresh UI with persisted records
    this.syncCardRecords();
  }

  filterCards(filter) {
    const cards = document.querySelectorAll('.act-card[data-act-type]');
    cards.forEach(card => {
      if (filter === 'all' || card.dataset.actType === filter) {
        card.style.display = 'flex';
      } else {
        card.style.display = 'none';
      }
    });
  }

  syncCardRecords() {
    if (typeof document === 'undefined' || !document.querySelector) return;
    const data = MissionPersistence.load();
    const records = data.records || {};

    for (const [id, rec] of Object.entries(records)) {
      // Update star icons
      const starsEl = document.querySelector(`.act-stars[data-stars-for="${id}"]`);
      if (starsEl && rec.stars) {
        const starIcons = starsEl.querySelectorAll('i');
        starIcons.forEach((star, idx) => {
          star.classList.toggle('on', idx < rec.stars);
        });
      }

      // Update best record label
      const bestEl = document.querySelector(`.act-card-best[data-best-for="${id}"]`);
      if (bestEl) {
        const conf = this.catalog[id];
        if (conf?.type === 'race' && rec.bestTime < 99999) {
          bestEl.textContent = `Best Time: ${this.formatTime(rec.bestTime)}`;
        } else if (conf?.type === 'drift' && rec.bestScore > 0) {
          bestEl.textContent = `Best Score: ${Math.round(rec.bestScore).toLocaleString()} pts`;
        } else if (conf?.type === 'pursuit' && rec.completed) {
          bestEl.textContent = `Evaded (${rec.stars}★) · Attempts: ${rec.attempts}`;
        } else if (conf?.type === 'fare' && rec.completed) {
          bestEl.textContent = `Completed (${rec.stars}★) · ${rec.bestTime < 99999 ? this.formatTime(rec.bestTime) : ''}`;
        }
      }
    }
  }

  formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return '0:00.00';
    const mins = Math.floor(seconds / 60);
    const secs = (seconds % 60).toFixed(2).padStart(5, '0');
    return `${mins}:${secs}`;
  }

  // ==========================================================================
  // START MISSION
  // ==========================================================================

  startMission(typeOrId, idMaybe) {
    let mission = null;

    if (idMaybe && this.catalog[idMaybe]) {
      mission = this.catalog[idMaybe];
    } else if (typeOrId && this.catalog[typeOrId]) {
      mission = this.catalog[typeOrId];
    } else {
      // Search by type or matching key
      for (const key of Object.keys(this.catalog)) {
        if (this.catalog[key].id === typeOrId || this.catalog[key].id === idMaybe) {
          mission = this.catalog[key];
          break;
        }
      }
    }

    if (!mission) {
      console.warn(`[MissionsHub] Mission not found: "${typeOrId}" "${idMaybe}"`);
      return false;
    }

    // Clean up any running mission
    this.cleanUp();

    this.activeMission = mission;
    this.lastCompletedMission = mission;

    // Close pause menu if open
    if (window.__sf?.pm?.paused) {
      window.__sf.pm.set(false);
    }
    const pauseEl = document.getElementById('pause');
    if (pauseEl) pauseEl.classList.remove('on');

    // Teleport player vehicle if starting coordinates exist
    if (mission.startPos && window.__sf?.tele?.go) {
      window.__sf.tele.go({
        x: mission.startPos.x,
        z: mission.startPos.z,
        psi: mission.startPos.psi || 0,
        quiet: true
      });
    }

    // Initialize specific activity mode
    switch (mission.type) {
      case 'race':
        this.initRace(mission);
        break;
      case 'pursuit':
        this.initPursuit(mission);
        break;
      case 'drift':
        this.initDrift(mission);
        break;
      case 'fare':
        this.initFare(mission);
        break;
      default:
        console.warn(`[MissionsHub] Unknown mission type: ${mission.type}`);
        return false;
    }

    // Setup active HUD
    this.showActiveHUD(mission);

    // Audio cue
    this.sfx.countdown(true);

    // Start tick loop
    this.lastTime = performance.now();
    this.tickLoop();

    return true;
  }

  // ==========================================================================
  // CHECKPOINT RACE INITIALIZATION
  // ==========================================================================

  initRace(mission) {
    this.missionState = {
      type: 'race',
      timeElapsed: 0,
      countdown: 3.5,
      currentCheckpoint: 0,
      checkpoints: mission.checkpoints || [],
      totalCheckpoints: mission.checkpoints?.length || 0,
      topSpeed: 0,
      started: false
    };

    // Update GPS guide ribbon to first checkpoint if available
    if (mission.checkpoints?.[0] && window.__sf?.setGPSDestination) {
      window.__sf.setGPSDestination(mission.checkpoints[0].x, mission.checkpoints[0].z, 'Checkpoint 1');
    }

    // Spawn 3D checkpoint gates in scene if Three.js is present
    this.spawn3DCheckpoints(mission.checkpoints);
  }

  // ==========================================================================
  // POLICE PURSUIT INITIALIZATION
  // ==========================================================================

  initPursuit(mission) {
    const police = window.__sf?.police;
    if (police) {
      police.setEnabled(true);
      police.heat = Math.min(5, Math.max(1, mission.heat || 1));
      if (police.startPursuit) {
        police.startPursuit('TACTICAL CHALLENGE');
      }
    }

    this.missionState = {
      type: 'pursuit',
      timeElapsed: 0,
      cooldownElapsed: 0,
      cooldownRequired: mission.targets.cooldownRequired || 12,
      survivalTarget: mission.targets.survivalSeconds || 60,
      inCooldownZone: false,
      cooldownZones: mission.cooldownZones || [],
      escapes0: police ? police.escapes : 0,
      busts0: police ? police.busts : 0,
      topSpeed: 0
    };

    // Set GPS ribbon to nearest Cooldown Zone
    if (mission.cooldownZones?.[0] && window.__sf?.setGPSDestination) {
      window.__sf.setGPSDestination(mission.cooldownZones[0].x, mission.cooldownZones[0].z, mission.cooldownZones[0].name);
    }
  }

  // ==========================================================================
  // DRIFT & STUNT INITIALIZATION
  // ==========================================================================

  initDrift(mission) {
    this.missionState = {
      type: 'drift',
      timeElapsed: 0,
      timeLimit: mission.timeLimit || 80,
      score: 0,
      multiplier: 1,
      chainTimer: 0,
      maxSlipAngle: 0,
      topSpeed: 0,
      longestDriftSec: 0,
      currentDriftSec: 0,
      checkpoints: mission.checkpoints || [],
      currentCheckpoint: 0
    };

    if (mission.checkpoints?.[0] && window.__sf?.setGPSDestination) {
      window.__sf.setGPSDestination(mission.checkpoints[0].x, mission.checkpoints[0].z, 'Course Start');
    }

    this.spawn3DCheckpoints(mission.checkpoints);
  }

  // ==========================================================================
  // VIP / TAXI FARE INITIALIZATION
  // ==========================================================================

  initFare(mission) {
    this.missionState = {
      type: 'fare',
      phase: 'pickup', // 'pickup' -> 'transit' -> 'complete'
      timeElapsed: 0,
      timeLimit: mission.targets.timeLimit || 120,
      comfort: 100,
      minComfort: mission.targets.minComfort || 85,
      pickupPos: mission.pickupPos,
      dropoffPos: mission.dropoffPos,
      topSpeed: 0,
      gForcePenalties: 0
    };

    // Set GPS ribbon to pickup location
    if (mission.pickupPos && window.__sf?.setGPSDestination) {
      window.__sf.setGPSDestination(mission.pickupPos.x, mission.pickupPos.z, mission.pickupPos.name);
    }
  }

  // ==========================================================================
  // THREE.JS 3D CHECKPOINTS / MARKERS
  // ==========================================================================

  spawn3DCheckpoints(checkpoints) {
    if (!checkpoints || !checkpoints.length) return;
    const scene = window.__sf?.scene;
    if (!scene) return;

    // Clear old meshes
    this.clear3DMeshes();

    try {
      const THREE = window.THREE || window.__sf?.THREE;
      if (!THREE) return;

      checkpoints.forEach((cp, idx) => {
        // Torus / Ring geometry for floating gate
        const geom = new THREE.TorusGeometry(5, 0.4, 8, 24);
        const color = cp.fin ? 0x2ed573 : (idx === 0 ? 0xffb830 : 0x5ef0d6);
        const mat = new THREE.MeshBasicMaterial({
          color,
          wireframe: true,
          transparent: true,
          opacity: 0.85
        });
        const mesh = new THREE.Mesh(geom, mat);
        
        // Snap height
        const y = window.__sf?.real?.layout?.driveHeight?.(cp.x, cp.z) || window.__sf?.v?.pos?.y || 2;
        mesh.position.set(cp.x, y + 4.5, cp.z);
        mesh.rotation.x = Math.PI / 2;

        scene.add(mesh);
        this.sceneMeshes.push(mesh);
      });
    } catch {
      // Mesh generation ignored if THREE is not globally exposed
    }
  }

  clear3DMeshes() {
    const scene = window.__sf?.scene;
    if (scene && this.sceneMeshes.length) {
      this.sceneMeshes.forEach(m => {
        try {
          scene.remove(m);
          m.geometry?.dispose?.();
          m.material?.dispose?.();
        } catch {}
      });
    }
    this.sceneMeshes = [];
  }

  // ==========================================================================
  // TICK LOOP (60 FPS GAMEPLAY LOGIC)
  // ==========================================================================

  tickLoop() {
    if (!this.activeMission || !this.missionState) return;

    const now = performance.now();
    const dt = Math.min((now - this.lastTime) / 1000, 0.1);
    this.lastTime = now;

    const v = window.__sf?.v;
    const pos = v?.pos || { x: 0, y: 0, z: 0 };
    const kmh = v?.kmh || (v?.vel ? Math.hypot(v.vel.x, v.vel.z) * 3.6 : 0);

    // Track top speed reached
    if (kmh > this.missionState.topSpeed) {
      this.missionState.topSpeed = kmh;
    }

    // Dispatch update by mission type
    switch (this.missionState.type) {
      case 'race':
        this.updateRace(dt, pos, kmh);
        break;
      case 'pursuit':
        this.updatePursuit(dt, pos, kmh);
        break;
      case 'drift':
        this.updateDrift(dt, pos, kmh, v);
        break;
      case 'fare':
        this.updateFare(dt, pos, kmh, v);
        break;
    }

    // Re-queue next frame
    this.loopId = reqAnimFrame(() => this.tickLoop());
  }

  // ==========================================================================
  // RACE UPDATE LOGIC
  // ==========================================================================

  updateRace(dt, pos, kmh) {
    const state = this.missionState;
    const mission = this.activeMission;

    // Countdown before start
    if (state.countdown > 0) {
      const prevCd = Math.ceil(state.countdown);
      state.countdown -= dt;
      const newCd = Math.ceil(state.countdown);
      if (newCd < prevCd && newCd > 0) {
        this.sfx.countdown(false);
      }
      if (state.countdown <= 0) {
        state.started = true;
        this.sfx.countdown(true);
      }
      this.updateActiveHUD('Countdown', `${Math.max(1, newCd)}`, `Get Ready`, 0);
      return;
    }

    state.timeElapsed += dt;

    // Checkpoint passage detection
    const cps = state.checkpoints;
    const curIdx = state.currentCheckpoint;
    const targetCp = cps[curIdx];

    if (targetCp) {
      const dist = Math.hypot(pos.x - targetCp.x, pos.z - targetCp.z);
      if (dist < 18) {
        this.sfx.checkpoint();
        state.currentCheckpoint++;

        if (state.currentCheckpoint >= cps.length) {
          // Race finished!
          const success = true;
          const stars = state.timeElapsed <= mission.targets.gold ? 3 :
                       (state.timeElapsed <= mission.targets.silver ? 2 :
                       (state.timeElapsed <= mission.targets.bronze ? 1 : 1));
          const medal = stars === 3 ? 'gold' : (stars === 2 ? 'silver' : 'bronze');

          this.finishMission({
            missionId: mission.id,
            missionType: 'race',
            name: mission.name,
            success,
            time: state.timeElapsed,
            score: Math.round(100000 / state.timeElapsed),
            stars,
            medal,
            cash: mission.reward.cash,
            xp: mission.reward.xp,
            details: {
              topSpeed: Math.round(state.topSpeed) + ' km/h',
              place: '1st Place',
              rating: medal.toUpperCase() + ' MEDAL'
            }
          });
          return;
        } else {
          // Update GPS line to next checkpoint
          const nextCp = cps[state.currentCheckpoint];
          if (nextCp && window.__sf?.setGPSDestination) {
            window.__sf.setGPSDestination(nextCp.x, nextCp.z, `Checkpoint ${state.currentCheckpoint + 1}`);
          }
        }
      }
    }

    const prog = Math.min(100, Math.round((state.currentCheckpoint / state.totalCheckpoints) * 100));
    this.updateActiveHUD(
      this.formatTime(state.timeElapsed),
      `${state.currentCheckpoint}/${state.totalCheckpoints}`,
      `Gold: ${this.formatTime(mission.targets.gold)}`,
      prog
    );
  }

  // ==========================================================================
  // PURSUIT UPDATE LOGIC
  // ==========================================================================

  updatePursuit(dt, pos, kmh) {
    const state = this.missionState;
    const mission = this.activeMission;
    const police = window.__sf?.police;

    state.timeElapsed += dt;

    // Check if player is busted
    if (police && police.bust >= 1) {
      this.finishMission({
        missionId: mission.id,
        missionType: 'pursuit',
        name: mission.name,
        success: false,
        time: state.timeElapsed,
        score: Math.round(state.timeElapsed * 50),
        stars: 0,
        medal: 'none',
        cash: 0,
        xp: 150,
        details: {
          topSpeed: Math.round(state.topSpeed) + ' km/h',
          status: 'BUSTED BY SFPD',
          heat: 'Heat ' + (mission.heat || 1)
        }
      });
      return;
    }

    // Check if within any Cooldown Zone
    let inZone = false;
    let activeZone = null;
    for (const zone of state.cooldownZones) {
      const dist = Math.hypot(pos.x - zone.x, pos.z - zone.z);
      if (dist <= zone.r) {
        inZone = true;
        activeZone = zone;
        break;
      }
    }

    state.inCooldownZone = inZone;

    if (inZone) {
      state.cooldownElapsed += dt;
      if (this.dom.cooldownHud) {
        this.dom.cooldownHud.style.display = 'flex';
        const fill = document.getElementById('czhFill');
        if (fill) {
          fill.style.width = Math.min(100, Math.round((state.cooldownElapsed / state.cooldownRequired) * 100)) + '%';
        }
      }

      // Check for successful cooldown evasion
      if (state.cooldownElapsed >= state.cooldownRequired || (police && police.escapes > state.escapes0)) {
        if (police) police.heat = 0;
        this.finishMission({
          missionId: mission.id,
          missionType: 'pursuit',
          name: mission.name,
          success: true,
          time: state.timeElapsed,
          score: Math.round(mission.reward.cash * 1.5),
          stars: 3,
          medal: 'gold',
          cash: mission.reward.cash,
          xp: mission.reward.xp,
          details: {
            topSpeed: Math.round(state.topSpeed) + ' km/h',
            status: 'PURSUIT EVADED',
            heat: 'Heat ' + (mission.heat || 1) + ' Cleared'
          }
        });
        return;
      }
    } else {
      // Cooldown slowly decays if out of zone
      state.cooldownElapsed = Math.max(0, state.cooldownElapsed - dt * 0.5);
      if (this.dom.cooldownHud) {
        this.dom.cooldownHud.style.display = 'none';
      }
    }

    const prog = Math.min(100, Math.round((state.cooldownElapsed / state.cooldownRequired) * 100));
    this.updateActiveHUD(
      this.formatTime(state.timeElapsed),
      inZone ? 'IN COOLDOWN' : 'ACTIVE CHASE',
      inZone ? `${Math.round(state.cooldownElapsed)}s / ${state.cooldownRequired}s` : 'Find Safehouse',
      prog
    );
  }

  // ==========================================================================
  // DRIFT UPDATE LOGIC
  // ==========================================================================

  updateDrift(dt, pos, kmh, v) {
    const state = this.missionState;
    const mission = this.activeMission;

    state.timeElapsed += dt;

    // Physics: Calculate slip angle in degrees
    const slipAngle = Math.abs(v?.beta || 0) * (180 / Math.PI);
    if (slipAngle > state.maxSlipAngle) {
      state.maxSlipAngle = slipAngle;
    }

    // Drifting condition: speed > 20 km/h and slip angle > 7 degrees
    if (kmh > 20 && slipAngle > 7) {
      state.currentDriftSec += dt;
      if (state.currentDriftSec > state.longestDriftSec) {
        state.longestDriftSec = state.currentDriftSec;
      }

      state.chainTimer = 2.4;
      const pts = Math.round(kmh * slipAngle * 1.6 * state.multiplier * dt);
      state.score += pts;

      // Increment multiplier every 1.5 seconds of sustained drift
      if (state.currentDriftSec > 1.5 && state.multiplier < 5) {
        state.multiplier = Math.min(5, 1 + Math.floor(state.currentDriftSec / 1.5));
      }

      // Audio feedback
      if (Math.random() < 0.15) {
        this.sfx.driftTick();
      }
    } else {
      state.currentDriftSec = 0;
      if (state.chainTimer > 0) {
        state.chainTimer -= dt;
      } else {
        state.multiplier = 1;
      }
    }

    // Checkpoint passage detection
    if (state.checkpoints.length) {
      const curCp = state.checkpoints[state.currentCheckpoint];
      if (curCp) {
        const dist = Math.hypot(pos.x - curCp.x, pos.z - curCp.z);
        if (dist < 20) {
          this.sfx.checkpoint();
          state.currentCheckpoint++;

          if (state.currentCheckpoint >= state.checkpoints.length) {
            // Crossed finish line!
            this.evaluateDriftOutcome(mission, state);
            return;
          }
        }
      }
    }

    // Check time limit
    if (state.timeElapsed >= state.timeLimit) {
      this.evaluateDriftOutcome(mission, state);
      return;
    }

    const prog = Math.min(100, Math.round((state.score / mission.targets.gold) * 100));
    this.updateActiveHUD(
      this.formatTime(state.timeElapsed),
      `${Math.round(state.score).toLocaleString()} pts`,
      `x${state.multiplier} (${Math.round(slipAngle)}°)`,
      prog
    );
  }

  evaluateDriftOutcome(mission, state) {
    const success = state.score >= mission.targets.bronze;
    const stars = state.score >= mission.targets.gold ? 3 :
                 (state.score >= mission.targets.silver ? 2 :
                 (state.score >= mission.targets.bronze ? 1 : 0));
    const medal = stars === 3 ? 'gold' : (stars === 2 ? 'silver' : (stars === 1 ? 'bronze' : 'none'));

    this.finishMission({
      missionId: mission.id,
      missionType: 'drift',
      name: mission.name,
      success,
      time: state.timeElapsed,
      score: Math.round(state.score),
      stars,
      medal,
      cash: success ? mission.reward.cash : 500,
      xp: success ? mission.reward.xp : 250,
      details: {
        topSpeed: Math.round(state.topSpeed) + ' km/h',
        maxSlip: Math.round(state.maxSlipAngle) + '° Max Angle',
        longestDrift: state.longestDriftSec.toFixed(1) + 's Sustained'
      }
    });
  }

  // ==========================================================================
  // FARE UPDATE LOGIC
  // ==========================================================================

  updateFare(dt, pos, kmh, v) {
    const state = this.missionState;
    const mission = this.activeMission;

    state.timeElapsed += dt;

    if (state.phase === 'pickup') {
      const p = mission.pickupPos;
      const dist = Math.hypot(pos.x - p.x, pos.z - p.z);
      
      // Stop inside pickup zone to board
      if (dist < 12 && kmh < 6) {
        state.phase = 'transit';
        this.sfx.victory();
        if (window.__sf?.audio?.ui1) {
          window.__sf.audio.ui1('fare_ding', 0.8);
        }
        // Switch GPS line to destination
        if (mission.dropoffPos && window.__sf?.setGPSDestination) {
          window.__sf.setGPSDestination(mission.dropoffPos.x, mission.dropoffPos.z, mission.dropoffPos.name);
        }
      }

      this.updateActiveHUD(
        this.formatTime(state.timeElapsed),
        'PICKUP VIP',
        `${Math.round(dist)}m to curb`,
        0
      );
      return;
    }

    if (state.phase === 'transit') {
      const d = mission.dropoffPos;
      const dist = Math.hypot(pos.x - d.x, pos.z - d.z);

      // Comfort deduction for aggressive driving (VIP mode)
      if (mission.targets.minComfort) {
        // High lateral slip angle penalty
        const slip = Math.abs(v?.beta || 0) * (180 / Math.PI);
        if (slip > 25) {
          state.comfort = Math.max(0, state.comfort - dt * 6);
        }
      }

      // Check for dropoff arrival
      if (dist < 14 && kmh < 6) {
        const success = state.comfort >= (mission.targets.minComfort || 0) && state.timeElapsed <= state.timeLimit;
        const stars = state.comfort >= 90 ? 3 : (state.comfort >= 75 ? 2 : 1);
        const tip = Math.round(mission.reward.bonusTip * (state.comfort / 100));

        this.finishMission({
          missionId: mission.id,
          missionType: 'fare',
          name: mission.name,
          success: true,
          time: state.timeElapsed,
          score: Math.round(state.comfort * 100),
          stars,
          medal: stars === 3 ? 'gold' : 'silver',
          cash: mission.reward.cash + tip,
          xp: mission.reward.xp,
          details: {
            topSpeed: Math.round(state.topSpeed) + ' km/h',
            comfort: Math.round(state.comfort) + '% Comfort',
            tipBonus: '+$' + tip.toLocaleString() + ' Tip'
          }
        });
        return;
      }

      // Check time out
      if (state.timeElapsed > state.timeLimit * 1.5) {
        this.finishMission({
          missionId: mission.id,
          missionType: 'fare',
          name: mission.name,
          success: false,
          time: state.timeElapsed,
          score: Math.round(state.comfort * 10),
          stars: 0,
          medal: 'none',
          cash: 500,
          xp: 100,
          details: {
            topSpeed: Math.round(state.topSpeed) + ' km/h',
            status: 'PASSENGER CANCELLED',
            comfort: 'Time Expired'
          }
        });
        return;
      }

      const prog = Math.min(100, Math.max(0, Math.round(state.comfort)));
      this.updateActiveHUD(
        this.formatTime(state.timeElapsed),
        `${Math.round(state.comfort)}% Comfort`,
        `${Math.round(dist)}m to drop-off`,
        prog
      );
    }
  }

  // ==========================================================================
  // HUD CONTROLS
  // ==========================================================================

  showActiveHUD(mission) {
    if (!this.dom.activeHud) return;
    this.dom.activeHud.style.display = 'flex';

    const typeBadge = document.getElementById('mahTypeBadge');
    if (typeBadge) typeBadge.textContent = mission.type.toUpperCase();

    const nameEl = document.getElementById('mahName');
    if (nameEl) nameEl.textContent = mission.name;

    const timerLabel = document.getElementById('mahTimerLabel');
    if (timerLabel) timerLabel.textContent = 'TIME';
  }

  updateActiveHUD(timerText, secondaryVal, tertiaryVal, progPercent) {
    const timer = document.getElementById('mahTimer');
    if (timer) timer.textContent = timerText;

    const secVal = document.getElementById('mahSecondaryVal');
    if (secVal) secVal.textContent = secondaryVal;

    const tertVal = document.getElementById('mahTertiaryVal');
    if (tertVal) tertVal.textContent = tertiaryVal;

    const fill = document.getElementById('mahProgFill');
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, progPercent))}%`;
  }

  hideActiveHUD() {
    if (this.dom.activeHud) this.dom.activeHud.style.display = 'none';
    if (this.dom.cooldownHud) this.dom.cooldownHud.style.display = 'none';
  }

  abandonMission() {
    this.cleanUp();
    this.hideActiveHUD();
    if (window.__sf?.clearGPS) {
      window.__sf.clearGPS();
    }
  }

  // ==========================================================================
  // MISSION COMPLETION & RESULTS SUMMARY
  // ==========================================================================

  finishMission(summary) {
    this.cleanUp();
    this.hideActiveHUD();

    if (window.__sf?.clearGPS) {
      window.__sf.clearGPS();
    }

    // Persist results & rewards
    const { isNewBest } = MissionPersistence.updateRecord(summary);

    // Refresh UI cards
    this.syncCardRecords();

    // Sound effect
    if (summary.success) {
      this.sfx.victory();
    } else {
      this.sfx.defeat();
    }

    // Display Post-Mission Results Modal Overlay
    this.showMissionResult({ ...summary, isNewBest });
  }

  showMissionResult(summary) {
    if (!summary) return;

    // Update persistence and records if not already persisted
    if (!summary._persisted) {
      const { isNewBest } = MissionPersistence.updateRecord(summary);
      summary = { ...summary, isNewBest, _persisted: true };
      this.syncCardRecords();
    }

    if (summary.success) {
      this.sfx.victory();
    } else {
      this.sfx.defeat();
    }

    if (!this.dom.resultsModal) return;

    // Header & Outcomes
    const typeBadge = document.getElementById('mresTypeBadge');
    if (typeBadge) typeBadge.textContent = (summary.missionType || 'MISSION').toUpperCase();

    const titleEl = document.getElementById('mresTitle');
    if (titleEl) titleEl.textContent = summary.name || 'Mission Activity';

    const outcomeEl = document.getElementById('mresOutcome');
    if (outcomeEl) {
      outcomeEl.textContent = summary.success ? 'MISSION COMPLETE' : 'MISSION FAILED';
      outcomeEl.className = 'mres-outcome ' + (summary.success ? 'mres-win' : 'mres-fail');
    }

    // Stars
    const starsContainer = document.getElementById('mresStars');
    if (starsContainer) {
      const starIcons = starsContainer.querySelectorAll('.star');
      starIcons.forEach((star, idx) => {
        star.classList.toggle('on', idx < (summary.stars || 0));
      });
    }

    // Stats Grid
    const timeEl = document.getElementById('mresTime');
    if (timeEl) timeEl.textContent = this.formatTime(summary.time);

    const metricEl = document.getElementById('mresMetric');
    if (metricEl) {
      const firstDetail = Object.values(summary.details || {})[0];
      metricEl.textContent = firstDetail || `${Math.round(summary.score || 0).toLocaleString()} pts`;
    }

    const speedEl = document.getElementById('mresSpeed');
    if (speedEl) speedEl.textContent = summary.details?.topSpeed || '120 km/h';

    const ratingEl = document.getElementById('mresRating');
    if (ratingEl) {
      ratingEl.textContent = summary.medal ? (summary.medal.toUpperCase() + ' MEDAL') :
                            (summary.stars ? `${summary.stars} STARS` : 'COMPLETED');
    }

    // Rewards
    const cashEl = document.getElementById('mresCash');
    if (cashEl) cashEl.textContent = `+$${(summary.cash || 0).toLocaleString()}`;

    const xpEl = document.getElementById('mresXP');
    if (xpEl) xpEl.textContent = `+${(summary.xp || 0).toLocaleString()} XP`;

    // New Best Record Note
    const recNote = document.getElementById('mresRecordNote');
    if (recNote) {
      recNote.style.display = summary.isNewBest ? 'inline-block' : 'none';
    }

    // Show modal
    this.dom.resultsModal.classList.add('on');
  }

  closeResultsModal() {
    if (this.dom.resultsModal) {
      this.dom.resultsModal.classList.remove('on');
    }
  }

  cleanUp() {
    if (this.loopId) {
      cancelAnimFrame(this.loopId);
      this.loopId = null;
    }
    this.clear3DMeshes();
    this.activeMission = null;
    this.missionState = null;
  }
}

// ============================================================================
// GLOBAL INTEGRATION WITH window.__sf
// ============================================================================

export const missionsHub = new MissionsHub();

if (typeof window !== 'undefined') {
  window.__sf = window.__sf || {};

  // M5 Required Contracts
  window.__sf.missionsHub = missionsHub;

  window.__sf.startMission = function(type, id) {
    return missionsHub.startMission(type, id);
  };

  window.__sf.showMissionResult = function(summary) {
    return missionsHub.showMissionResult(summary);
  };

  // Expose mission catalog and persistence
  window.__sf.MISSION_CATALOG = MISSION_CATALOG;
  window.__sf.MissionPersistence = MissionPersistence;

  console.log('[MissionsHub] M5 Missions & Activities subsystem initialized successfully.');
}
