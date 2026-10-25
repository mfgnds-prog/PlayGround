(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d', { alpha: false });
  const W = canvas.width;
  const H = canvas.height;
  const TILE = 16;
  const MW = 96;
  const MH = 96;
  const WW = MW * TILE;
  const WH = MH * TILE;
  const T = { ROAD: 0, SIDEWALK: 1, BUILDING: 2, GRASS: 3, LOT: 4, WATER: 5, TREE: 6 };
  const SOLID = [false, false, true, false, false, true, true];
  const TAU = Math.PI * 2;

  const $ = (selector) => document.querySelector(selector);
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (arr) => arr[(Math.random() * arr.length) | 0];
  const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);
  const angDelta = (from, to) => Math.atan2(Math.sin(to - from), Math.cos(to - from));

  function hash(x, y, s = 0) {
    let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 69069);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }
  function mulberry32(seed) {
    let a = seed | 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shade(hex, factor) {
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(Math.round(((n >> 16) & 255) * factor), 0, 255);
    const g = clamp(Math.round(((n >> 8) & 255) * factor), 0, 255);
    const b = clamp(Math.round((n & 255) * factor), 0, 255);
    return `rgb(${r},${g},${b})`;
  }
  function hexRgba(hex, alpha) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
  }

  const ROOF = ['#3b3f48', '#45403c', '#39444a', '#463d49', '#4a3f3f', '#3d4340', '#414a58', '#3f3a35'];
  const SHIRT = ['#d95f43', '#4f8ec9', '#c9b24f', '#7e6ac9', '#5bbf8a', '#c95f9a', '#b9b9b9', '#d98b43', '#8fb3c9'];
  const SKIN = ['#c98d63', '#8d5a3b', '#e0b184', '#6b432b', '#b97a52'];
  const NEON = ['#ff4d9d', '#45e0d0', '#ffd23f', '#a06bff', '#ff8a3d', '#6bff77'];

  const Sound = {
    ctx: null, master: null, eng: null, engGain: null, engFilter: null,
    sir: null, sirGain: null, muted: false,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      try { this.ctx = new AC(); } catch (e) { return; }
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.42;
      this.master.connect(this.ctx.destination);
      this.engGain = this.ctx.createGain();
      this.engGain.gain.value = 0;
      this.engFilter = this.ctx.createBiquadFilter();
      this.engFilter.type = 'lowpass';
      this.engFilter.frequency.value = 520;
      this.eng = this.ctx.createOscillator();
      this.eng.type = 'sawtooth';
      this.eng.frequency.value = 55;
      this.eng.connect(this.engFilter);
      this.engFilter.connect(this.engGain);
      this.engGain.connect(this.master);
      this.eng.start();
      this.sirGain = this.ctx.createGain();
      this.sirGain.gain.value = 0;
      this.sir = this.ctx.createOscillator();
      this.sir.type = 'square';
      this.sir.frequency.value = 700;
      this.sir.connect(this.sirGain);
      this.sirGain.connect(this.master);
      this.sir.start();
    },
    resume() {
      this.init();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    },
    setMuted(m) {
      this.muted = m;
      try { localStorage.setItem('porto_pixel_mute', m ? '1' : '0'); } catch (e) {}
      if (this.master && this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.42, this.ctx.currentTime, 0.02);
      updateMuteUi();
    },
    tone(freq, dur, type, vol, slide, delay) {
      if (!this.ctx || this.muted) return;
      const t0 = this.ctx.currentTime + (delay || 0);
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = type || 'square';
      osc.frequency.setValueAtTime(freq, t0);
      if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t0 + dur);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(vol || 0.12, t0 + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(gain);
      gain.connect(this.master);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    },
    noise(dur, vol, freq, delay) {
      if (!this.ctx || this.muted) return;
      const sr = this.ctx.sampleRate;
      const len = Math.max(1, Math.floor(sr * dur));
      const buf = this.ctx.createBuffer(1, len, sr);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = freq || 800;
      const gain = this.ctx.createGain();
      const t0 = this.ctx.currentTime + (delay || 0);
      gain.gain.setValueAtTime(vol || 0.2, t0);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.master);
      src.start(t0);
    },
    gun() { this.noise(0.08, 0.24, 1700); this.tone(130, 0.07, 'square', 0.16, -70); },
    hit() { this.noise(0.08, 0.2, 480); this.tone(90, 0.12, 'sawtooth', 0.1, -35); },
    punch() { this.noise(0.055, 0.2, 320); },
    crash() { this.noise(0.14, 0.26, 900); this.tone(70, 0.14, 'square', 0.1, -30); },
    pickup() { this.tone(660, 0.07, 'square', 0.1); this.tone(990, 0.09, 'square', 0.1, 0, 0.07); },
    cash() { this.tone(880, 0.08, 'square', 0.1); this.tone(1180, 0.1, 'square', 0.1, 0, 0.07); },
    mission() { [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.14, 'square', 0.1, 0, i * 0.11)); },
    fail() { this.tone(220, 0.2, 'sawtooth', 0.1, -60); this.tone(150, 0.3, 'sawtooth', 0.1, -50, 0.18); },
    explode() { this.noise(0.55, 0.42, 280); this.tone(60, 0.5, 'sawtooth', 0.18, -28); },
    update(dt, playing) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const driving = playing && player && player.inCar && player.car;
      if (driving && !this.muted) {
        const sp = Math.abs(player.car.speed);
        this.engGain.gain.setTargetAtTime(0.012 + Math.min(0.028, sp / 205 * 0.028), t, 0.08);
        this.eng.frequency.setTargetAtTime(48 + sp * 0.52, t, 0.06);
        this.engFilter.frequency.setTargetAtTime(420 + sp * 3.4, t, 0.1);
      } else {
        this.engGain.gain.setTargetAtTime(0, t, 0.16);
      }
      const near = playing && wanted > 0 && nearestCopDist() < 420;
      if (near && !this.muted) {
        this.sirGain.gain.setTargetAtTime(0.009, t, 0.12);
        this.sir.frequency.setTargetAtTime(620 + ((Math.floor(t * 2.6) % 2) ? 180 : 0), t, 0.05);
      } else {
        this.sirGain.gain.setTargetAtTime(0, t, 0.22);
      }
    }
  };

  const keys = {};
  const touch = { active: false, x: 0, y: 0, aHeld: false, bHeld: false };
  const input = { x: 0, y: 0, run: false, actionHeld: false, actionPressed: false };

  function readInput() {
    let x = 0;
    let y = 0;
    if (touch.active) {
      x = touch.x;
      y = touch.y;
    } else {
      if (keys['arrowleft'] || keys['a']) x -= 1;
      if (keys['arrowright'] || keys['d']) x += 1;
      if (keys['arrowup'] || keys['w']) y -= 1;
      if (keys['arrowdown'] || keys['s']) y += 1;
      const len = Math.hypot(x, y);
      if (len > 1) { x /= len; y /= len; }
    }
    input.x = x;
    input.y = y;
    input.run = touch.bHeld || !!keys['shift'];
    input.actionHeld = touch.aHeld || !!keys['j'] || !!keys[' '];
  }

  function resetTouch() {
    touch.active = false;
    touch.x = 0;
    touch.y = 0;
    touch.aHeld = false;
    touch.bHeld = false;
    input.actionHeld = false;
    input.actionPressed = false;
    $('#knob').style.transform = '';
    $('#stick').classList.remove('active');
    $('#btnA').classList.remove('down');
    $('#btnB').classList.remove('down');
  }

  const stick = $('#stick');
  const knob = $('#knob');
  let stickPointer = null;
  function updateStick(e) {
    const rect = stick.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width * 0.36;
    let dx = (e.clientX - cx) / radius;
    let dy = (e.clientY - cy) / radius;
    const len = Math.hypot(dx, dy);
    if (len > 1) { dx /= len; dy /= len; }
    if (len < 0.16) { dx = 0; dy = 0; }
    touch.x = dx;
    touch.y = dy;
    touch.active = !!(dx || dy);
    knob.style.transform = `translate(${dx * radius * 0.82}px,${dy * radius * 0.82}px)`;
  }
  stick.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (stickPointer !== null) return;
    stickPointer = e.pointerId;
    try { stick.setPointerCapture(e.pointerId); } catch (err) {}
    stick.classList.add('active');
    updateStick(e);
  });
  stick.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stickPointer) return;
    e.preventDefault();
    updateStick(e);
  });
  function endStick(e) {
    if (e.pointerId !== stickPointer) return;
    stickPointer = null;
    touch.active = false;
    touch.x = 0;
    touch.y = 0;
    knob.style.transform = '';
    stick.classList.remove('active');
  }
  stick.addEventListener('pointerup', endStick);
  stick.addEventListener('pointercancel', endStick);
  stick.addEventListener('lostpointercapture', endStick);

  function bindButton(el, down, up) {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      el.classList.add('down');
      down();
    });
    const finish = () => { el.classList.remove('down'); up(); };
    el.addEventListener('pointerup', finish);
    el.addEventListener('pointercancel', finish);
    el.addEventListener('lostpointercapture', finish);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  bindButton($('#btnA'), () => { touch.aHeld = true; input.actionPressed = true; }, () => { touch.aHeld = false; });
  bindButton($('#btnB'), () => { touch.bHeld = true; }, () => { touch.bHeld = false; });

  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (['arrowup', 'arrowdown', 'arrowleft', 'arrowright', ' '].includes(k)) e.preventDefault();
    if (e.repeat) return;
    keys[k] = true;
    if (k === 'e' || k === 'enter') input.actionPressed = true;
    if (k === 'escape' || k === 'p') togglePause();
    if (k === 'm') toggleMute();
  });
  window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
  window.addEventListener('blur', () => {
    for (const k of Object.keys(keys)) keys[k] = false;
    resetTouch();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && state === 'playing') togglePause();
  });

  const mapCanvas = document.createElement('canvas');
  mapCanvas.width = WW;
  mapCanvas.height = WH;
  const mctx = mapCanvas.getContext('2d');
  mctx.imageSmoothingEnabled = false;
  const miniCanvas = document.createElement('canvas');
  miniCanvas.width = MW;
  miniCanvas.height = MH;
  const minictx = miniCanvas.getContext('2d');

  let tiles = null;
  let buildings = [];
  let lots = [];
  let neonLights = [];

  const LANDMARKS = [
    { id: 'bowling', bx: 1, by: 1, name: 'BOLICHE', color: '#ff4d9d', roof: '#4a3c58', icon: 'bowling' },
    { id: 'hospital', bx: 4, by: 1, name: 'HOSPITAL', color: '#ff5b5b', roof: '#4c3b3b', icon: 'hospital' },
    { id: 'police', bx: 1, by: 4, name: 'DELEGACIA', color: '#ffd23f', roof: '#35415a', icon: 'police' },
    { id: 'spray', bx: 4, by: 4, name: 'PAYNSPRAY', color: '#45e0d0', roof: '#2f4646', icon: 'spray' },
    { id: 'bar', bx: 2, by: 3, name: 'BAR', color: '#ff8a3d', roof: '#4c3a2f', icon: 'bar' }
  ];

  function tileIndex(tx, ty) { return ty * MW + tx; }
  function tileAt(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return T.WATER;
    return tiles[tileIndex(tx, ty)];
  }
  function solidAt(x, y) { return SOLID[tileAt(x, y)]; }
  function roadAt(x, y) { return tileAt(x, y) === T.ROAD; }
  function walkableTile(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= MW || ty >= MH) return false;
    const t = tiles[tileIndex(tx, ty)];
    return t === T.ROAD || t === T.SIDEWALK || t === T.GRASS || t === T.LOT;
  }
  function blockedCircle(x, y, r) {
    if (solidAt(x, y)) return true;
    if (solidAt(x - r, y) || solidAt(x + r, y) || solidAt(x, y - r) || solidAt(x, y + r)) return true;
    return false;
  }
  function blockOrigin(bx, by) { return { sx: bx * 16 + 7, sy: by * 16 + 7 }; }
  function blockWalk(bx, by, side, off) {
    const o = blockOrigin(bx, by);
    let tx = o.sx;
    let ty = o.sy;
    if (side === 0) { tx = o.sx + off; ty = o.sy; }
    else if (side === 1) { tx = o.sx + 12; ty = o.sy + off; }
    else if (side === 2) { tx = o.sx + off; ty = o.sy + 12; }
    else { tx = o.sx; ty = o.sy + off; }
    return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, tx, ty };
  }
  function landmarkAt(bx, by) {
    for (const lm of LANDMARKS) if (lm.bx === bx && lm.by === by) return lm;
    return null;
  }

  function addBuilding(tx, ty, tw, th, rng) {
    if (tw <= 0 || th <= 0) return;
    for (let y = 0; y < th; y++) {
      for (let x = 0; x < tw; x++) {
        const gx = tx + x;
        const gy = ty + y;
        if (gx >= 0 && gy >= 0 && gx < MW && gy < MH) tiles[tileIndex(gx, gy)] = T.BUILDING;
      }
    }
    const color = ROOF[Math.floor(rng() * ROOF.length)];
    buildings.push({
      tx, ty, tw, th, color,
      seed: (Math.imul(tx + 11, 2654435761) ^ Math.imul(ty + 5, 1597334677)) | 0,
      icon: null, landmark: null
    });
    if (rng() < 0.5) {
      const side = Math.floor(rng() * 4);
      const px = tx * TILE;
      const py = ty * TILE;
      const pw = tw * TILE;
      const ph = th * TILE;
      const color2 = NEON[Math.floor(rng() * NEON.length)];
      let nx = px + 4;
      let ny = py;
      let nw = Math.max(8, pw - 8);
      let nh = 2;
      if (side === 1) { nx = px + pw - 2; ny = py + 4; nw = 2; nh = Math.max(8, ph - 8); }
      else if (side === 2) { nx = px + 4; ny = py + ph - 2; }
      else if (side === 3) { nx = px; ny = py + 4; nw = 2; nh = Math.max(8, ph - 8); }
      neonLights.push({ x: nx + nw / 2, y: ny + nh / 2, color: color2, size: 20, phase: rng() * TAU });
    }
  }

  function generateMap() {
    tiles = new Uint8Array(MW * MH);
    tiles.fill(T.WATER);
    buildings = [];
    lots = [];
    neonLights = [];
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        const vx = x % 16;
        const vy = y % 16;
        if ((vx >= 4 && vx <= 6) || (vy >= 4 && vy <= 6)) tiles[tileIndex(x, y)] = T.ROAD;
      }
    }
    for (let by = 0; by < 6; by++) {
      for (let bx = 0; bx < 6; bx++) {
        const sx = bx * 16 + 7;
        const sy = by * 16 + 7;
        const bw = Math.min(13, MW - sx);
        const bh = Math.min(13, MH - sy);
        if (bw <= 2 || bh <= 2) continue;
        const set = (lx, ly, type) => {
          const gx = sx + lx;
          const gy = sy + ly;
          if (gx >= 0 && gy >= 0 && gx < MW && gy < MH) tiles[tileIndex(gx, gy)] = type;
        };
        for (let ly = 0; ly < bh; ly++) for (let lx = 0; lx < bw; lx++) set(lx, ly, T.SIDEWALK);
        const rng = mulberry32(0x51ab1e ^ Math.imul(bx + 1, 374761393) ^ Math.imul(by + 1, 668265263));
        const lm = landmarkAt(bx, by);
        const iw = bw - 2;
        const ih = bh - 2;
        if (lm) {
          for (let ly = 1; ly <= ih; ly++) for (let lx = 1; lx <= iw; lx++) set(lx, ly, T.BUILDING);
          buildings.push({
            tx: sx + 1, ty: sy + 1, tw: iw, th: ih, color: lm.roof,
            seed: (Math.imul(bx + 7, 7919) ^ Math.imul(by + 3, 104729)) | 0,
            icon: lm.icon, landmark: lm
          });
          neonLights.push({ x: (sx + 1 + iw / 2) * TILE, y: (sy + 1 + ih / 2) * TILE, color: lm.color, size: 34, phase: hash(bx, by, 9) * TAU });
        } else {
          const roll = rng();
          if (roll < 0.14 && iw >= 8 && ih >= 8) {
            for (let ly = 1; ly <= ih; ly++) for (let lx = 1; lx <= iw; lx++) set(lx, ly, T.GRASS);
            const midX = 1 + Math.floor(iw / 2);
            const midY = 1 + Math.floor(ih / 2);
            for (let ly = 1; ly <= ih; ly++) set(midX, ly, T.SIDEWALK);
            for (let lx = 1; lx <= iw; lx++) set(lx, midY, T.SIDEWALK);
            for (let i = 0; i < 6; i++) {
              const lx = 1 + Math.floor(rng() * iw);
              const ly = 1 + Math.floor(rng() * ih);
              if (lx !== midX && ly !== midY) set(lx, ly, T.TREE);
            }
          } else if (roll < 0.3 && iw >= 7 && ih >= 7) {
            for (let ly = 1; ly <= ih; ly++) for (let lx = 1; lx <= iw; lx++) set(lx, ly, T.LOT);
            lots.push({ sx, sy, iw, ih });
          } else if (roll < 0.36 && iw >= 7 && ih >= 7) {
            for (let ly = 1; ly <= ih; ly++) for (let lx = 1; lx <= iw; lx++) set(lx, ly, T.SIDEWALK);
            const cx = 1 + Math.floor(iw / 2);
            const cy = 1 + Math.floor(ih / 2);
            for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) set(cx + a, cy + b, T.WATER);
            for (const c of [[1, 1], [1, ih], [iw, 1], [iw, ih]]) set(c[0], c[1], T.TREE);
          } else {
            const pattern = rng();
            if (pattern < 0.52 && iw >= 11 && ih >= 11) {
              addBuilding(sx + 1, sy + 1, 5, 5, rng);
              addBuilding(sx + 7, sy + 1, 5, 5, rng);
              addBuilding(sx + 1, sy + 7, 5, 5, rng);
              addBuilding(sx + 7, sy + 7, 5, 5, rng);
            } else if (pattern < 0.7 && iw >= 11) {
              addBuilding(sx + 1, sy + 1, 5, ih, rng);
              addBuilding(sx + 7, sy + 1, 5, ih, rng);
            } else if (pattern < 0.86 && ih >= 11) {
              addBuilding(sx + 1, sy + 1, iw, 5, rng);
              addBuilding(sx + 1, sy + 7, iw, 5, rng);
            } else if (pattern < 0.94 && iw >= 11) {
              addBuilding(sx + 1, sy + 1, 3, ih, rng);
              addBuilding(sx + 5, sy + 1, 3, ih, rng);
              addBuilding(sx + 9, sy + 1, 3, ih, rng);
            } else {
              addBuilding(sx + 1, sy + 1, iw, ih, rng);
            }
          }
        }
      }
    }
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        if (x < 4 || y < 4 || x >= MW - 3 || y >= MH - 3) tiles[tileIndex(x, y)] = T.WATER;
      }
    }
  }

  function starPath(c, cx, cy, outer, inner, points) {
    c.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      const a = -Math.PI / 2 + i * Math.PI / points;
      const x = cx + Math.cos(a) * r;
      const y = cy + Math.sin(a) * r;
      if (i === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.closePath();
  }

  function drawMapIcon(icon, cx, cy) {
    mctx.save();
    mctx.translate(cx, cy);
    if (icon === 'bowling') {
      mctx.fillStyle = 'rgba(0,0,0,.5)';
      mctx.beginPath(); mctx.arc(2, 2, 13, 0, TAU); mctx.fill();
      mctx.fillStyle = '#f4efe2';
      mctx.beginPath(); mctx.arc(0, 3, 6, 0, TAU); mctx.fill();
      mctx.fillRect(-2.5, -11, 5, 9);
      mctx.fillRect(-4, -9, 8, 3);
      mctx.fillStyle = '#ff4d9d';
      mctx.fillRect(-2.5, -4, 5, 1);
      mctx.fillRect(-2.5, -1, 5, 1);
      mctx.fillStyle = '#1b1424';
      mctx.fillRect(-3, 1, 1, 2);
      mctx.fillRect(-1, 1, 1, 2);
      mctx.fillRect(1, 1, 1, 2);
    } else if (icon === 'hospital') {
      mctx.fillStyle = 'rgba(0,0,0,.5)'; mctx.fillRect(-11, -11, 26, 26);
      mctx.fillStyle = '#f1ede2'; mctx.fillRect(-12, -12, 24, 24);
      mctx.fillStyle = '#d63a3a';
      mctx.fillRect(-3, -9, 6, 18);
      mctx.fillRect(-9, -3, 18, 6);
    } else if (icon === 'police') {
      mctx.fillStyle = 'rgba(0,0,0,.5)'; mctx.beginPath(); mctx.arc(2, 2, 13, 0, TAU); mctx.fill();
      mctx.fillStyle = '#2d3d60'; mctx.beginPath(); mctx.arc(0, 0, 12, 0, TAU); mctx.fill();
      mctx.fillStyle = '#ffd23f';
      starPath(mctx, 0, 0, 8, 4, 5);
      mctx.fill();
    } else if (icon === 'spray') {
      mctx.fillStyle = 'rgba(0,0,0,.5)'; mctx.fillRect(-10, -10, 22, 24);
      mctx.fillStyle = '#45e0d0'; mctx.fillRect(-6, -8, 12, 18);
      mctx.fillStyle = '#123b3b'; mctx.fillRect(-3, -12, 6, 4); mctx.fillRect(-2, -6, 4, 6);
      mctx.fillStyle = '#eafffb'; mctx.fillRect(-5, 6, 3, 2);
    } else if (icon === 'bar') {
      mctx.fillStyle = 'rgba(0,0,0,.5)'; mctx.fillRect(-10, -10, 22, 24);
      mctx.fillStyle = '#ff8a3d'; mctx.fillRect(-7, -9, 14, 20);
      mctx.fillStyle = '#2a170d'; mctx.fillRect(-4, -4, 8, 10);
      mctx.fillStyle = '#ffe1b0'; mctx.fillRect(-2, 4, 4, 2);
    }
    mctx.restore();
  }

  function drawBuilding(b) {
    const px = b.tx * TILE;
    const py = b.ty * TILE;
    const pw = b.tw * TILE;
    const ph = b.th * TILE;
    const rng = mulberry32(b.seed);
    mctx.fillStyle = 'rgba(0,0,0,.42)';
    mctx.fillRect(px + 4, py + 4, pw, ph);
    mctx.fillStyle = b.color;
    mctx.fillRect(px, py, pw, ph);
    mctx.fillStyle = 'rgba(255,255,255,.09)';
    mctx.fillRect(px, py, pw, 2);
    mctx.fillRect(px, py, 2, ph);
    mctx.fillStyle = 'rgba(0,0,0,.36)';
    mctx.fillRect(px, py + ph - 2, pw, 2);
    mctx.fillRect(px + pw - 2, py, 2, ph);
    mctx.strokeStyle = 'rgba(0,0,0,.22)';
    mctx.lineWidth = 1;
    mctx.strokeRect(px + 4.5, py + 4.5, pw - 9, ph - 9);
    const speckCount = Math.floor((pw * ph) / 90);
    for (let i = 0; i < speckCount; i++) {
      mctx.fillStyle = rng() < 0.5 ? 'rgba(255,255,255,.035)' : 'rgba(0,0,0,.09)';
      mctx.fillRect(px + 4 + Math.floor(rng() * Math.max(1, pw - 8)), py + 4 + Math.floor(rng() * Math.max(1, ph - 8)), 1, 1);
    }
    const vents = 1 + Math.floor(rng() * 3);
    for (let i = 0; i < vents; i++) {
      const vw = 8 + Math.floor(rng() * 10);
      const vh = 6 + Math.floor(rng() * 7);
      const vx = px + 8 + Math.floor(rng() * Math.max(1, pw - vw - 16));
      const vy = py + 8 + Math.floor(rng() * Math.max(1, ph - vh - 16));
      mctx.fillStyle = 'rgba(0,0,0,.28)';
      mctx.fillRect(vx + 2, vy + 2, vw, vh);
      mctx.fillStyle = '#6b717b';
      mctx.fillRect(vx, vy, vw, vh);
      mctx.fillStyle = '#8f96a1';
      mctx.fillRect(vx, vy, vw, 2);
      mctx.fillStyle = '#2c3037';
      mctx.fillRect(vx + 2, vy + 3, vw - 4, 1);
      mctx.fillRect(vx + 2, vy + 6, vw - 4, 1);
    }
    if (pw > 60 && ph > 60 && rng() < 0.38) {
      const wx = px + 10 + Math.floor(rng() * (pw - 40));
      const wy = py + 10 + Math.floor(rng() * (ph - 40));
      mctx.fillStyle = 'rgba(0,0,0,.3)';
      mctx.beginPath(); mctx.arc(wx + 2, wy + 2, 9, 0, TAU); mctx.fill();
      mctx.fillStyle = '#545b66';
      mctx.beginPath(); mctx.arc(wx, wy, 9, 0, TAU); mctx.fill();
      mctx.fillStyle = '#333941';
      mctx.beginPath(); mctx.arc(wx, wy, 6, 0, TAU); mctx.fill();
    }
    if (pw > 54 && ph > 54 && rng() < 0.3) {
      const sx = px + 14 + Math.floor(rng() * Math.max(1, pw - 40));
      const sy = py + 14 + Math.floor(rng() * Math.max(1, ph - 36));
      mctx.fillStyle = 'rgba(0,0,0,.3)';
      mctx.fillRect(sx + 2, sy + 2, 16, 9);
      mctx.fillStyle = '#2b4a5e';
      mctx.fillRect(sx, sy, 16, 9);
      mctx.fillStyle = 'rgba(120,210,235,.35)';
      mctx.fillRect(sx + 2, sy + 2, 12, 4);
    }
    if (b.landmark) {
      mctx.fillStyle = 'rgba(0,0,0,.22)';
      mctx.fillRect(px + 6, py + 6, pw - 12, ph - 12);
      drawMapIcon(b.icon, px + pw / 2, py + ph / 2);
    } else if (rng() < 0.18) {
      const cx = px + pw / 2;
      const cy = py + ph / 2;
      mctx.fillStyle = 'rgba(255,255,255,.045)';
      mctx.fillRect(cx - 14, cy - 4, 28, 8);
      mctx.fillStyle = 'rgba(255,210,63,.3)';
      for (let i = 0; i < 5; i++) mctx.fillRect(cx - 12 + i * 5, cy - 2, 2, 4);
    }
  }

  function drawTree(cx, cy, seed) {
    const rng = mulberry32(seed | 0);
    const r = 6 + rng() * 3;
    mctx.fillStyle = 'rgba(0,0,0,.28)';
    mctx.beginPath(); mctx.ellipse(cx + 2, cy + 3, r + 2, r * 0.6 + 1, 0, 0, TAU); mctx.fill();
    mctx.fillStyle = '#4a3421';
    mctx.fillRect(cx - 1, cy - 1, 3, 6);
    mctx.fillStyle = '#285137';
    mctx.beginPath(); mctx.arc(cx - 2, cy - 2, r * 0.85, 0, TAU); mctx.fill();
    mctx.fillStyle = '#376943';
    mctx.beginPath(); mctx.arc(cx + 2, cy - 1, r * 0.65, 0, TAU); mctx.fill();
    mctx.fillStyle = '#4a7f50';
    mctx.fillRect(cx - 1, cy - 5, 3, 2);
    mctx.fillRect(cx - 4, cy - 2, 2, 2);
  }

  function renderMap() {
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.imageSmoothingEnabled = false;
    mctx.fillStyle = '#0d2032';
    mctx.fillRect(0, 0, WW, WH);
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        const t = tiles[tileIndex(x, y)];
        const px = x * TILE;
        const py = y * TILE;
        const h = hash(x, y, 3);
        if (t === T.ROAD) {
          mctx.fillStyle = ['#24272e', '#262a31', '#22252b'][(x * 5 + y * 3) % 3];
          mctx.fillRect(px, py, TILE, TILE);
          if (h < 0.12) {
            mctx.fillStyle = 'rgba(0,0,0,.18)';
            mctx.fillRect(px + 2 + Math.floor(h * 20) % 10, py + 3 + Math.floor(h * 90) % 10, 4, 2);
          }
        } else if (t === T.SIDEWALK) {
          mctx.fillStyle = h < 0.5 ? '#5e636c' : '#60656e';
          mctx.fillRect(px, py, TILE, TILE);
          mctx.fillStyle = 'rgba(0,0,0,.10)';
          mctx.fillRect(px, py + 15, TILE, 1);
          mctx.fillRect(px + 15, py, 1, TILE);
          if (h > 0.93) {
            mctx.fillStyle = 'rgba(0,0,0,.14)';
            mctx.fillRect(px + 4, py + 7, 5, 1);
          }
        } else if (t === T.BUILDING) {
          mctx.fillStyle = '#2a2d34';
          mctx.fillRect(px, py, TILE, TILE);
        } else if (t === T.GRASS || t === T.TREE) {
          mctx.fillStyle = h < 0.5 ? '#2e4732' : '#314c35';
          mctx.fillRect(px, py, TILE, TILE);
          if (h < 0.25) {
            mctx.fillStyle = '#3a5a3c';
            mctx.fillRect(px + 3 + Math.floor(h * 60) % 9, py + 4 + Math.floor(h * 80) % 8, 2, 2);
          }
        } else if (t === T.LOT) {
          mctx.fillStyle = '#2a2d33';
          mctx.fillRect(px, py, TILE, TILE);
          if (h < 0.08) {
            mctx.fillStyle = 'rgba(0,0,0,.22)';
            mctx.beginPath(); mctx.ellipse(px + 8, py + 8, 4, 2.5, 0, 0, TAU); mctx.fill();
          }
        } else if (t === T.WATER) {
          mctx.fillStyle = '#0e2235';
          mctx.fillRect(px, py, TILE, TILE);
          if (h < 0.55) {
            mctx.fillStyle = '#173a54';
            mctx.fillRect(px + 2 + Math.floor(h * 40) % 8, py + 5 + Math.floor(h * 70) % 8, 6, 1);
          }
          if (h > 0.9) {
            mctx.fillStyle = '#1e4a65';
            mctx.fillRect(px + 5, py + 11, 3, 1);
          }
        }
      }
    }
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        if (tiles[tileIndex(x, y)] !== T.SIDEWALK) continue;
        const px = x * TILE;
        const py = y * TILE;
        mctx.fillStyle = '#8a919a';
        if (y > 0 && tiles[tileIndex(x, y - 1)] === T.ROAD) mctx.fillRect(px, py, TILE, 2);
        if (y < MH - 1 && tiles[tileIndex(x, y + 1)] === T.ROAD) mctx.fillRect(px, py + 14, TILE, 2);
        if (x > 0 && tiles[tileIndex(x - 1, y)] === T.ROAD) mctx.fillRect(px, py, 2, TILE);
        if (x < MW - 1 && tiles[tileIndex(x + 1, y)] === T.ROAD) mctx.fillRect(px + 14, py, 2, TILE);
      }
    }
    mctx.fillStyle = '#b79a3a';
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        if (tiles[tileIndex(x, y)] !== T.ROAD) continue;
        const vx = x % 16;
        const vy = y % 16;
        if (vx === 5 && !(vy >= 4 && vy <= 6) && y % 2 === 0) {
          mctx.fillRect(x * TILE + 7, y * TILE + 4, 2, 8);
        }
        if (vy === 5 && !(vx >= 4 && vx <= 6) && x % 2 === 0) {
          mctx.fillRect(x * TILE + 4, y * TILE + 7, 8, 2);
        }
      }
    }
    mctx.fillStyle = 'rgba(224,224,210,.52)';
    for (let ky = 0; ky < 6; ky++) {
      for (let kx = 0; kx < 6; kx++) {
        const ix = (kx * 16 + 4) * TILE;
        const iy = (ky * 16 + 4) * TILE;
        for (let i = 0; i < 5; i++) {
          mctx.fillRect(ix + 3 + i * 9, iy + 2, 5, 6);
          mctx.fillRect(ix + 3 + i * 9, iy + 40, 5, 6);
          mctx.fillRect(ix + 2, iy + 3 + i * 9, 6, 5);
          mctx.fillRect(ix + 40, iy + 3 + i * 9, 6, 5);
        }
      }
    }
    for (const lot of lots) {
      mctx.strokeStyle = 'rgba(224,224,205,.2)';
      mctx.lineWidth = 1;
      for (let i = 0; i <= 5; i++) {
        const gx = (lot.sx + 1 + i * 2) * TILE + 0.5;
        mctx.beginPath(); mctx.moveTo(gx, (lot.sy + 1) * TILE); mctx.lineTo(gx, (lot.sy + 6) * TILE); mctx.stroke();
        mctx.beginPath(); mctx.moveTo(gx, (lot.sy + 6) * TILE); mctx.lineTo(gx, (lot.sy + 11) * TILE); mctx.stroke();
      }
    }
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        if (tiles[tileIndex(x, y)] !== T.SIDEWALK) continue;
        const px = x * TILE;
        const py = y * TILE;
        const h = hash(x, y, 11);
        if (h < 0.012) {
          mctx.fillStyle = '#b73535';
          mctx.fillRect(px + 6, py + 7, 4, 5);
          mctx.fillStyle = '#d64a4a';
          mctx.fillRect(px + 6, py + 6, 4, 2);
        } else if (h > 0.985) {
          mctx.fillStyle = '#2f3b33';
          mctx.fillRect(px + 5, py + 6, 6, 7);
          mctx.fillStyle = '#465a4c';
          mctx.fillRect(px + 5, py + 6, 6, 2);
        }
      }
    }
    for (const b of buildings) drawBuilding(b);
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        if (tiles[tileIndex(x, y)] === T.TREE) drawTree(x * TILE + 8, y * TILE + 8, (Math.imul(x + 3, 73856093) ^ Math.imul(y + 7, 19349663)) | 0);
      }
    }
    for (const n of neonLights) {
      mctx.fillStyle = n.color;
      mctx.globalAlpha = 0.8;
      mctx.fillRect(n.x - n.size / 2, n.y - 1, n.size, 2);
      mctx.globalAlpha = 1;
    }
  }

  function renderMiniMap() {
    minictx.clearRect(0, 0, MW, MH);
    const colors = ['#2b2f36', '#4c515b', '#343845', '#2c4632', '#3a3d44', '#0e2033', '#27402c'];
    for (let y = 0; y < MH; y++) {
      for (let x = 0; x < MW; x++) {
        minictx.fillStyle = colors[tiles[tileIndex(x, y)]];
        minictx.fillRect(x, y, 1, 1);
      }
    }
    for (const lm of LANDMARKS) {
      minictx.fillStyle = lm.color;
      minictx.fillRect(lm.bx * 16 + 8, lm.by * 16 + 8, 2, 2);
    }
  }

  const CAR_DEFS = {
    sedan: { w: 12, h: 24 },
    taxi: { w: 12, h: 24 },
    sports: { w: 11, h: 22 },
    van: { w: 14, h: 26 },
    cop: { w: 12, h: 24 }
  };
  const CAR_COLORS = ['#b7bcc4', '#8d2f2f', '#2f5b8d', '#c9a227', '#4c7a52', '#744f8d', '#3d444f', '#a35c2f', '#2f7d82'];
  const carSprites = new Map();

  function getCarSprite(type, color, dirIndex) {
    const key = type + '|' + color + '|' + dirIndex;
    if (carSprites.has(key)) return carSprites.get(key);
    const def = CAR_DEFS[type] || CAR_DEFS.sedan;
    const c = document.createElement('canvas');
    c.width = 48;
    c.height = 48;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.translate(24, 24);
    g.rotate(dirIndex * Math.PI / 4);
    const w = def.w;
    const h = def.h;
    g.fillStyle = 'rgba(0,0,0,.45)';
    g.fillRect(-w / 2 + 1, -h / 2 + 2, w, h);
    g.fillStyle = shade(color, 0.62);
    g.fillRect(-w / 2, -h / 2, w, h);
    g.fillStyle = color;
    g.fillRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);
    g.fillStyle = shade(color, 1.18);
    g.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, 2);
    g.fillStyle = shade(color, 0.8);
    g.fillRect(w / 2 - 3, -h / 2 + 3, 2, h - 6);
    g.fillStyle = '#10151c';
    g.fillRect(-w / 2 - 1, -h / 2 + 4, 2, 4);
    g.fillRect(-w / 2 - 1, h / 2 - 8, 2, 4);
    g.fillRect(w / 2 - 1, -h / 2 + 4, 2, 4);
    g.fillRect(w / 2 - 1, h / 2 - 8, 2, 4);
    g.fillStyle = '#9fc4d1';
    g.fillRect(-w / 2 + 2, -h / 2 + 4, w - 4, 4);
    g.fillStyle = shade(color, 0.72);
    g.fillRect(-w / 2 + 2, -h / 2 + 8, w - 4, 8);
    g.fillStyle = '#182431';
    g.fillRect(-w / 2 + 3, -h / 2 + 9, w - 6, 3);
    g.fillStyle = '#9fc4d1';
    g.fillRect(-w / 2 + 2, h / 2 - 8, w - 4, 3);
    g.fillStyle = '#ffe7a3';
    g.fillRect(-w / 2 + 2, -h / 2 + 1, 2, 2);
    g.fillRect(w / 2 - 4, -h / 2 + 1, 2, 2);
    g.fillStyle = '#e04a4a';
    g.fillRect(-w / 2 + 2, h / 2 - 3, 2, 2);
    g.fillRect(w / 2 - 4, h / 2 - 3, 2, 2);
    if (type === 'taxi') {
      g.fillStyle = '#14181f';
      g.fillRect(-4, -4, 8, 4);
      g.fillStyle = '#ffd23f';
      g.fillRect(-3, -3, 6, 2);
    }
    if (type === 'van') {
      g.fillStyle = shade(color, 0.9);
      g.fillRect(-w / 2 + 2, -h / 2 + 12, w - 4, 1);
      g.fillRect(-w / 2 + 2, -h / 2 + 18, w - 4, 1);
    }
    if (type === 'cop') {
      g.fillStyle = '#e8e8e0';
      g.fillRect(-w / 2 + 2, -4, 2, 10);
      g.fillRect(w / 2 - 4, -4, 2, 10);
      g.fillStyle = '#141a25';
      g.fillRect(-7, -3, 14, 5);
      g.fillStyle = '#ff2f3f';
      g.fillRect(-6, -2, 5, 3);
      g.fillStyle = '#3f8dff';
      g.fillRect(1, -2, 5, 3);
    }
    carSprites.set(key, c);
    return c;
  }

  function carDirIndex(angle) {
    let idx = Math.round((angle + Math.PI / 2) / (Math.PI / 4));
    idx = ((idx % 8) + 8) % 8;
    return idx;
  }

  function drawCar(car) {
    const idx = carDirIndex(car.angle);
    const sprite = getCarSprite(car.def.type, car.color, idx);
    ctx.drawImage(sprite, Math.round(car.x) - 24, Math.round(car.y) - 24);
    if (car.role === 'cop' && !car.dead) {
      ctx.save();
      ctx.translate(car.x, car.y);
      ctx.rotate(idx * Math.PI / 4);
      const on = Math.floor(time * 6) % 2 === 0;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = on ? '#ff3d4d' : '#5a1016';
      ctx.fillRect(-6, -3, 5, 3);
      ctx.fillStyle = on ? '#1b2440' : '#4b8dff';
      ctx.fillRect(1, -3, 5, 3);
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = on ? '#ff3d4d' : '#4b8dff';
      ctx.beginPath(); ctx.arc(0, -2, 10, 0, TAU); ctx.fill();
      ctx.restore();
    }
    if (car.missionId) {
      ctx.save();
      ctx.globalAlpha = 0.45 + Math.sin(time * 5) * 0.15;
      ctx.strokeStyle = '#45e0d0';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(car.x, car.y + 4, 14, 8, 0, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawPed(x, y, angle, phase, shirt, skin, opts) {
    const moving = opts && opts.moving;
    const bob = moving ? Math.sin(phase) * 0.8 : 0;
    const dir = Math.abs(Math.sin(angle)) > Math.abs(Math.cos(angle))
      ? (Math.sin(angle) > 0 ? 0 : 2)
      : (Math.cos(angle) > 0 ? 3 : 1);
    const swing = moving ? Math.sin(phase) * 1.5 : 0;
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y) + bob);
    ctx.fillStyle = 'rgba(0,0,0,.4)';
    ctx.beginPath();
    ctx.ellipse(0, 4, 4.5, 2.2, 0, 0, TAU);
    ctx.fill();
    if (opts && opts.player) {
      ctx.fillStyle = 'rgba(69,224,208,.10)';
      ctx.beginPath(); ctx.arc(0, 1, 8, 0, TAU); ctx.fill();
    }
    const legColor = '#232a35';
    ctx.fillStyle = legColor;
    ctx.fillRect(-2.5, 1 + swing, 2, 3);
    ctx.fillRect(0.5, 1 - swing, 2, 3);
    ctx.fillStyle = '#0b0e13';
    ctx.fillRect(-3, -3, 6, 6);
    ctx.fillStyle = shirt;
    ctx.fillRect(-2, -3, 4, 5);
    if (dir === 3) {
      ctx.fillStyle = shirt;
      ctx.fillRect(2, -2, 1, 3);
      ctx.fillStyle = skin;
      ctx.fillRect(-1.5, -7, 3, 3);
      ctx.fillStyle = '#191c22';
      ctx.fillRect(-1.5, -7, 3, 1);
      ctx.fillRect(-2, -6, 1, 1);
      ctx.fillStyle = '#101318';
      ctx.fillRect(1, -6, 1, 1);
    } else if (dir === 1) {
      ctx.fillStyle = shirt;
      ctx.fillRect(-3, -2, 1, 3);
      ctx.fillStyle = skin;
      ctx.fillRect(-1.5, -7, 3, 3);
      ctx.fillStyle = '#191c22';
      ctx.fillRect(-1.5, -7, 3, 1);
      ctx.fillRect(1, -6, 1, 1);
    } else if (dir === 0) {
      ctx.fillStyle = skin;
      ctx.fillRect(-1.5, -7, 3, 3);
      ctx.fillStyle = '#191c22';
      ctx.fillRect(-1.5, -7, 3, 1);
      ctx.fillStyle = '#0d1014';
      ctx.fillRect(-1, -6, 1, 1);
      ctx.fillRect(0.5, -6, 1, 1);
    } else {
      ctx.fillStyle = skin;
      ctx.fillRect(-1.5, -7, 3, 3);
      ctx.fillStyle = '#191c22';
      ctx.fillRect(-1.5, -7, 3, 2);
      ctx.fillRect(-1.5, -5, 3, 1);
    }
    ctx.fillStyle = shirt;
    ctx.fillRect(-3, -2, 1, 3);
    ctx.fillRect(2, -2, 1, 3);
    ctx.restore();
  }

  function drawBadge(x, y, letter, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = 'rgba(5,8,12,.9)';
    ctx.fillRect(Math.round(x) - 6, Math.round(y) - 6, 12, 12);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(x) - 5.5, Math.round(y) - 5.5, 11, 11);
    ctx.fillStyle = color;
    ctx.font = 'bold 8px "Courier New",monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(letter, Math.round(x), Math.round(y) + 0.5);
    ctx.restore();
  }

  function drawGroundRing(x, y, color, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(x, y + 3, size, size * 0.55, 0, 0, TAU);
    ctx.stroke();
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.ellipse(x, y + 3, size, size * 0.55, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawObjectiveMarker(x, y, color) {
    const pulse = 0.65 + Math.sin(time * 5) * 0.25;
    drawGroundRing(x, y, color, 12 + Math.sin(time * 5) * 1.5, pulse);
    const bob = Math.sin(time * 4) * 2;
    ctx.save();
    ctx.translate(x, y - 16 + bob);
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, 5);
    ctx.lineTo(-4, -1);
    ctx.lineTo(4, -1);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.5)';
    ctx.stroke();
    ctx.restore();
  }

  let state = 'menu';
  let time = 0;
  let menuT = 0;
  let wanted = 0;
  let wantedFlash = 0;
  let escapeTimer = 0;
  let copSpawnTimer = 0;
  let sprayCd = 0;
  let hintTimer = 0;
  let playerHitCd = 0;
  let ambientTimer = 0;
  let shake = 0;
  let flash = 0;
  let banner = null;
  let activeMission = null;
  let missions = [];
  let vehicles = [];
  let peds = [];
  let bullets = [];
  let particles = [];
  let rings = [];
  let floaters = [];
  let pickups = [];
  let notices = [];
  let camera = { x: WW / 2, y: WH / 2 };

  const player = {
    x: 0, y: 0, angle: 0, health: 100, armor: 0, ammo: 18, cash: 500,
    inCar: false, car: null, walkPhase: 0, fireCd: 0, punchCd: 0, lastDamage: 0
  };

  const START = blockWalk(2, 2, 2, 5);
  const START_CAR = { x: (blockWalk(2, 2, 2, 5).tx + 0.5) * TILE, y: (blockWalk(2, 2, 2, 5).ty + 1.5) * TILE };
  const HOSPITAL = blockWalk(4, 1, 3, 4);
  const SPRAY = blockWalk(4, 4, 1, 8);

  function focusPoint() {
    if (state !== 'menu' && player.inCar && player.car && !player.car.dead) return { x: player.car.x, y: player.car.y };
    if (state === 'menu') return { x: camera.x, y: camera.y };
    return { x: player.x, y: player.y };
  }

  function buildMissions() {
    missions = [
      {
        id: 'rui', who: 'RUI', letter: 'R', color: '#ffd23f', shirt: '#c9b24f',
        giver: blockWalk(1, 1, 0, 4), dest: blockWalk(1, 1, 1, 7), pickup: null,
        carSpawn: null, stage: 'dest', reward: 300, timeLimit: 0,
        start: 'RUI: Primo! Vamos ao boliche? Te espero lá!',
        obj: 'BOLICHE COM O PRIMO', destLabel: 'CHEGUE AO BOLICHE',
        rt: { state: 'idle', cooldown: 0, stage: null, car: null, timer: 0 }
      },
      {
        id: 'bruno', who: 'BRUNO', letter: 'B', color: '#45e0d0', shirt: '#4f8ec9',
        giver: blockWalk(4, 4, 3, 4), dest: SPRAY, pickup: null,
        carSpawn: { x: 69.5 * TILE, y: 77.5 * TILE, angle: Math.PI / 2 },
        stage: 'car', reward: 550, timeLimit: 0,
        start: "BRUNO: Rouba o carro marcado e traz pro Pay'n'Spray. Sem arranhões!",
        obj: 'ENTREGA DO BRUNO', destLabel: "ENTREGUE NO PAY'N'SPRAY",
        rt: { state: 'idle', cooldown: 0, stage: null, car: null, timer: 0 }
      },
      {
        id: 'jacob', who: 'JACOB', letter: 'J', color: '#ff8a3d', shirt: '#5bbf8a',
        giver: blockWalk(2, 3, 2, 4), dest: blockWalk(2, 3, 0, 4), pickup: blockWalk(2, 3, 3, 3),
        carSpawn: null, stage: 'pickup', reward: 450, timeLimit: 0,
        start: 'JACOB: Pega o pacote no beco e leva pro bar. Sem polícia.',
        obj: 'O PACOTE DO JACOB', destLabel: 'LEVE O PACOTE AO BAR',
        rt: { state: 'idle', cooldown: 0, stage: null, car: null, timer: 0 }
      }
    ];
    activeMission = null;
  }

  function createVehicle(x, y, angle, type, role, color) {
    const def = CAR_DEFS[type] || CAR_DEFS.sedan;
    const car = {
      x, y, angle, speed: 0, def: { ...def, type }, color: color || pick(CAR_COLORS),
      role: role || 'parked', health: 100, missionId: null, fireCd: 1,
      stuck: 0, dead: false, gone: false, baseSpeed: rand(55, 82)
    };
    vehicles.push(car);
    return car;
  }

  function freeSpot(x, y, r) {
    for (const v of vehicles) {
      if (v.gone || v.dead) continue;
      if (dist(x, y, v.x, v.y) < r) return false;
    }
    return true;
  }

  function createStartCar() {
    const car = createVehicle(START_CAR.x, START_CAR.y, 0, 'sedan', 'parked', '#2f5b8d');
    car.health = 100;
  }

  function populateParkedCars() {
    for (const lot of lots) {
      const slots = [
        { x: (lot.sx + 2) * TILE, y: (lot.sy + 3.5) * TILE },
        { x: (lot.sx + 4) * TILE, y: (lot.sy + 3.5) * TILE },
        { x: (lot.sx + 6) * TILE, y: (lot.sy + 8.5) * TILE },
        { x: (lot.sx + 8) * TILE, y: (lot.sy + 8.5) * TILE }
      ];
      let added = 0;
      for (const slot of slots) {
        if (added >= 2) break;
        if (!freeSpot(slot.x, slot.y, 28)) continue;
        if (Math.random() < 0.4) continue;
        createVehicle(slot.x, slot.y, Math.PI / 2, pick(['sedan', 'taxi', 'sports', 'van']), 'parked');
        added++;
      }
    }
    let count = 0;
    for (let attempt = 0; attempt < 400 && count < 16; attempt++) {
      const tx = 4 + Math.floor(Math.random() * (MW - 8));
      const ty = 4 + Math.floor(Math.random() * (MH - 8));
      const vx = tx % 16;
      const vy = ty % 16;
      const vertical = (vx === 4 || vx === 6) && !(vy >= 4 && vy <= 6);
      const horizontal = (vy === 4 || vy === 6) && !(vx >= 4 && vx <= 6);
      if (!vertical && !horizontal) continue;
      const x = (tx + 0.5) * TILE;
      const y = (ty + 0.5) * TILE;
      if (dist(x, y, START_CAR.x, START_CAR.y) < 50) continue;
      if (!freeSpot(x, y, 34)) continue;
      const angle = vertical
        ? (vx === 4 ? Math.PI / 2 : -Math.PI / 2)
        : (vy === 6 ? 0 : Math.PI);
      createVehicle(x, y, angle, pick(['sedan', 'taxi', 'sports', 'van', 'sedan']), 'parked');
      count++;
    }
  }

  function randomWalkablePoint(focus, minR, maxR, sidewalkOnly) {
    for (let attempt = 0; attempt < 70; attempt++) {
      const a = Math.random() * TAU;
      const r = rand(minR, maxR);
      const x = focus.x + Math.cos(a) * r;
      const y = focus.y + Math.sin(a) * r;
      if (x < 40 || y < 40 || x > WW - 40 || y > WH - 40) continue;
      const t = tileAt(x, y);
      if (sidewalkOnly && t !== T.SIDEWALK && t !== T.GRASS && t !== T.LOT) continue;
      if (!walkableTile(Math.floor(x / TILE), Math.floor(y / TILE))) continue;
      if (blockedCircle(x, y, 4)) continue;
      return { x, y };
    }
    return null;
  }

  function makePed(x, y, shirt, skin) {
    return {
      x, y, angle: rand(0, TAU), tx: x, ty: y, timer: 0, speed: rand(18, 34),
      shirt: shirt || pick(SHIRT), skin: skin || pick(SKIN), phase: rand(0, 10),
      flee: 0, threatX: x, threatY: y, dead: false, gone: false, moving: false
    };
  }

  function spawnPed() {
    const focus = focusPoint();
    const spot = randomWalkablePoint(focus, 90, 500, true) || randomWalkablePoint(focus, 70, 380, false);
    if (!spot) return false;
    peds.push(makePed(spot.x, spot.y));
    return true;
  }

  function ensurePeds(force) {
    let alive = 0;
    for (const p of peds) if (!p.dead && !p.gone) alive++;
    let target = 22;
    let guard = 0;
    while (alive < target && guard < 8) {
      if (!spawnPed()) break;
      alive++;
      guard++;
    }
  }

  function spawnTraffic(force) {
    const focus = focusPoint();
    for (let attempt = 0; attempt < 100; attempt++) {
      const tx = 4 + Math.floor(Math.random() * (MW - 8));
      const ty = 4 + Math.floor(Math.random() * (MH - 8));
      const vx = tx % 16;
      const vy = ty % 16;
      const vertical = (vx === 4 || vx === 6) && !(vy >= 4 && vy <= 6);
      const horizontal = (vy === 4 || vy === 6) && !(vx >= 4 && vx <= 6);
      if (!vertical && !horizontal) continue;
      const x = (tx + 0.5) * TILE;
      const y = (ty + 0.5) * TILE;
      const d = dist(x, y, focus.x, focus.y);
      if (d < (force ? 120 : 160) || d > 480) continue;
      if (!freeSpot(x, y, 40)) continue;
      const angle = vertical
        ? (vx === 4 ? Math.PI / 2 : -Math.PI / 2)
        : (vy === 6 ? 0 : Math.PI);
      const car = createVehicle(x, y, angle, pick(['sedan', 'taxi', 'sports', 'van']), 'traffic');
      car.speed = car.baseSpeed;
      return true;
    }
    return false;
  }

  function ensureTraffic(force) {
    let count = 0;
    for (const v of vehicles) if (v.role === 'traffic' && !v.dead && !v.gone) count++;
    let guard = 0;
    while (count < 7 && guard < 4) {
      if (!spawnTraffic(force)) break;
      count++;
      guard++;
    }
  }

  function initPickups() {
    pickups = [
      { type: 'health', x: blockWalk(4, 1, 0, 3).x, y: blockWalk(4, 1, 0, 3).y, active: true, timer: 0 },
      { type: 'armor', x: blockWalk(1, 4, 1, 6).x, y: blockWalk(1, 4, 1, 6).y, active: true, timer: 0 },
      { type: 'ammo', x: blockWalk(2, 3, 3, 3).x, y: blockWalk(2, 3, 3, 3).y, active: true, timer: 0 },
      { type: 'cash', x: blockWalk(1, 1, 2, 6).x, y: blockWalk(1, 1, 2, 6).y, active: true, timer: 0 },
      { type: 'cash', x: blockWalk(4, 4, 2, 6).x, y: blockWalk(4, 4, 2, 6).y, active: true, timer: 0 }
    ];
  }

  function resetWorld() {
    renderMap();
    vehicles = [];
    peds = [];
    bullets = [];
    particles = [];
    rings = [];
    floaters = [];
    notices = [];
    pickups = [];
    banner = null;
    wanted = 0;
    wantedFlash = 0;
    escapeTimer = 0;
    copSpawnTimer = 0;
    sprayCd = 0;
    hintTimer = 0;
    playerHitCd = 0;
    shake = 0;
    flash = 0;
    ambientTimer = 0;
    player.health = 100;
    player.armor = 0;
    player.ammo = 18;
    player.cash = 500;
    player.inCar = false;
    player.car = null;
    player.angle = 0;
    player.walkPhase = 0;
    player.fireCd = 0;
    player.punchCd = 0;
    player.lastDamage = 0;
    player.x = START.x;
    player.y = START.y;
    buildMissions();
    createStartCar();
    populateParkedCars();
    ensurePeds(true);
    ensureTraffic(true);
    initPickups();
    camera.x = clamp(player.x, W / 2, WW - W / 2);
    camera.y = clamp(player.y, H / 2, WH - H / 2);
  }

  function nearestCopDist() {
    let best = Infinity;
    for (const v of vehicles) {
      if (v.role !== 'cop' || v.dead || v.gone) continue;
      const d = dist(v.x, v.y, player.x, player.y);
      if (d < best) best = d;
    }
    return best;
  }

  function addWanted(amount, reason) {
    if (state !== 'playing') return;
    wanted = clamp(wanted + amount, 0, 5);
    wantedFlash = 1;
    escapeTimer = 0;
    copSpawnTimer = Math.min(copSpawnTimer, 0.4);
    if (reason) say(`PROCURADO · ${reason}`, '#ff8a8a', 2.4);
  }

  function disperseCops() {
    for (const v of vehicles) {
      if (v.role === 'cop') {
        v.role = 'parked';
        v.speed = 0;
      }
    }
  }

  function say(text, color, dur) {
    notices.push({ text, color: color || '#e9e7dc', life: dur || 3, max: dur || 3 });
    if (notices.length > 4) notices.shift();
  }

  function addFloat(x, y, text, color) {
    floaters.push({ x, y, text, color: color || '#7dff9a', life: 1.2, max: 1.2 });
  }

  function burst(x, y, colors, count, speed) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * TAU;
      const s = rand(speed * 0.3, speed);
      particles.push({
        x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        life: rand(0.2, 0.7), max: 0.7, size: rand(1, 3), color: pick(colors), gravity: 0
      });
    }
    if (particles.length > 220) particles.splice(0, particles.length - 220);
  }

  function nearGiver() {
    for (const m of missions) {
      if (m.rt.state !== 'idle') continue;
      if (dist(player.x, player.y, m.giver.x, m.giver.y) < 27) return m;
    }
    return null;
  }

  function nearestCar() {
    let best = null;
    let bd = 36;
    for (const v of vehicles) {
      if (v.dead || v.gone) continue;
      const d = dist(player.x, player.y, v.x, v.y);
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  function getInteraction() {
    if (player.inCar) return { kind: 'exit', label: 'SAIR', sub: 'B · FREIO' };
    const g = nearGiver();
    if (g) return { kind: 'talk', mission: g, label: 'FALAR COM ' + g.who, sub: '' };
    const c = nearestCar();
    if (c) return { kind: 'enter', car: c, label: 'ENTRAR NO CARRO', sub: '' };
    if (player.ammo > 0) return { kind: 'shoot', label: 'ATIRAR', sub: '' };
    return { kind: 'punch', label: 'SOCAR', sub: '' };
  }

  function carBlockedPoint(x, y, ignore) {
    for (const v of vehicles) {
      if (v === ignore || v.dead || v.gone) continue;
      if (dist(x, y, v.x, v.y) < 11) return true;
    }
    return false;
  }

  function updateWalking(dt) {
    const mag = Math.hypot(input.x, input.y);
    if (mag > 0.08) {
      const speed = (input.run ? 104 : 60) * Math.min(1, mag);
      const dx = input.x * speed * dt;
      const dy = input.y * speed * dt;
      if (!blockedCircle(player.x + dx, player.y, 3) && !carBlockedPoint(player.x + dx, player.y)) player.x += dx;
      if (!blockedCircle(player.x, player.y + dy, 3) && !carBlockedPoint(player.x, player.y + dy)) player.y += dy;
      player.angle = Math.atan2(input.y, input.x);
      player.walkPhase += dt * 11;
    }
    player.x = clamp(player.x, 24, WW - 24);
    player.y = clamp(player.y, 24, WH - 24);
  }

  function carHitsWorldAt(car, x, y) {
    const hw = car.def.w / 2;
    const hl = car.def.h / 2;
    const c = Math.cos(car.angle);
    const s = Math.sin(car.angle);
    const corners = [[-hw, -hl], [hw, -hl], [hw, hl], [-hw, hl]];
    for (const p of corners) {
      const px = x + p[0] * c - p[1] * s;
      const py = y + p[0] * s + p[1] * c;
      if (solidAt(px, py)) return true;
    }
    return false;
  }

  function carHitsVehicleAt(car, x, y) {
    for (const v of vehicles) {
      if (v === car || v.dead || v.gone) continue;
      const radius = (Math.max(car.def.w, car.def.h) + Math.max(v.def.w, v.def.h)) * 0.29;
      if (dist(x, y, v.x, v.y) < radius) return v;
    }
    return null;
  }

  function moveVehicle(car, dt) {
    const ox = car.x;
    const oy = car.y;
    const speed = car.speed;
    const nx = car.x + Math.cos(car.angle) * speed * dt;
    const ny = car.y + Math.sin(car.angle) * speed * dt;
    let blocked = carHitsWorldAt(car, nx, ny);
    let other = null;
    if (!blocked) {
      other = carHitsVehicleAt(car, nx, ny);
      if (other) blocked = true;
    }
    if (blocked) {
      car.x = ox;
      car.y = oy;
      const impact = Math.abs(speed);
      car.speed *= -0.22;
      if (car === player.car) {
        if (other) {
          other.speed *= 0.4;
          other.health = Math.max(0, other.health - impact * 0.05);
        }
        if (impact > 62) {
          damageCar(car, (impact - 55) * 0.22);
          Sound.crash();
          burst(car.x + Math.cos(car.angle) * 10, car.y + Math.sin(car.angle) * 10, ['#ffd23f', '#ff8a3d', '#e8e6dc'], 5, 55);
          shake = Math.max(shake, 3);
        }
      } else if (impact > 110) {
        Sound.crash();
      }
    } else {
      car.x = nx;
      car.y = ny;
    }
    if (car === player.car) checkCarHitsPeds(car);
    if (car.x < 24 || car.y < 24 || car.x > WW - 24 || car.y > WH - 24) {
      car.x = clamp(car.x, 26, WW - 26);
      car.y = clamp(car.y, 26, WH - 26);
      car.speed *= -0.2;
    }
  }

  function updateDriving(dt) {
    const car = player.car;
    if (!car) { player.inCar = false; return; }
    const mag = Math.hypot(input.x, input.y);
    const brake = input.run;
    if (mag > 0.1) {
      const target = Math.atan2(input.y, input.x);
      const diff = angDelta(car.angle, target);
      const factor = 0.35 + 0.65 * Math.min(1, Math.abs(car.speed) / 140);
      const turn = (brake ? 3.5 : 2.65) * factor;
      car.angle += clamp(diff, -turn * dt, turn * dt);
      if (!brake) car.speed += 170 * (0.45 + 0.55 * Math.min(1, mag)) * dt;
      else car.speed -= 285 * dt;
    } else {
      car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 95 * dt);
    }
    if (brake) car.speed -= Math.sign(car.speed) * Math.min(Math.abs(car.speed), 300 * dt);
    car.speed = clamp(car.speed, -55, 205);
    moveVehicle(car, dt);
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
  }

  function enterCar(car) {
    const wasTraffic = car.role === 'traffic';
    const wasCop = car.role === 'cop';
    player.inCar = true;
    player.car = car;
    player.x = car.x;
    player.y = car.y;
    player.angle = car.angle;
    car.role = 'player';
    car.speed = 0;
    if (wasTraffic) {
      addWanted(1, 'CARJACKING');
      const side = car.angle + Math.PI / 2;
      const p = makePed(car.x + Math.cos(side) * 17, car.y + Math.sin(side) * 17);
      p.flee = 6;
      p.threatX = car.x;
      p.threatY = car.y;
      peds.push(p);
      Sound.punch();
    } else if (wasCop) {
      addWanted(1, 'VIATURA ROUBADA');
      Sound.punch();
    }
    say('DIRIJA COM O DIRECIONAL · B PARA FREAR', '#b9c6d8', 2.4);
  }

  function exitCar() {
    const car = player.car;
    if (!car) return;
    const sideX = Math.cos(car.angle + Math.PI / 2);
    const sideY = Math.sin(car.angle + Math.PI / 2);
    const spots = [
      { x: car.x + sideX * 17, y: car.y + sideY * 17 },
      { x: car.x - sideX * 17, y: car.y - sideY * 17 },
      { x: car.x - Math.cos(car.angle) * 22, y: car.y - Math.sin(car.angle) * 22 }
    ];
    let spot = spots[0];
    for (const s of spots) {
      if (!blockedCircle(s.x, s.y, 3) && !carBlockedPoint(s.x, s.y, car)) { spot = s; break; }
    }
    player.x = spot.x;
    player.y = spot.y;
    player.angle = car.angle;
    player.inCar = false;
    player.car = null;
    car.role = 'parked';
    car.speed = 0;
  }

  function findShootTarget() {
    let best = null;
    let bd = 190;
    for (const v of vehicles) {
      if (v.role !== 'cop' || v.dead || v.gone) continue;
      const d = dist(player.x, player.y, v.x, v.y);
      if (d < bd) { bd = d; best = v; }
    }
    for (const p of peds) {
      if (p.dead || p.gone) continue;
      const d = dist(player.x, player.y, p.x, p.y);
      if (d < bd * 0.72) { bd = d; best = p; }
    }
    return best;
  }

  function tryShoot() {
    if (state !== 'playing' || player.inCar || player.fireCd > 0) return;
    if (player.ammo <= 0) {
      player.fireCd = 0.5;
      say('SEM MUNIÇÃO', '#ffb36b', 1.4);
      Sound.punch();
      return;
    }
    const target = findShootTarget();
    if (target) player.angle = Math.atan2(target.y - player.y, target.x - player.x);
    const a = player.angle + rand(-0.035, 0.035);
    const mx = player.x + Math.cos(player.angle) * 7;
    const my = player.y + Math.sin(player.angle) * 7;
    bullets.push({ x: mx, y: my, vx: Math.cos(a) * 350, vy: Math.sin(a) * 350, life: 0.9, fromPlayer: true });
    player.ammo--;
    player.fireCd = 0.245;
    burst(mx, my, ['#ffe7a3', '#ffb347', '#ffffff'], 3, 45);
    Sound.gun();
    shake = Math.max(shake, 1.6);
    if (wanted === 0) addWanted(1, 'DISPAROS EM PÚBLICO');
    else escapeTimer = 0;
    for (const p of peds) {
      if (p.dead || p.gone) continue;
      if (dist(player.x, player.y, p.x, p.y) < 175) {
        p.flee = 3.2;
        p.threatX = player.x;
        p.threatY = player.y;
      }
    }
  }

  function punch() {
    if (state !== 'playing' || player.inCar || player.punchCd > 0) return;
    player.punchCd = 0.38;
    const hx = player.x + Math.cos(player.angle) * 10;
    const hy = player.y + Math.sin(player.angle) * 10;
    let hit = false;
    for (const p of peds) {
      if (p.dead || p.gone) continue;
      if (dist(hx, hy, p.x, p.y) < 14) {
        killPed(p, 'AGRESSÃO');
        hit = true;
        break;
      }
    }
    Sound.punch();
    burst(hx, hy, ['#ffffff', '#b9c6d8'], hit ? 8 : 3, 45);
    shake = Math.max(shake, hit ? 3 : 1);
  }

  function updatePlayer(dt) {
    player.fireCd = Math.max(0, player.fireCd - dt);
    player.punchCd = Math.max(0, player.punchCd - dt);
    if (player.inCar) updateDriving(dt);
    else updateWalking(dt);
    const info = getInteraction();
    if (input.actionPressed) {
      if (info.kind === 'talk') startMission(info.mission);
      else if (info.kind === 'exit') exitCar();
      else if (info.kind === 'enter') enterCar(info.car);
      else if (info.kind === 'shoot') tryShoot();
      else if (info.kind === 'punch') punch();
      input.actionPressed = false;
    } else if (input.actionHeld && !player.inCar && info.kind === 'shoot') {
      tryShoot();
    }
    if (player.inCar && player.car) {
      player.x = player.car.x;
      player.y = player.car.y;
      player.angle = player.car.angle;
    }
  }

  function startMission(m) {
    if (activeMission) {
      say('TERMINE A MISSÃO ATUAL PRIMEIRO', '#ffd23f', 2);
      return;
    }
    const rt = m.rt;
    rt.state = 'active';
    rt.stage = m.stage;
    rt.timer = m.timeLimit;
    rt.car = null;
    activeMission = m;
    if (m.id === 'bruno') {
      for (const v of vehicles) {
        if (dist(v.x, v.y, m.carSpawn.x, m.carSpawn.y) < 36) v.gone = true;
      }
      const car = createVehicle(m.carSpawn.x, m.carSpawn.y, m.carSpawn.angle, 'sports', 'mission', '#45e0d0');
      car.missionId = m.id;
      car.health = 100;
      rt.car = car;
    }
    say(m.start, m.color, 5);
    Sound.pickup();
  }

  function objectivePos(m) {
    if (m.rt.stage === 'car' && m.rt.car && !m.rt.car.dead && !m.rt.car.gone) return { x: m.rt.car.x, y: m.rt.car.y };
    if (m.rt.stage === 'pickup') return m.pickup;
    return m.dest;
  }

  function objectiveLabel(m) {
    if (m.rt.stage === 'car') return 'ROUBE O CARRO MARCADO';
    if (m.rt.stage === 'pickup') return 'PEGUE O PACOTE NO BECO';
    return m.destLabel;
  }

  function completeMission() {
    if (!activeMission) return;
    const m = activeMission;
    const rt = m.rt;
    player.cash += m.reward;
    rt.state = 'cooldown';
    rt.cooldown = 18;
    rt.stage = null;
    if (rt.car) rt.car.missionId = null;
    rt.car = null;
    activeMission = null;
    banner = { text: 'MISSÃO CUMPRIDA', sub: '+$' + m.reward, color: '#7dff9a', life: 3.2, max: 3.2 };
    say('MISSÃO CUMPRIDA · +$' + m.reward, '#7dff9a', 4);
    addFloat(player.x, player.y - 18, '+$' + m.reward, '#7dff9a');
    burst(player.x, player.y, ['#ffd23f', '#7dff9a', '#45e0d0'], 22, 90);
    Sound.mission();
  }

  function failMission(reason) {
    if (!activeMission) return;
    const rt = activeMission.rt;
    rt.state = 'cooldown';
    rt.cooldown = 10;
    rt.stage = null;
    if (rt.car && !rt.car.dead) rt.car.missionId = null;
    rt.car = null;
    activeMission = null;
    say(reason ? 'MISSÃO FALHOU · ' + reason : 'MISSÃO FALHOU', '#ff7a7a', 3.5);
    Sound.fail();
  }

  function updateMissions(dt) {
    for (const m of missions) {
      if (m.rt.state === 'cooldown') {
        m.rt.cooldown -= dt;
        if (m.rt.cooldown <= 0) m.rt.state = 'idle';
      }
    }
    if (!activeMission) return;
    const m = activeMission;
    const rt = m.rt;
    if (rt.timer > 0) {
      rt.timer -= dt;
      if (rt.timer <= 0) { failMission('TEMPO ESGOTADO'); return; }
    }
    if (rt.stage === 'car') {
      if (!rt.car || rt.car.dead || rt.car.gone) { failMission('O CARRO FOI DESTRUÍDO'); return; }
      if (player.inCar && player.car === rt.car) {
        rt.stage = 'dest';
        say("BRUNO: Agora leva pro Pay'n'Spray!", m.color, 4);
        Sound.pickup();
      }
      return;
    }
    if (rt.stage === 'pickup') {
      if (dist(player.x, player.y, m.pickup.x, m.pickup.y) < 22) {
        rt.stage = 'dest';
        addWanted(2, 'PACOTE ROUBADO');
        burst(m.pickup.x, m.pickup.y, ['#ffd23f', '#45e0d0'], 14, 70);
        Sound.pickup();
        say('JACOB: Trouxe? Corre pro bar!', m.color, 4);
      }
      return;
    }
    if (dist(player.x, player.y, m.dest.x, m.dest.y) < 22) {
      if (m.id === 'bruno' && !(player.inCar && player.car === rt.car)) {
        if (hintTimer <= 0) {
          say('ENTREGUE DIRIGINDO O CARRO MARCADO', '#ffd23f', 2.5);
          hintTimer = 3;
        }
        return;
      }
      completeMission();
    }
  }

  function damageCar(car, amount) {
    if (!car || car.dead) return;
    car.health -= amount;
    if (car.health <= 0) explodeCar(car, true);
  }

  function bakeScorch(x, y) {
    mctx.save();
    mctx.globalAlpha = 0.55;
    mctx.fillStyle = '#0a0b0d';
    mctx.beginPath();
    mctx.ellipse(x, y, 14, 9, 0, 0, TAU);
    mctx.fill();
    mctx.globalAlpha = 0.3;
    mctx.fillStyle = '#15171b';
    mctx.beginPath();
    mctx.ellipse(x + 3, y - 4, 9, 6, 0, 0, TAU);
    mctx.fill();
    mctx.restore();
  }

  function bakeCorpse(x, y) {
    mctx.save();
    mctx.globalAlpha = 0.65;
    mctx.fillStyle = '#6e1418';
    mctx.beginPath();
    mctx.ellipse(x + 2, y + 3, 8, 4, 0.4, 0, TAU);
    mctx.fill();
    mctx.globalAlpha = 0.9;
    mctx.fillStyle = '#2a1012';
    mctx.fillRect(x - 5, y - 2, 10, 4);
    mctx.fillStyle = '#8b5a3c';
    mctx.fillRect(x + 4, y - 3, 3, 3);
    mctx.restore();
  }

  function explodeCar(car, byPlayer) {
    if (car.dead) return;
    car.dead = true;
    const x = car.x;
    const y = car.y;
    bakeScorch(x, y);
    rings.push({ x, y, r: 5, max: 42, life: 0.45, maxLife: 0.45, color: '#ffb347' });
    burst(x, y, ['#ffd23f', '#ff8a3d', '#ff4b4b', '#e8e6dc'], 30, 130);
    for (let i = 0; i < 8; i++) {
      particles.push({
        x, y, vx: rand(-40, 40), vy: rand(-40, 40), life: rand(0.5, 1.1), max: 1.1,
        size: rand(2, 4), color: '#3a3f47', gravity: -5
      });
    }
    Sound.explode();
    shake = Math.max(shake, 8);
    flash = Math.max(flash, 0.4);
    if (car === player.car) {
      player.inCar = false;
      player.car = null;
      player.x = clamp(x + rand(-20, 20), 30, WW - 30);
      player.y = clamp(y + rand(-20, 20), 30, WH - 30);
      damagePlayer(24);
    }
    if (byPlayer) addWanted(1, 'CARRO DESTRUÍDO');
    if (activeMission && activeMission.rt.car === car) failMission('O CARRO EXPLODIU');
  }

  function damagePlayer(amount) {
    if (state !== 'playing') return;
    if (player.armor > 0) {
      player.armor -= amount;
      if (player.armor < 0) {
        player.health += player.armor;
        player.armor = 0;
      }
    } else {
      player.health -= amount;
    }
    player.lastDamage = 0;
    flash = Math.max(flash, 0.55);
    shake = Math.max(shake, 4);
    Sound.hit();
    if (player.health <= 0) {
      player.health = 0;
      die();
    }
  }

  function die() {
    if (state !== 'playing') return;
    state = 'dead';
    player.inCar = false;
    player.car = null;
    player.health = 0;
    if (activeMission) failMission('VOCÊ MORREU');
    wanted = 0;
    disperseCops();
    resetTouch();
    $('#touch').classList.add('hidden');
    $('#topbar').classList.add('hidden');
    showScreen('dead');
    Sound.update(0, false);
  }

  function respawn() {
    player.cash = Math.max(0, player.cash - 100);
    player.health = 100;
    player.armor = 0;
    player.ammo = Math.max(8, player.ammo);
    player.x = HOSPITAL.x;
    player.y = HOSPITAL.y;
    player.inCar = false;
    player.car = null;
    player.angle = 0;
    player.fireCd = 0;
    player.punchCd = 0;
    wanted = 0;
    wantedFlash = 0;
    escapeTimer = 0;
    disperseCops();
    camera.x = clamp(player.x, W / 2, WW - W / 2);
    camera.y = clamp(player.y, H / 2, WH - H / 2);
    state = 'playing';
    notices = [];
    showScreen(null);
    $('#touch').classList.remove('hidden');
    $('#topbar').classList.remove('hidden');
    say('DE VOLTA ÀS RUAS · -$100', '#ffb36b', 3);
    resetTouch();
  }

  function checkCarHitsPeds(car) {
    if (Math.abs(car.speed) < 40) return;
    for (const p of peds) {
      if (p.dead || p.gone) continue;
      if (dist(car.x, car.y, p.x, p.y) < 15) {
        killPed(p, 'ATROPELAMENTO');
        car.speed *= 0.72;
        shake = Math.max(shake, 5);
      }
    }
  }

  function killPed(p, reason) {
    if (p.dead) return;
    p.dead = true;
    bakeCorpse(p.x, p.y);
    burst(p.x, p.y, ['#b71c24', '#7a1016', '#e8e6dc'], 12, 75);
    Sound.hit();
    shake = Math.max(shake, 4);
    addWanted(2, reason || 'ASSASSINATO');
    for (const q of peds) {
      if (q === p || q.dead || q.gone) continue;
      if (dist(p.x, p.y, q.x, q.y) < 120) {
        q.flee = 4;
        q.threatX = p.x;
        q.threatY = p.y;
      }
    }
  }

  function pickPedTarget(p) {
    for (let i = 0; i < 14; i++) {
      const a = rand(0, TAU);
      const r = rand(18, 78);
      const x = p.x + Math.cos(a) * r;
      const y = p.y + Math.sin(a) * r;
      if (x < 30 || y < 30 || x > WW - 30 || y > WH - 30) continue;
      if (!walkableTile(Math.floor(x / TILE), Math.floor(y / TILE))) continue;
      if (blockedCircle(x, y, 3)) continue;
      p.tx = x;
      p.ty = y;
      p.timer = rand(2.2, 5.2);
      return;
    }
    p.timer = 1.4;
  }

  function updatePeds(dt) {
    const focus = focusPoint();
    for (const p of peds) {
      if (p.dead || p.gone) continue;
      if (dist(p.x, p.y, focus.x, focus.y) > 820) { p.gone = true; continue; }
      p.flee = Math.max(0, p.flee - dt);
      let ax = 0;
      let ay = 0;
      let speed = p.speed;
      if (p.flee > 0) {
        ax = p.x - p.threatX;
        ay = p.y - p.threatY;
        speed = 62;
        if (Math.abs(ax) + Math.abs(ay) < 0.5) {
          const a = rand(0, TAU);
          ax = Math.cos(a);
          ay = Math.sin(a);
        }
      } else {
        p.timer -= dt;
        if (p.timer <= 0 || dist(p.x, p.y, p.tx, p.ty) < 5) pickPedTarget(p);
        ax = p.tx - p.x;
        ay = p.ty - p.y;
      }
      const len = Math.hypot(ax, ay);
      p.moving = len > 1;
      if (len > 1) {
        const dx = ax / len * speed * dt;
        const dy = ay / len * speed * dt;
        if (!blockedCircle(p.x + dx, p.y, 3)) p.x += dx;
        else p.timer = 0;
        if (!blockedCircle(p.x, p.y + dy, 3)) p.y += dy;
        else p.timer = 0;
        p.angle = Math.atan2(ay, ax);
        p.phase += dt * 10;
      }
      if (p.flee <= 0) {
        for (const v of vehicles) {
          if (v.dead || v.gone) continue;
          if (v.role !== 'traffic' && v.role !== 'cop' && v !== player.car) continue;
          if (Math.abs(v.speed) > 45 && dist(v.x, v.y, p.x, p.y) < 32) {
            p.flee = 2.2;
            p.threatX = v.x;
            p.threatY = v.y;
            break;
          }
        }
      }
      p.x = clamp(p.x, 24, WW - 24);
      p.y = clamp(p.y, 24, WH - 24);
    }
  }

  function updateTraffic(dt) {
    const focus = focusPoint();
    for (const v of vehicles) {
      if (v.role !== 'traffic' || v.dead || v.gone) continue;
      if (dist(v.x, v.y, focus.x, focus.y) > 700) { v.gone = true; continue; }
      const hx = Math.cos(v.angle);
      const hy = Math.sin(v.angle);
      let target = v.baseSpeed;
      for (const o of vehicles) {
        if (o === v || o.dead || o.gone) continue;
        const dx = o.x - v.x;
        const dy = o.y - v.y;
        const d = Math.hypot(dx, dy);
        if (d < 44 && dx * hx + dy * hy > 0) { target = 0; break; }
      }
      v.speed += clamp(target - v.speed, -180 * dt, 85 * dt);
      const ox = v.x;
      const oy = v.y;
      v.x += hx * v.speed * dt;
      v.y += hy * v.speed * dt;
      if (carHitsWorldAt(v, v.x, v.y)) {
        v.x = ox;
        v.y = oy;
        v.gone = true;
      }
    }
  }

  function spawnCopNear() {
    const focus = focusPoint();
    for (let attempt = 0; attempt < 90; attempt++) {
      const tx = 4 + Math.floor(Math.random() * (MW - 8));
      const ty = 4 + Math.floor(Math.random() * (MH - 8));
      if (tiles[tileIndex(tx, ty)] !== T.ROAD) continue;
      const x = (tx + 0.5) * TILE;
      const y = (ty + 0.5) * TILE;
      const d = dist(x, y, focus.x, focus.y);
      if (d < 240 || d > 430) continue;
      if (!freeSpot(x, y, 30)) continue;
      const car = createVehicle(x, y, Math.atan2(focus.y - y, focus.x - x), 'cop', 'cop', '#2b3446');
      car.speed = 0;
      car.fireCd = rand(0.8, 1.6);
      return car;
    }
    return null;
  }

  function respawnCop(car) {
    const focus = focusPoint();
    for (let attempt = 0; attempt < 50; attempt++) {
      const a = rand(0, TAU);
      const r = rand(250, 360);
      const x = clamp(focus.x + Math.cos(a) * r, 40, WW - 40);
      const y = clamp(focus.y + Math.sin(a) * r, 40, WH - 40);
      if (!roadAt(x, y)) continue;
      if (solidAt(x, y)) continue;
      if (!freeSpot(x, y, 26)) continue;
      car.x = x;
      car.y = y;
      car.angle = Math.atan2(focus.y - y, focus.x - x);
      car.speed = 0;
      car.stuck = 0;
      return;
    }
    car.stuck = 0;
  }

  function updateCops(dt) {
    const focus = focusPoint();
    for (const v of vehicles) {
      if (v.role !== 'cop' || v.dead || v.gone) continue;
      const d = dist(v.x, v.y, focus.x, focus.y);
      if (d > 850) { v.gone = true; continue; }
      const target = Math.atan2(focus.y - v.y, focus.x - v.x);
      const diff = angDelta(v.angle, target);
      v.angle += clamp(diff, -2.45 * dt, 2.45 * dt);
      const desired = d > 95 ? 198 : 55;
      v.speed += clamp(desired - v.speed, -215 * dt, 150 * dt);
      moveVehicle(v, dt);
      if (Math.abs(v.speed) < 12 && d > 55) v.stuck += dt;
      else v.stuck = Math.max(0, v.stuck - dt * 1.5);
      if (v.stuck > 1.3) respawnCop(v);
      if (d < 190 && wanted >= 2) {
        v.fireCd -= dt;
        if (v.fireCd <= 0) {
          const a = Math.atan2(focus.y - v.y, focus.x - v.x) + rand(-0.16, 0.16);
          bullets.push({
            x: v.x + Math.cos(a) * 12, y: v.y + Math.sin(a) * 12,
            vx: Math.cos(a) * 300, vy: Math.sin(a) * 300, life: 1.4, cop: true
          });
          burst(v.x + Math.cos(a) * 12, v.y + Math.sin(a) * 12, ['#ffe7a3', '#ffb347'], 2, 35);
          Sound.gun();
          v.fireCd = rand(1.05, 1.75);
        }
      }
    }
  }

  function updateWanted(dt) {
    wantedFlash = Math.max(0, wantedFlash - dt * 1.6);
    if (wanted <= 0) {
      escapeTimer = 0;
      return;
    }
    if (nearestCopDist() > 300) {
      escapeTimer += dt;
      if (escapeTimer > 8) {
        wanted--;
        wantedFlash = 1;
        escapeTimer = 0;
        if (wanted === 0) {
          disperseCops();
          say('VOCÊ DESPISTOU A POLÍCIA', '#7dff9a', 3);
        } else {
          say('NÍVEL DE PROCURA BAIXOU', '#ffd23f', 2);
        }
      }
    } else {
      escapeTimer = Math.max(0, escapeTimer - dt * 0.7);
    }
    copSpawnTimer -= dt;
    let cops = 0;
    for (const v of vehicles) if (v.role === 'cop' && !v.dead && !v.gone) cops++;
    if (cops < Math.min(wanted, 4) && copSpawnTimer <= 0) {
      spawnCopNear();
      copSpawnTimer = 1.5;
    }
  }

  function updateBullets(dt) {
    for (const b of bullets) {
      if (b.dead) continue;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < 0 || b.y < 0 || b.x > WW || b.y > WH) { b.dead = true; continue; }
      if (solidAt(b.x, b.y)) {
        b.dead = true;
        burst(b.x, b.y, ['#ffffff', '#ffd23f'], 2, 28);
        continue;
      }
      if (b.fromPlayer) {
        for (const v of vehicles) {
          if (v.dead || v.gone || v === player.car) continue;
          if (dist(b.x, b.y, v.x, v.y) < 13) {
            damageCar(v, 20);
            b.dead = true;
            burst(b.x, b.y, ['#ffd23f', '#ff8a3d'], 4, 45);
            break;
          }
        }
        if (b.dead) continue;
        for (const p of peds) {
          if (p.dead || p.gone) continue;
          if (dist(b.x, b.y, p.x, p.y) < 8) {
            killPed(p, 'TIRO');
            b.dead = true;
            break;
          }
        }
      } else {
        if (player.inCar && player.car && !player.car.dead) {
          if (dist(b.x, b.y, player.car.x, player.car.y) < 15) {
            b.dead = true;
            damageCar(player.car, 7);
            if (Math.random() < 0.5) damagePlayer(2);
          }
        } else if (dist(b.x, b.y, player.x, player.y) < 7) {
          b.dead = true;
          damagePlayer(7);
        }
      }
    }
    bullets = bullets.filter((b) => !b.dead);
  }

  function updateEffects(dt) {
    for (const p of particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.98;
      p.vy = p.vy * 0.98 + (p.gravity || 0) * dt;
    }
    particles = particles.filter((p) => p.life > 0);
    for (const r of rings) {
      r.life -= dt;
      r.r += (r.max - r.r) * dt * 8;
    }
    rings = rings.filter((r) => r.life > 0);
    for (const f of floaters) {
      f.life -= dt;
      f.y -= 22 * dt;
    }
    floaters = floaters.filter((f) => f.life > 0);
    if (banner) {
      banner.life -= dt;
      if (banner.life <= 0) banner = null;
    }
    for (const n of notices) n.life -= dt;
    notices = notices.filter((n) => n.life > 0);
    flash = Math.max(0, flash - dt * 2.6);
    shake = Math.max(0, shake - dt * 15);
    hintTimer = Math.max(0, hintTimer - dt);
    sprayCd = Math.max(0, sprayCd - dt);
    playerHitCd = Math.max(0, playerHitCd - dt);
  }

  function updatePickups(dt) {
    for (const pk of pickups) {
      if (!pk.active) {
        pk.timer -= dt;
        if (pk.timer <= 0) pk.active = true;
        continue;
      }
      if (dist(player.x, player.y, pk.x, pk.y) > 14) continue;
      pk.active = false;
      pk.timer = 28;
      if (pk.type === 'health') {
        player.health = Math.min(100, player.health + 35);
        say('VIDA +35', '#7dff9a', 1.8);
        addFloat(pk.x, pk.y - 10, '+35 VIDA', '#7dff9a');
      } else if (pk.type === 'armor') {
        player.armor = Math.min(100, player.armor + 50);
        say('COLETE +50', '#45e0d0', 1.8);
        addFloat(pk.x, pk.y - 10, '+50 COLETE', '#45e0d0');
      } else if (pk.type === 'ammo') {
        player.ammo = Math.min(99, player.ammo + 12);
        say('MUNIÇÃO +12', '#ffd23f', 1.8);
        addFloat(pk.x, pk.y - 10, '+12 MUNIÇÃO', '#ffd23f');
      } else {
        player.cash += 50;
        addFloat(pk.x, pk.y - 10, '+$50', '#7dff9a');
        Sound.cash();
      }
      if (pk.type !== 'cash') Sound.pickup();
      burst(pk.x, pk.y, ['#7dff9a', '#45e0d0', '#ffd23f'], 8, 55);
    }
  }

  function updatePayNSpray(dt) {
    if (!player.inCar || !player.car || wanted <= 0 || sprayCd > 0) return;
    if (dist(player.car.x, player.car.y, SPRAY.x, SPRAY.y) > 32) return;
    if (Math.abs(player.car.speed) > 130) return;
    if (player.cash >= 100) {
      player.cash -= 100;
      wanted = 0;
      wantedFlash = 0;
      escapeTimer = 0;
      disperseCops();
      player.car.health = 100;
      sprayCd = 9;
      say("PAY'N'SPRAY · FICHA LIMPA · -$100", '#45e0d0', 3.5);
      burst(player.car.x, player.car.y, ['#45e0d0', '#7dff9a', '#eafffb'], 18, 70);
      Sound.cash();
    } else {
      sprayCd = 4;
      say("PAY'N'SPRAY · PRECISA DE $100", '#ffb36b', 2.6);
    }
  }

  function checkCarsHitPlayer() {
    if (state !== 'playing' || player.inCar || playerHitCd > 0) return;
    for (const v of vehicles) {
      if (v.dead || v.gone) continue;
      if (v.role !== 'traffic' && v.role !== 'cop') continue;
      if (Math.abs(v.speed) < 40) continue;
      if (dist(v.x, v.y, player.x, player.y) < 13) {
        damagePlayer(14);
        playerHitCd = 1.3;
        const a = Math.atan2(player.y - v.y, player.x - v.x);
        const nx = player.x + Math.cos(a) * 20;
        const ny = player.y + Math.sin(a) * 20;
        if (!blockedCircle(nx, ny, 3)) { player.x = nx; player.y = ny; }
        shake = Math.max(shake, 6);
        Sound.crash();
        break;
      }
    }
  }

  function updateCamera(dt) {
    const target = focusPoint();
    const tx = clamp(target.x, W / 2, WW - W / 2);
    const ty = clamp(target.y, H / 2, WH - H / 2);
    camera.x = lerp(camera.x, tx, 1 - Math.exp(-7 * dt));
    camera.y = lerp(camera.y, ty, 1 - Math.exp(-7 * dt));
  }

  function updateCameraMenu(dt) {
    menuT += dt;
    const tx = clamp(WW / 2 + Math.cos(menuT * 0.075) * 430, W / 2, WW - W / 2);
    const ty = clamp(WH / 2 + Math.sin(menuT * 0.052) * 360, H / 2, WH - H / 2);
    camera.x = lerp(camera.x, tx, 1 - Math.exp(-1.1 * dt));
    camera.y = lerp(camera.y, ty, 1 - Math.exp(-1.1 * dt));
  }

  function updateAmbient(dt) {
    time += dt;
    updatePeds(dt);
    updateTraffic(dt);
    updateEffects(dt);
    ambientTimer -= dt;
    if (ambientTimer <= 0) {
      ambientTimer = 0.9;
      ensurePeds();
      ensureTraffic();
    }
    peds = peds.filter((p) => !p.gone && !p.dead);
    vehicles = vehicles.filter((v) => !v.gone && !v.dead);
  }

  function updateGame(dt) {
    time += dt;
    player.lastDamage += dt;
    readInput();
    updatePlayer(dt);
    updateMissions(dt);
    updatePeds(dt);
    updateTraffic(dt);
    updateCops(dt);
    updateWanted(dt);
    updateBullets(dt);
    updateEffects(dt);
    updatePickups(dt);
    updatePayNSpray(dt);
    checkCarsHitPlayer();
    ambientTimer -= dt;
    if (ambientTimer <= 0) {
      ambientTimer = 0.9;
      ensurePeds();
      ensureTraffic();
    }
    updateCamera(dt);
    if (player.lastDamage > 14 && player.health > 0 && player.health < 65) {
      player.health = Math.min(65, player.health + dt * 2.5);
    }
    peds = peds.filter((p) => !p.gone && !p.dead);
    vehicles = vehicles.filter((v) => !v.gone && !v.dead);
  }

  /*__PART7__*/
})();
