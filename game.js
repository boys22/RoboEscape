/* RoboEscape 게임 코드 (원본). 배포용은 game.min.js */
(() => {
"use strict";
// ================= 기본 설정 =================
const W = 960, H = 640, WALL = 40;
const RX0 = WALL, RY0 = WALL, RX1 = W - WALL, RY1 = H - WALL;
const DOOR_W = 84;
// 3/4 시점 투영: 로직은 평면(x, y), 화면 y = OY + y*SY - 높이(z)
const SY = 0.78, OY = 96, WALL_H = 56, BOX_H = 34;
const syf = (y, z = 0) => OY + y * SY - z;
const C = {
  floor: "#1a1d21", tile: "#22262b", wall: "#2a2f35", wallHi: "#3a4048", hazard: "#f2c230", hazardDark: "#1b1d20",
  crate: "#5a4636", crateHi: "#7a5e45", crateLine: "#3a2d22",
  body: "#c9d3dc", bodyDark: "#59636e", visor: "#3ee0d0", swing: "#bff7f1",
  spark: "#e0662a", sparkDark: "#7a2e10", eye: "#ffd23f", turret: "#8a7a62", turretDark: "#4a4034",
  bolt: "#ffd23f", danger: "#ff4b3a", good: "#59e39a", text: "#e4e8ec", muted: "#8b949e",
};
const cv = document.getElementById("cv");
const ctx = cv.getContext("2d");
const $ = (id) => document.getElementById(id);

// ================= 데일리 시드 =================
// 판마다 새 시드 (맵·문·보상 후보가 매번 달라짐)
let runSeed = "";
function newSeed() { runSeed = Math.floor(Math.random() * 36 ** 6).toString(36).padStart(6, "0"); $("seedLabel").textContent = runSeed; }
newSeed();
function hashStr(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
let mapRng = Math.random; // 방 구조·스폰 위치 전용 (오늘 날짜 + 방 번호)
function roomRng(n) { mapRng = mulberry32(hashStr(runSeed + "#room" + n)); }

// ================= 캔버스 크기 =================
function fitCanvas() {
  const r = cv.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const scale = (r.width / W) * dpr;
  cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
}
new ResizeObserver(fitCanvas).observe(cv);

// ================= 사운드 (WebAudio 합성) =================
let AC = null, master = null, noiseBuf = null, muted = false;
function initAudio() {
  if (AC) { if (AC.state === "suspended") AC.resume(); return; }
  try {
    AC = new (window.AudioContext || window.webkitAudioContext)();
    master = AC.createGain(); master.gain.value = muted ? 0 : 0.45; master.connect(AC.destination);
    sfxBus = AC.createGain(); sfxBus.gain.value = SET.sfx; sfxBus.connect(master);
    musBus = AC.createGain(); musBus.gain.value = 0; musBus.connect(master);
    noiseBuf = AC.createBuffer(1, AC.sampleRate, AC.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch (e) { AC = null; }
}
function tone(type, f0, f1, dur, vol, delay = 0) {
  const t = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(sfxBus); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol, ftype, f0, f1, q = 1) {
  const t = AC.currentTime, s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = ftype; f.Q.value = q;
  f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(sfxBus); s.start(t); s.stop(t + dur + 0.02);
}
function sfx(n) {
  if (!AC || muted) return;
  switch (n) {
    case "grind": tone("sawtooth", 70, 40, 0.5, 0.09); noise(0.45, 0.12, "lowpass", 500, 180); break;
    case "roar": tone("sawtooth", 95, 30, 0.9, 0.14); tone("square", 60, 25, 0.9, 0.08); noise(0.8, 0.16, "bandpass", 320, 110, 0.6); break;
    case "swing": noise(0.09, 0.12, "bandpass", 700, 2800, 1.4); break;
    case "hit": tone("square", 230, 70, 0.08, 0.1); noise(0.05, 0.14, "highpass", 2200, 4200); break;
    case "heavy": tone("square", 150, 40, 0.15, 0.16); noise(0.14, 0.2, "bandpass", 1600, 260, 0.8); break;
    case "dash": tone("sine", 720, 180, 0.12, 0.07); noise(0.1, 0.05, "highpass", 3000, 900); break;
    case "shoot": tone("square", 900, 340, 0.07, 0.045); break;
    case "explode": noise(0.42, 0.28, "lowpass", 2200, 70, 0.7); tone("sine", 95, 30, 0.32, 0.22); break;
    case "hurt": tone("sawtooth", 230, 65, 0.24, 0.14); noise(0.15, 0.12, "lowpass", 1200, 200); break;
    case "spawn": tone("sine", 280, 880, 0.16, 0.04); break;
    case "windup": tone("triangle", 180, 760, 0.5, 0.045); break;
    case "door": tone("square", 440, 440, 0.1, 0.06); tone("square", 660, 660, 0.18, 0.06, 0.11); break;
    case "throw": noise(0.3, 0.07, "bandpass", 500, 1800, 2); break;
    case "catch": tone("square", 520, 760, 0.05, 0.05); break;
    case "clank": tone("square", 320, 110, 0.07, 0.07); noise(0.05, 0.08, "highpass", 2500, 3500); break;
    case "parry": tone("triangle", 1200, 1700, 0.06, 0.06); break;
    case "jump": tone("sine", 260, 620, 0.12, 0.06); noise(0.08, 0.04, "highpass", 2000, 4000); break;
    case "step": tone("sine", 110, 60, 0.07, 0.08); break;
    case "slam": tone("square", 110, 30, 0.25, 0.2); noise(0.35, 0.3, "lowpass", 2500, 60, 0.6); break;
    case "zap": tone("sawtooth", 1400, 300, 0.09, 0.04); noise(0.08, 0.06, "highpass", 3000, 6000); break;
    case "pull": tone("sine", 200, 520, 0.18, 0.06); break;
    case "pickup": tone("triangle", 660, 990, 0.12, 0.07); tone("triangle", 990, 1320, 0.15, 0.06, 0.1); break;
    case "choose": tone("square", 520, 520, 0.06, 0.05); tone("square", 780, 780, 0.12, 0.05, 0.07); break;
    case "rivet": tone("square", 1500, 600, 0.04, 0.03); noise(0.03, 0.05, "highpass", 3000, 5000); break;
    case "tick": tone("square", 900, 500, 0.03, 0.025); break;
    case "shotgun": noise(0.2, 0.25, "lowpass", 3000, 200, 0.7); tone("square", 200, 60, 0.15, 0.12); break;
    case "flame": noise(0.12, 0.05, "bandpass", 500, 900, 0.8); break;
    case "ignite": noise(0.3, 0.15, "lowpass", 1800, 300); tone("sine", 160, 80, 0.25, 0.08); break;
    case "overheat": tone("sawtooth", 320, 140, 0.35, 0.09); noise(0.3, 0.08, "highpass", 2000, 600); break;
    case "revive": tone("sine", 200, 900, 0.5, 0.12); tone("triangle", 400, 1600, 0.4, 0.06, 0.1); break;
    case "heal": tone("sine", 660, 990, 0.1, 0.05); break;
    case "land": tone("sine", 140, 45, 0.14, 0.14); noise(0.1, 0.08, "lowpass", 900, 150); break;
    case "lose": tone("square", 392, 380, 0.22, 0.06); tone("square", 330, 320, 0.22, 0.06, 0.22); tone("square", 262, 250, 0.22, 0.06, 0.44); tone("sawtooth", 196, 60, 0.9, 0.08, 0.66); break;
    case "copy": tone("triangle", 880, 880, 0.06, 0.05); tone("triangle", 1320, 1320, 0.1, 0.05, 0.06); break;
  }
}
// ================= 설정 · 배경음 =================
const SET = { sfx: 0.8, mus: 0.6, vib: true };
try { const s = JSON.parse(localStorage.getItem("re-settings") || "null"); if (s) Object.assign(SET, s); } catch (e) {}
function saveSettings() { try { localStorage.setItem("re-settings", JSON.stringify(SET)); } catch (e) {} }
let sfxBus = null, musBus = null;
function applyVolumes() {
  if (!AC) return;
  const t = AC.currentTime;
  master.gain.setTargetAtTime(muted ? 0 : 0.45, t, 0.03);
  sfxBus.gain.setTargetAtTime(SET.sfx, t, 0.03);
  musBus.gain.setTargetAtTime(SET.mus * 0.55 * (MUS.duck ? 0.35 : 1), t, 0.15);
}
// 곡: 16스텝(16분음표) × 4마디 반복. 숫자는 근음 기준 반음, 코드톤 표기는 아래 CH
const CH = { m: [0, 3, 7, 10, 12, 15, 19, 22], M: [0, 4, 7, 11, 12, 16, 19, 23] };
const TRACKS = {
  title: { bpm: 84, root: 45, q: "m", prog: [0, -4, -2, -5], bass: "x.......x.......", arp: "0.2.4.2.5.4.2.4.", lead: "triangle", lv: 0.05, pad: 0.03, k: "x.......x.......", s: "", h: "....x.......x...", cut: 900 },
  z1: { bpm: 104, root: 45, q: "m", prog: [0, 0, -2, -5], bass: "x..x..x.x..x.o..", arp: "0..2..4.3..2..1.", lead: "square", lv: 0.022, pad: 0.025, k: "x...x...x...x..x", s: "....x.......x...", h: "..x...x...x...x.", cut: 700 },
  z2: { bpm: 118, root: 50, q: "m", prog: [0, 3, 5, 3], bass: "x.x.x.o.x.x.x.f.", arp: "024.024.024.0246", lead: "square", lv: 0.02, pad: 0.02, k: "x...x...x...x...", s: "....x.......x..x", h: "x.xxx.xxx.xxx.xx", cut: 1100 },
  z3: { bpm: 96, root: 52, q: "m", prog: [0, 1, 0, -2], bass: "x.......x...o...", arp: "0...4...2...6...", lead: "sine", lv: 0.06, pad: 0.035, k: "x.......x.....x.", s: "............x...", h: "x...x...x...x...", cut: 600 },
  boss1: { bpm: 132, root: 45, q: "m", prog: [0, 0, 1, -2], bass: "xxo.xxo.xxo.xof.", arp: "0.0.3.0.5.0.3.2.", lead: "sawtooth", lv: 0.018, pad: 0, k: "x.x.x.x.x.x.x.x.", s: "....x.......x.x.", h: "xxxxxxxxxxxxxxxx", cut: 1400 },
  boss2: { bpm: 140, root: 50, q: "m", prog: [0, 1, 3, 1], bass: "x.xox.xox.xox.of", arp: "02460246", lead: "square", lv: 0.02, pad: 0, k: "x..xx..xx..xx.x.", s: "....x.......x...", h: "x.x.x.x.x.x.x.x.", cut: 1500 },
  boss3: { bpm: 148, root: 52, q: "m", prog: [0, 1, -2, -1], bass: "xoxoxoxoxoxoxofo", arp: "0246420264206420", lead: "sawtooth", lv: 0.016, pad: 0.02, k: "x...x..xx...x..x", s: "....x.......x.xx", h: "xxxxxxxxxxxxxxxx", cut: 1800 },
  ending: { bpm: 88, root: 48, q: "M", prog: [0, 5, -3, 7], bass: "x.......x...f...", arp: "0.2.4.6.4.2.4.6.", lead: "triangle", lv: 0.06, pad: 0.04, k: "x.......x.......", s: "....x.......x...", h: "..x...x...x...x.", cut: 1200 },
};
const MUS = { cur: null, next: 0, step: 0, timer: 0, duck: false, gen: 0 };
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
function mNote(type, f, t, dur, vol, cut) {
  const o = AC.createOscillator(), g = AC.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  if (cut) { const fl = AC.createBiquadFilter(); fl.type = "lowpass"; fl.frequency.value = cut; o.connect(fl); fl.connect(g); } else o.connect(g);
  g.connect(musBus); o.start(t); o.stop(t + dur + 0.03);
}
function mNoise(t, dur, vol, ftype, freq) {
  const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
  s.buffer = noiseBuf; f.type = ftype; f.frequency.value = freq;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(musBus); s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
}
function mKick(t) { const o = AC.createOscillator(), g = AC.createGain(); o.frequency.setValueAtTime(130, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.16); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2); o.connect(g); g.connect(musBus); o.start(t); o.stop(t + 0.22); }
function musicStep(tr, step, t) {
  const sl = 60 / tr.bpm / 4, bar = Math.floor(step / 16) % 4, i = step % 16, root = tr.root + tr.prog[bar], ch = CH[tr.q];
  const b = tr.bass[i];
  if (b && b !== ".") mNote("sawtooth", mtof(root - 12 + (b === "o" ? 12 : b === "f" ? 7 : 0)), t, sl * 1.8, 0.11, tr.cut);
  const a = tr.arp[i % tr.arp.length];
  if (a && a !== ".") mNote(tr.lead, mtof(root + 12 + ch[+a]), t, sl * 1.6, tr.lv, 0);
  if (tr.pad && i === 0) for (const d of [0, 2, 4]) mNote("triangle", mtof(root + ch[d]), t, sl * 15, tr.pad, 1600);
  if (tr.k[i] === "x") mKick(t);
  if (tr.s && tr.s[i] === "x") { mNoise(t, 0.13, 0.16, "bandpass", 1900); mNote("triangle", 190, t, 0.08, 0.06, 0); }
  if (tr.h && tr.h[i] === "x") mNoise(t, 0.035, 0.05, "highpass", 7500);
}
function musicTick() {
  if (!AC || !MUS.cur) return;
  const tr = TRACKS[MUS.cur], sl = 60 / tr.bpm / 4;
  if (MUS.next < AC.currentTime) MUS.next = AC.currentTime + 0.05;
  while (MUS.next < AC.currentTime + 0.2) { musicStep(tr, MUS.step, MUS.next); MUS.next += sl; MUS.step = (MUS.step + 1) % 64; }
}
function playMusic(name) {
  if (MUS.cur === name) return;
  MUS.cur = name; MUS.step = 0; if (AC) MUS.next = AC.currentTime + 0.1;
}
// 상황에 맞는 곡 고르기 (매 프레임)
function musicFor() {
  if (state === "title") return "title";
  if (state === "ending") return "ending";
  if (state === "dead") return run && run.won ? "ending" : null;
  if (!room) return null;
  const z = curZone(), b = room.boss;
  if (room.kind === "boss" && room.bossSpawned && b && !b.dead) return "boss" + z;
  return "z" + z;
}
function musicUpdate() {
  if (!AC) return;
  const want = musicFor();
  MUS.duck = state === "pause" || state === "choice";
  if (want !== MUS.cur) { if (want) playMusic(want); else MUS.cur = null; }
  applyVolumes();
  musicTick();
}
// 첫 터치·키 입력에서 소리 켜기 (브라우저 자동 재생 정책)
function unlockAudio() { initAudio(); window.removeEventListener("pointerdown", unlockAudio); window.removeEventListener("keydown", unlockAudio); }
window.addEventListener("pointerdown", unlockAudio); window.addEventListener("keydown", unlockAudio);

// ================= 입력 =================
// PC: 키보드(+마우스 버튼 보조), 모바일: 화면 조이스틱과 버튼. 조준은 둘 다 자동.
const keys = new Set();
const input = { atkP: false, jumpP: false, throwP: false, dashP: false, mouseL: false };
let touchMode = matchMedia("(pointer: coarse)").matches;
const ATK_KEYS = ["KeyJ", "KeyZ"], JUMP_KEYS = ["KeyK", "KeyX"], THROW_KEYS = ["KeyL", "KeyC"], DASH_KEYS = ["Space", "ShiftLeft", "ShiftRight"];
window.addEventListener("keydown", (e) => {
  if (e.target && e.target.tagName === "INPUT" && e.target.type === "text") { if (e.code === "Enter" && e.target.id === "lbName") lbSubmit(); return; } // 닉네임 입력 중엔 게임 키 무시
  if (!$("ovRank").hidden) { if (e.code === "Escape") lbClose(); return; }
  if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.code) && state !== "title") e.preventDefault();
  if (e.repeat) return;
  touchMode = false;
  keys.add(e.code);
  if (e.code === "Escape" || e.code === "KeyP") { if (state === "play") pause(); else if (state === "pause") resume(); }
  if (e.code === "KeyM") muted = !muted;
  if (e.code === "KeyF") toggleFS();
  if (e.code === "KeyR" && state === "dead") $("btnRetry").click();
  if (state === "title" && (e.code === "ArrowUp" || e.code === "ArrowDown")) { const i = WEAPON_ORDER.indexOf(weaponId); setWeapon(WEAPON_ORDER[(i + (e.code === "ArrowDown" ? 1 : WEAPON_ORDER.length - 1)) % WEAPON_ORDER.length]); }
  if (state === "title" && (e.code === "ArrowLeft" || e.code === "ArrowRight")) { const i = CHAR_ORDER.indexOf(charId); setChar(CHAR_ORDER[(i + (e.code === "ArrowRight" ? 1 : CHAR_ORDER.length - 1)) % CHAR_ORDER.length]); }
  if (state === "choice" && /^Digit[1-5]$/.test(e.code)) { choose(+e.code.slice(5) - 1); return; }
  if (state !== "play") return;
  if (ATK_KEYS.includes(e.code)) input.atkP = true;
  if (JUMP_KEYS.includes(e.code)) input.jumpP = true;
  if (THROW_KEYS.includes(e.code)) input.throwP = true;
  if (DASH_KEYS.includes(e.code)) input.dashP = true;
});
window.addEventListener("keyup", (e) => keys.delete(e.code));
window.addEventListener("blur", () => { keys.clear(); input.mouseL = false; releaseAllTouches(); if (state === "play") pause(); });

// --- 전체 화면 ---
function canFS() { const d = document.documentElement; return !!(d.requestFullscreen || d.webkitRequestFullscreen); }
function isFS() { return !!(document.fullscreenElement || document.webkitFullscreenElement); }
function isStandalone() { return matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches || navigator.standalone === true; }
async function enterFS() {
  const d = document.documentElement;
  try { if (d.requestFullscreen) await d.requestFullscreen({ navigationUI: "hide" }); else if (d.webkitRequestFullscreen) d.webkitRequestFullscreen(); } catch (e) {}
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock("landscape"); } catch (e) {}
}
function exitFS() { try { if (document.exitFullscreen) document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (e) {} }
function toggleFS() { if (isFS()) exitFS(); else enterFS(); }
function syncFSButton() {
  const b = $("btnFS"); if (!b) return;
  b.hidden = !canFS();
  b.textContent = isFS() ? "전체 화면 끄기" : "전체 화면";
  $("fsHint").hidden = canFS() || isStandalone() || !matchMedia("(pointer: coarse)").matches;
}
document.addEventListener("fullscreenchange", syncFSButton);
document.addEventListener("webkitfullscreenchange", syncFSButton);

// --- 모바일 화면 배치: 양옆 패널(panel) / 화면 위 겹침(overlay) / PC ---
const ui = document.getElementById("ui"), uctx = ui.getContext("2d");
const UI = { mode: "pc", vw: 0, vh: 0, gx: 0, gy: 0, gw: 0, gh: 0, top: 0, bot: 0, lp: null, rp: null, btns: {}, key: "" };
function safeInsets() {
  const cs = getComputedStyle($("safeProbe"));
  return { l: parseFloat(cs.paddingLeft) || 0, r: parseFloat(cs.paddingRight) || 0, t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
}
function layoutUI() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const key = vw + "x" + vh + ":" + touchMode;
  if (key === UI.key) return;
  UI.key = key;
  const fr = $("frame");
  if (!touchMode || vh > vw) {
    if (UI.mode !== "pc") { fr.removeAttribute("style"); ui.hidden = true; }
    UI.mode = "pc";
    return;
  }
  const ins = safeInsets(), MIN = 118;
  const usable = vw - ins.l - ins.r, avH = vh - ins.t - ins.b;
  let gh = avH, gw = gh * 1.5, mode = "panel";
  if (usable - gw < 2 * MIN) { gw = usable - 2 * MIN; gh = gw / 1.5; }
  if (gw < usable * 0.55) { mode = "overlay"; gw = Math.min(usable, avH * 1.5); gh = gw / 1.5; }
  const gx = ins.l + (usable - gw) / 2, gy = ins.t + (avH - gh) / 2;
  Object.assign(UI, { mode, vw, vh, gx, gy, gw, gh, top: ins.t, bot: vh - ins.b });
  fr.style.cssText = `position:fixed;left:${gx}px;top:${gy}px;width:${gw}px;height:${gh}px;margin:0;max-width:none;aspect-ratio:auto;z-index:2;border-radius:0;`;
  ui.hidden = mode !== "panel";
  if (mode === "panel") {
    UI.lp = { x0: ins.l, x1: gx };
    UI.rp = { x0: gx + gw, x1: vw - ins.r };
    UI.btns = {
      ...arcButtons(UI.rp.x1, UI.bot),
      pause: { x: UI.rp.x0 + 30, y: UI.top + 86, r: 17, label: "II" },
      fs:    { x: UI.rp.x0 + 70, y: UI.top + 86, r: 17, label: "FS" },
    };
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ui.width = Math.round(vw * dpr); ui.height = Math.round(vh * dpr);
    ui.style.width = vw + "px"; ui.style.height = vh + "px";
    uctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
}
window.addEventListener("resize", () => { UI.key = ""; });
window.addEventListener("orientationchange", () => { UI.key = ""; });
// 오른쪽 아래 모서리(right, bottom, 화면 px) 기준 부채꼴 버튼 4개. 모든 기기에서 같은 크기
const BTN_R = 28, ARC_R = 70;
function arcButtons(right, bottom) {
  const ax = right - 50, ay = bottom - 46, at = (deg) => [ax + Math.cos(deg * Math.PI / 180) * ARC_R, ay + Math.sin(deg * Math.PI / 180) * ARC_R];
  const [jx, jy] = at(180), [tx, ty] = at(233), [dx, dy] = at(286);
  return {
    atk:   { x: ax, y: ay, r: BTN_R, label: "공격" },
    jump:  { x: jx, y: jy, r: BTN_R, label: "점프" },
    throw: { x: tx, y: ty, r: BTN_R, label: "투척" },
    dash:  { x: dx, y: dy, r: BTN_R, label: "대시" },
  };
}
// 버튼 위치(화면 px)
function ctrlButtons() {
  if (UI.mode === "panel") return Object.entries(UI.btns).map(([k, b]) => ({ k, ...b }));
  const r = cv.getBoundingClientRect(), sc = r.width / W;
  const sys = ["pause", "fs"].map((k) => ({ k, x: r.left + TB[k].x * sc, y: r.top + TB[k].y * sc, r: TB[k].r * sc }));
  return [...Object.entries(arcButtons(r.right, r.bottom)).map(([k, b]) => ({ k, ...b })), ...sys];
}
// 조작 버튼과 조이스틱 그리기 (g: 그릴 캔버스, btns: 그 캔버스 좌표, stick: {x,y,kx,ky,r} 또는 null)
function drawControls(g, btns, stick, idle, faint) {
  const cd = cooldowns(), p = player;
  if (stick || idle) {
    const s0 = stick || idle;
    g.globalAlpha = stick ? 0.6 : faint ? 0.12 : 0.22;
    g.fillStyle = "rgba(20,24,28,0.6)"; g.beginPath(); g.arc(s0.x, s0.y, s0.r * 1.2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#9aa4ad"; g.lineWidth = 2; g.stroke();
    g.globalAlpha = stick ? 0.9 : faint ? 0.18 : 0.35;
    g.fillStyle = "#cfd6dc"; g.beginPath(); g.arc(stick ? s0.kx : s0.x, stick ? s0.ky : s0.y, s0.r * 0.5, 0, Math.PI * 2); g.fill();
    g.globalAlpha = 1;
  }
  const held = Object.values(touch.held);
  const btn = (k, frac, col, sub) => {
    const b = btns[k], on = held.includes(k);
    g.globalAlpha = faint && !on ? 0.55 : 1;
    g.fillStyle = on ? "rgba(255,255,255,0.28)" : "rgba(20,24,28,0.62)";
    g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill();
    if (k === "atk") { g.strokeStyle = "rgba(255,255,255,0.85)"; g.lineWidth = 3.5; } else { g.strokeStyle = "rgba(255,255,255,0.22)"; g.lineWidth = 2; }
    g.stroke();
    if (frac !== undefined) {
      g.strokeStyle = frac >= 1 ? col : col + "88"; g.lineWidth = Math.max(3, b.r * 0.1);
      g.beginPath(); g.arc(b.x, b.y, b.r - g.lineWidth, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * clamp(frac, 0, 1)); g.stroke();
    }
    g.fillStyle = frac === undefined || frac >= 1 ? C.text : C.muted;
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = `700 ${Math.max(12, Math.round(b.r * 0.46))}px "IBM Plex Sans KR", sans-serif`;
    const lb = k === "atk" ? WEAPONS[WPN()].atkLabel : k === "throw" ? WEAPONS[WPN()].spLabel : b.label;
    g.fillText(lb, b.x, b.y - (sub ? b.r * 0.16 : 0));
    if (sub) { g.font = `600 ${Math.max(10, Math.round(b.r * 0.34))}px "IBM Plex Sans KR", sans-serif`; g.fillStyle = C.muted; g.fillText(sub, b.x, b.y + b.r * 0.36); }
    g.globalAlpha = 1;
  };
  const atkSub = p.air ? (cd.slam >= 1 ? "내려찍기" : p.weapon === "wrench" ? "휘두르기" : "") : p.weapon === "rivet" && p.overheat > 0 ? "과열" : p.weapon === "torch" && p.fuelLock ? "연료" : "";
  btn("atk", p.air ? cd.slam : p.weapon === "rivet" ? 1 - p.heat / 100 + 0.0001 : p.weapon === "torch" ? p.fuel / 100 + 0.0001 : undefined, p.weapon === "torch" ? "#7fe0ff" : p.weapon === "rivet" && !p.air ? "#ffb347" : "#fff1a8", atkSub);
  btn("jump", undefined, C.visor, "");
  btn("dash", cd.dash, C.visor, "×" + cd.dashN);
  btn("throw", cd.throw, C.hazard, "");
  const icon = (b, fn) => { g.fillStyle = "rgba(20,24,28,0.7)"; g.beginPath(); g.arc(b.x, b.y, b.r, 0, Math.PI * 2); g.fill(); g.strokeStyle = "rgba(255,255,255,0.2)"; g.lineWidth = 1.5; g.stroke(); fn(); };
  if (canFS()) icon(btns.fs, () => {
    const fb = btns.fs, k = 5, on = isFS();
    g.strokeStyle = C.text; g.lineWidth = 2; g.lineCap = "square"; g.beginPath();
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      if (!on) { const vx = fb.x + sx * 7, vy = fb.y + sy * 7; g.moveTo(vx - sx * k, vy); g.lineTo(vx, vy); g.lineTo(vx, vy - sy * k); }
      else { const vx = fb.x + sx * 2.5, vy = fb.y + sy * 2.5; g.moveTo(vx + sx * k, vy); g.lineTo(vx, vy); g.lineTo(vx, vy + sy * k); }
    }
    g.stroke();
  });
  icon(btns.pause, () => { const pb = btns.pause; g.fillStyle = C.text; g.fillRect(pb.x - 6, pb.y - 7, 4, 14); g.fillRect(pb.x + 2, pb.y - 7, 4, 14); });
}
// 패널 그리기
function drawPanels() {
  if (UI.mode !== "panel") return;
  const g = uctx, { vw, vh, lp, rp, gx, gw } = UI;
  g.clearRect(0, 0, vw, vh);
  // 금속판 배경
  for (const [x0, x1, edge] of [[0, gx, gx], [gx + gw, vw, gx + gw]]) {
    const gr = g.createLinearGradient(0, 0, 0, vh); gr.addColorStop(0, "#1d2126"); gr.addColorStop(1, "#15181c");
    g.fillStyle = gr; g.fillRect(x0, 0, x1 - x0, vh);
    g.fillStyle = "#2a2f35"; g.fillRect(edge - (edge === gx ? 6 : 0), 0, 6, vh);
    g.save(); g.beginPath(); g.rect(edge - (edge === gx ? 6 : 0), 0, 6, vh); g.clip();
    g.fillStyle = "rgba(242,194,48,0.55)"; for (let y = -20; y < vh; y += 18) { g.beginPath(); g.moveTo(edge - 8, y); g.lineTo(edge + 8, y + 12); g.lineTo(edge + 8, y + 18); g.lineTo(edge - 8, y + 6); g.fill(); }
    g.restore();
    g.fillStyle = "#2e343b"; for (const yy of [14, vh - 14]) for (const xx of [x0 + 12, x1 - 18]) { g.beginPath(); g.arc(xx + 3, yy, 2.5, 0, Math.PI * 2); g.fill(); }
  }
  if (state === "title" || !player || !player.st) {
    g.fillStyle = "#3a4048"; g.font = '700 13px "IBM Plex Mono", monospace'; g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText("B-07", (lp.x0 + lp.x1) / 2, vh / 2); g.fillText("ESCAPE", (rp.x0 + rp.x1) / 2, vh / 2);
    return;
  }
  const p = player, L0 = lp.x0 + 12, LW = lp.x1 - lp.x0 - 24, T = UI.top + 12;
  // 왼쪽: 체력
  g.textAlign = "left"; g.textBaseline = "middle";
  g.font = '700 12px "IBM Plex Mono", monospace'; g.fillStyle = C.visor; g.fillText("B-07", L0, T + 6);
  drawBattery(g, L0 + 38, T, p.battery);
  g.fillStyle = C.text; g.textAlign = "right"; g.fillText(Math.ceil(p.hp) + "/" + p.maxHp, L0 + LW, T + 6);
  g.fillStyle = "#2b1a18"; g.fillRect(L0, T + 16, LW, 10);
  g.fillStyle = "rgba(255,255,255,0.75)"; g.fillRect(L0, T + 16, LW * clamp(p.hpLag / p.maxHp, 0, 1), 10);
  g.fillStyle = hpColor(p.hp / p.maxHp); g.fillRect(L0, T + 16, LW * clamp(p.hp / p.maxHp, 0, 1), 10);
  // 모듈 5칸 + 듀오
  const cw = (LW - 10) / 6;
  drawDuoChip(g, L0 + 5 * (cw + 2), T + 34, cw, 20, p.duo);
  g.textAlign = "center";
  SLOT_ORDER.forEach((sl, i) => {
    const m = p.mods[sl], x = L0 + i * (cw + 2), y = T + 34;
    g.fillStyle = "#101215"; g.fillRect(x, y, cw, 20);
    if (m) { g.fillStyle = FAM[MODS[m.id].fam].color; g.fillRect(x + 2, y + 2, cw - 4, 16); g.strokeStyle = RARITY[m.r].color; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, cw - 2, 18); }
    g.fillStyle = m ? "#101214" : "#4a525b"; g.font = '700 11px "IBM Plex Sans KR", sans-serif'; g.fillText(SLOTS[sl][0], x + cw / 2, y + 10.5);
  });
  g.textAlign = "left"; g.fillStyle = "#e0bf86"; g.font = '700 12px "IBM Plex Sans KR", sans-serif';
  g.fillText("고철 " + run.scrap, L0, p.weapon !== "wrench" ? T + 80 : T + 64);
  if (p.weapon !== "wrench") {
    const gy = T + 60, gf = p.weapon === "rivet" ? clamp(p.heat / 100, 0, 1) : clamp(p.fuel / 100, 0, 1);
    g.textAlign = "left"; g.font = '600 11px "IBM Plex Sans KR", sans-serif';
    g.fillStyle = C.muted; g.fillText(p.weapon === "rivet" ? (p.overheat > 0 ? "과열!" : "과열") : (p.fuelLock ? "연료 부족" : "연료"), L0, gy + 4);
    g.fillStyle = "#101215"; g.fillRect(L0 + 52, gy, LW - 52, 8);
    g.fillStyle = p.weapon === "rivet" ? (p.overheat > 0 ? C.danger : "#ff6a2b") : (p.fuelLock ? "#59616b" : "#7fe0ff");
    g.fillRect(L0 + 52, gy, (LW - 52) * gf, 8);
  }
  // 오른쪽: 방·점수
  const R0 = rp.x0 + 12;
  g.textAlign = "left"; g.fillStyle = C.text; g.font = '700 13px "IBM Plex Sans KR", sans-serif';
  g.fillText(roomLabel(room.n), R0, T + 6);
  const waveTxt = room.kind === "boss" ? (room.doorOpen ? "출구 개방" : "보스전") : room.kind === "station" ? REWARD[specialKind()].name : room.doorOpen ? "출구 개방" : room.cleared ? "보상 획득" : room.challenge ? (room.chStarted ? "버티기 " + Math.ceil(room.chT) + "초" : "준비") : room.wave === 0 ? "준비" : "웨이브 " + room.wave + "/" + room.waves;
  g.fillStyle = C.muted; g.font = '500 12px "IBM Plex Sans KR", sans-serif'; g.fillText(waveTxt, R0, T + 26);
  g.fillStyle = C.hazard; g.font = '700 13px "IBM Plex Mono", monospace'; g.fillText(String(run.score), R0, T + 46);
  // 조작
  const st = touch.stick;
  let stick = null;
  if (st) {
    const r = st.rad, x = clamp(st.sx, lp.x0 + r * 1.2 + 4, lp.x1 - r * 1.2 - 4), y = clamp(st.sy, T + 70 + r * 1.2, UI.bot - r * 1.2 - 4);
    const dx = st.x - st.sx, dy = st.y - st.sy, l = Math.hypot(dx, dy), m = Math.min(l, r);
    stick = { x, y, r, kx: l ? x + dx / l * m : x, ky: l ? y + dy / l * m : y };
  }
  const idle = { x: (lp.x0 + lp.x1) / 2, y: UI.bot - 70, r: clamp((lp.x1 - lp.x0) * 0.32, 34, 46) };
  if (state === "play") drawControls(g, UI.btns, stick, stick ? null : idle, false);
}
function hpColor(f) { return f <= 0.3 ? C.danger : f <= 0.5 ? C.hazard : C.good; }

// --- 터치 컨트롤 (캔버스 좌표 기준) ---
const TB = {
  atk:   { x: 856, y: 530, r: 60, label: "공격" },
  jump:  { x: 728, y: 572, r: 42, label: "점프" },
  dash:  { x: 872, y: 392, r: 42, label: "대시" },
  throw: { x: 742, y: 446, r: 38, label: "투척" },
  pause: { x: W / 2 - 24, y: 22, r: 18, label: "II" },
  fs:    { x: W / 2 + 24, y: 22, r: 18, label: "FS" },
};
// stick: 처음 닿은 자리(ox, oy)를 기준으로 움직임. 화면에 그리는 위치(dx, dy)는 캔버스 안으로만 보정
const touch = { stick: null, held: {} };
function canvasPt(e) { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
function releaseAllTouches() { touch.stick = null; touch.held = {}; }
// 터치는 게임 화면 밖(양옆 여백)에서 시작해도 받도록 문서 전체에서 처리
window.addEventListener("pointerdown", (e) => {
  if (e.pointerType !== "touch") return;
  touchMode = true;
  if (state !== "play") return;
  e.preventDefault();
  let hit = null, hd = Infinity;
  for (const b of ctrlButtons()) {
    if (b.k === "fs" && !canFS()) continue;
    const d = Math.hypot(e.clientX - b.x, e.clientY - b.y);
    if (d <= b.r + 10 && d < hd) { hd = d; hit = b; }
  }
  if (hit) {
    {
      const k = hit.k;
      touch.held[e.pointerId] = k;
      if (k === "atk") input.atkP = true;
      if (k === "jump") input.jumpP = true;
      if (k === "throw") input.throwP = true;
      if (k === "dash") input.dashP = true;
      if (k === "pause") pause();
      if (k === "fs") toggleFS();
      return;
    }
  }
  if (e.clientX < window.innerWidth * 0.5 && !touch.stick) {
    const sc = cv.getBoundingClientRect().width / W;
    touch.stick = { id: e.pointerId, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, rad: UI.mode === "panel" ? clamp((UI.lp.x1 - UI.lp.x0) * 0.32, 34, 46) : 52 * sc };
  }
}, { passive: false });
cv.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "touch" || state !== "play") return;
  if (e.button === 0) { input.mouseL = true; input.atkP = true; }
  if (e.button === 2) input.throwP = true;
});
window.addEventListener("pointermove", (e) => {
  if (touch.stick && e.pointerId === touch.stick.id) { touch.stick.x = e.clientX; touch.stick.y = e.clientY; }
});
function endPointer(e) {
  if (touch.stick && e.pointerId === touch.stick.id) touch.stick = null;
  delete touch.held[e.pointerId];
  if (e.pointerType !== "touch" && e.button === 0) input.mouseL = false;
}
window.addEventListener("pointerup", endPointer);
window.addEventListener("pointercancel", endPointer);
cv.addEventListener("contextmenu", (e) => e.preventDefault());
function atkHeld() { return ATK_KEYS.some((k) => keys.has(k)) || input.mouseL || Object.values(touch.held).includes("atk"); }
function moveVec() {
  let mx = 0, my = 0;
  if (keys.has("KeyW") || keys.has("ArrowUp")) my -= 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) my += 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) mx -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) mx += 1;
  if (touch.stick) {
    const st = touch.stick, dx = st.x - st.sx, dy = st.y - st.sy, l = Math.hypot(dx, dy);
    if (l > st.rad * 0.15) { const k = Math.min(1, l / st.rad); mx = dx / l * k; my = dy / l * k; }
  }
  const l = Math.hypot(mx, my);
  if (l > 1) { mx /= l; my /= l; }
  return { x: mx, y: my, len: Math.min(1, l) };
}
function buzz(ms) { if (SET.vib && touchMode && navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) {} } }

// ================= 유틸 =================
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const angTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
const dist = (a, b) => Math.hypot(b.x - a.x, b.y - a.y);
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; return d; }
function inRect(x, y, o, pad = 0) { return x > o.x - pad && x < o.x + o.w + pad && y > o.y - pad && y < o.y + o.h + pad; }
function resolveRect(e, o) {
  const cx = clamp(e.x, o.x, o.x + o.w), cy = clamp(e.y, o.y, o.y + o.h);
  const dx = e.x - cx, dy = e.y - cy, d2 = dx * dx + dy * dy;
  if (d2 >= e.r * e.r) return false;
  if (d2 === 0) {
    const l = e.x - o.x, r = o.x + o.w - e.x, t = e.y - o.y, b = o.y + o.h - e.y, m = Math.min(l, r, t, b);
    if (m === l) e.x = o.x - e.r; else if (m === r) e.x = o.x + o.w + e.r; else if (m === t) e.y = o.y - e.r; else e.y = o.y + o.h + e.r;
    return true;
  }
  const d = Math.sqrt(d2); e.x = cx + dx / d * e.r; e.y = cy + dy / d * e.r; return true;
}
function collideWorld(e, allowDoor) {
  let hit = false;
  const door = allowDoor ? room.doors.find((d) => Math.abs(e.x - d.x) < DOOR_W / 2 - e.r + 2) : null;
  const inDoor = !!door;
  if (e.x < RX0 + e.r) { e.x = RX0 + e.r; hit = true; }
  if (e.x > RX1 - e.r) { e.x = RX1 - e.r; hit = true; }
  if (!inDoor && e.y < RY0 + e.r) { e.y = RY0 + e.r; hit = true; }
  if (e.y > RY1 - e.r) { e.y = RY1 - e.r; hit = true; }
  if (inDoor && e.y < RY0 + e.r) { e.x = clamp(e.x, door.x - DOOR_W / 2 + e.r, door.x + DOOR_W / 2 - e.r); }
  for (const o of room.obstacles) if (resolveRect(e, o)) hit = true;
  return hit;
}
function los(a, b) {
  const d = dist(a, b), n = Math.ceil(d / 12);
  for (let i = 1; i < n; i++) {
    const x = a.x + (b.x - a.x) * i / n, y = a.y + (b.y - a.y) * i / n;
    for (const o of room.obstacles) if (inRect(x, y, o)) return false;
  }
  return true;
}

// ================= 게임 상태 =================
let state = "title"; // title | play | pause | dead
let player, enemies, bolts, pending, particles, texts, afterimages, waves = [], zaps = [], room, run;
let hitstop = 0, shakeAmt = 0, hurtFlash = 0, banner = null;

function newPlayer() {
  return {
    x: W / 2, y: RY1 - 60, r: 14, vx: 0, vy: 0, kx: 0, ky: 0, hp: 100, maxHp: 100, face: Math.PI / 2, inv: 0, dead: false, deathT: 0,
    dash: { charges: 2, max: 2, regen: 0, t: 0, dx: 0, dy: 0 },
    atk: { i: -1, t: 0, dur: 0, ang: 0, hit: null, queued: false, comboT: 0, next: 0, cd: 0 },
    wrench: null, specCd: 0,
    z: 0, vz: 0, air: false, slam: null, slamCd: 0, squash: 0, mark: null,
    mods: {}, wups: {}, st: null, walk: 0, moving: false, hpLag: 100, lagT: 0, healGlow: 0,
    battery: true, duo: null, overloadT: 0,
    weapon: weaponId, lock: null, bloom: 0, heat: 0, overheat: 0, fuel: 100, fuelLock: false, fireT: 9, shotT: 0, flaming: false, tickT: 0, firing: false, aimAng: Math.PI / 2, flameSnd: 0, pullT: 0, atkCount: 0, flashT: 0,
  };
}

const ZONE_ROOMS = 7; // 1~5 전투, 6 충전소, 7 보스
function roomKind(n) { const l = localN(n); return l <= 5 ? "combat" : l === 6 ? "station" : "boss"; }
// 방 6은 판마다 충전소 또는 부품 상점
function specialKind() { return mulberry32(hashStr(runSeed + "#special" + curZone()))() < 0.5 ? "station" : "shop"; }
function genDoors(n) {
  const r = mulberry32(hashStr(runSeed + "#doors#" + n));
  const ln = localN(n);
  if (ln === 5) return [{ type: specialKind() }];
  if (ln === 6) return [{ type: "boss" }];
  if (ln === 7) return [{ type: "exit" }];
  const count = r() < 0.4 ? 3 : 2;
  const pool = ["module", "module", "module", "heal", "weapon", "chip", "scrap"];
  const types = ["module"];
  let guard = 0;
  while (types.length < count && guard++ < 50) { const t = pool[Math.floor(r() * pool.length)]; if (!types.includes(t)) types.push(t); }
  for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [types[i], types[j]] = [types[j], types[i]]; }
  if (ln >= 2 && ln <= 4 && r() < 0.2) types[Math.floor(r() * types.length)] = "challenge";
  return types.map((type) => ({ type }));
}
function genRoom(n, reward) {
  roomRng(n);
  const kind = roomKind(n);
  const doors = genDoors(n);
  const xs = doors.length === 1 ? [W / 2] : doors.length === 2 ? [W / 2 - 170, W / 2 + 170] : [W / 2 - 250, W / 2, W / 2 + 250];
  doors.forEach((d, i) => (d.x = xs[i]));
  const obstacles = [], decals = [];
  const count = kind === "combat" ? 3 + Math.floor(mapRng() * 3) : 0;
  const z2 = zoneOf(n) === 2 && kind === "combat";
  const belts = z2 ? genBelts(mapRng, doors) : [];
  if (kind === "boss" && zoneOf(n) === 1) { obstacles.push({ x: 176, y: 336, w: 64, h: 56 }, { x: W - 240, y: 336, w: 64, h: 56 }); }
  if (kind === "boss" && zoneOf(n) === 3) obstacles.push({ x: 190, y: 330, w: 64, h: 50 }, { x: W - 254, y: 330, w: 64, h: 50 }, { x: W / 2 - 32, y: 410, w: 64, h: 44 });
  if (kind === "boss" && zoneOf(n) === 2) {
    obstacles.push({ x: 150, y: 300, w: 60, h: 56 }, { x: W - 210, y: 300, w: 60, h: 56 });
    belts.push({ x: RX0 + 70, y: RY0 + 96, w: RX1 - RX0 - 140, h: 56, dir: 0 }, { x: RX0 + 70, y: RY1 - 156, w: RX1 - RX0 - 140, h: 56, dir: Math.PI });
  }
  let tries = 0;
  while (obstacles.length < count && tries < 300) {
    tries++;
    const w = 48 + Math.floor(mapRng() * 6) * 10, h = 48 + Math.floor(mapRng() * 6) * 10;
    const x = Math.round((RX0 + 70 + mapRng() * (RX1 - RX0 - 140 - w)) / 8) * 8;
    const y = Math.round((RY0 + 90 + mapRng() * (RY1 - RY0 - 200 - h)) / 8) * 8;
    const o = { x, y, w, h };
    if (doors.some((d) => x < d.x + 70 && x + w > d.x - 70 && y < RY0 + 120)) continue; // 출구 통로
    if (inRect(W / 2, RY1 - 60, o, 100)) continue; // 시작 지점
    if (inRect(W / 2, (RY0 + RY1) / 2, o, 50)) continue; // 보상 자리
    if (obstacles.some((q) => x < q.x + q.w + 60 && x + w > q.x - 60 && y < q.y + q.h + 60 && y + h > q.y - 60)) continue;
    if (belts.some((q) => x < q.x + q.w + 16 && x + w > q.x - 16 && y < q.y + q.h + 16 && y + h > q.y - 16)) continue;
    obstacles.push(o);
  }
  for (let i = 0; i < 7; i++) decals.push({ x: RX0 + mapRng() * (RX1 - RX0), y: RY0 + mapRng() * (RY1 - RY0), r: 14 + mapRng() * 34, a: 0.05 + mapRng() * 0.07 });
  const presses = z2 ? genPresses(mapRng, 2 + (localN(n) >= 3 ? 1 : 0), obstacles) : [];
  const lasers = zoneOf(n) === 3 && kind === "combat" ? genLasers(mapRng, localN(n) >= 3 ? 2 : 1) : [];
  const rm = { n, kind, reward, doors, obstacles, decals, belts, presses, lasers, cracks: [], wave: 0, waves: kind === "combat" ? 3 : 0, delay: 1.3, cleared: false, doorOpen: false, pickup: null, tookDamage: false, doorPulse: 0 };
  if (kind === "boss") { rm.delay = 1.8; rm.bossSpawned = false; rm.boss = null; rm.bossDeadT = 0; rm.wreck = null; }
  if (reward === "challenge") { rm.challenge = true; rm.waves = 0; rm.delay = 1.6; }
  if (kind === "station") { rm.cleared = true; rm.pickup = { x: W / 2, y: (RY0 + RY1) / 2 - 20, type: specialKind(), t: 0 }; }
  return rm;
}
function spawnPickup() {
  const cy = (RY0 + RY1) / 2;
  let x = W / 2, y = cy;
  for (let r = 0; r < 300; r += 20) {
    let ok = false;
    for (let a = 0; a < 8; a++) { x = W / 2 + Math.cos(a / 8 * Math.PI * 2) * r; y = cy + Math.sin(a / 8 * Math.PI * 2) * r * 0.6; if (!room.obstacles.some((o) => inRect(x, y, o, 30))) { ok = true; break; } }
    if (ok) break;
  }
  room.pickup = { x, y, type: room.reward, t: 0 };
  burst(x, y, 20, REWARD[room.reward].color, 220, 0.5, 2.6);
  sfx("door");
}
function openDoors() {
  room.doorOpen = true;
  sfx("door");
  // 위기 보정: 체력 50% 이하면 다음 출구 중 하나를 수리 키트 문으로
  let pity = false;
  if (player.hp <= player.maxHp * 0.5 && localN(room.n) <= 4 && !room.doors.some((d) => d.type === "heal")) {
    let cands = room.doors.filter((d) => d.type !== "module" && d.type !== "challenge");
    if (!cands.length) cands = room.doors.filter((d) => d.type !== "module");
    if (!cands.length) cands = room.doors;
    const d = cands[Math.floor(Math.random() * cands.length)];
    d.type = "heal"; d.pity = true; pity = true;
  }
  showBanner("출구 개방", pity ? "체력이 낮아 수리 키트 문이 열렸어요" : room.doors.length > 1 ? "문 앞에 표시된 다음 보상을 보고 고르세요" : "다음 방으로 이동하세요");
}

function startRun() {
  initAudio();
  newSeed();
  player = newPlayer();
  recalcStats();
  enemies = []; bolts = []; pending = []; particles = []; texts = []; afterimages = []; waves = []; zaps = []; shots = []; fires = []; healDrops = []; oils = []; booms = []; releaseAllTouches();
  run = { score: 0, kills: 0, time: 0, cause: "", won: false, char: charId, weapon: weaponId, scrap: 0, batteryUsed: false };
  lbStart(run);
  room = genRoom(1, "module");
  hitstop = 0; shakeAmt = 0; hurtFlash = 0;
  showBanner("1구역 · 폐기장", "방을 정리하면 강화 모듈을 얻어요");
  state = "play";
  $("ovTitle").hidden = true; $("ovDead").hidden = true; $("ovPause").hidden = true; $("ovChoice").hidden = true;
}
function enterDoor(d) {
  let zoneUp = false;
  if (d.type === "exit") {
    if (zoneOf(room.n) >= ZONES) { startEnding(); return; } // 마지막 구역: 엔딩
    zoneUp = true;
  }
  const n = room.n + 1;
  room = genRoom(n, zoneUp ? "module" : d.type === "station" || d.type === "shop" || d.type === "boss" ? null : d.type);
  player.x = W / 2; player.y = RY1 - 50; player.kx = player.ky = 0; player.z = 0; player.air = false; player.slam = null;
  bolts = []; pending = []; afterimages = []; waves = []; zaps = []; shots = []; fires = []; healDrops = []; oils = []; booms = [];
  if (player.wrench) { player.wrench = null; player.specCd = 0; }
  if (zoneUp) {
    // 구역 돌파: 보너스 +500, 체력 30% 회복
    const p = player, heal = Math.round(p.maxHp * 0.3);
    run.score += 500; p.hp = Math.min(p.maxHp, p.hp + heal);
    (run.zt = run.zt || []).push(run.time);
    showBanner(zoneOf(n) + "구역 · " + ZONE_NAME[zoneOf(n)], "돌파 보너스 +500 · 체력 +" + heal + " · " + ({ 2: "컨베이어와 프레스를 조심하세요", 3: "레이저 스캐너는 점프로 넘으세요" }[zoneOf(n)] || "")); banner.t = 3;
    room.delay = 3;
    sfx("revive");
  }
  else if (room.kind === "boss") showBanner(roomLabel(n) + " · 보스", zoneOf(n) === 3 ? "최종 보스 · 품질 판정기 QC-9가 판정을 시작해요" : zoneOf(n) === 2 ? "조립 로봇 멀티암 A-02가 가동돼요" : "파쇄기 그라인더 G-01이 깨어나요");
  else if (room.kind === "station") showBanner(roomLabel(n) + " · " + REWARD[specialKind()].name, specialKind() === "shop" ? "고철로 부품을 살 수 있어요" : "충전 장치를 사용하세요");
  else if (room.challenge) showBanner(roomLabel(n) + " · 긴급 생산 라인", "30초 버티면 보상 2개 + 고철 60");
  else showBanner(roomLabel(n), "보상: " + REWARD[room.reward].name);
}
function winZone() {
  if (run.won) return;
  run.won = true;
  run.score += 500;
  state = "dead";
  showResult(true);
}
function goHome() {
  state = "title";
  $("ovPause").hidden = true; $("ovDead").hidden = true; $("ovChoice").hidden = true; $("ovTitle").hidden = false;
  releaseAllTouches(); keys.clear();
  enemies = []; bolts = []; pending = []; shots = []; fires = []; healDrops = []; oils = []; booms = []; particles = []; texts = []; banner = null;
  newSeed(); room = genRoom(1, "module"); player = newPlayer(); recalcStats();
  $("btnStart").focus();
}
function pause() { state = "pause"; $("ovPause").hidden = false; }
function resume() { state = "play"; $("ovPause").hidden = true; initAudio(); }
function showBanner(title, sub) { banner = { title, sub, t: 2.2 }; }

// ================= 1구역 보스: 파쇄기 그라인더 G-01 =================
const BOSS = { hp: 1200, p2At: 0.6, stunMul: 1.3, stunCrate: 1.8, stunWall: 1.2, brakePast: 20, slide: 80, brakeT: 0.28, r: 50, walk: 55, chargeSp: 560, chargeSp2: 680, wind: 0.9, wind2: 0.6, wind2b: 0.45, chargeDmg: 25, scrapDmg: 12, suckT: 3, suckF: 150, rollerDmg: 20, oilDmg: 8 };
let oils = [];
function makeBoss(x, y) {
  return { type: "boss", kind: "grinder", x, y, r: BOSS.r, hp: BOSS.hp, maxHp: BOSS.hp, vx: 0, vy: 0, flash: 0, state: "move", t: 1.3, tMax: 1, aim: Math.PI / 2, last: "", p2: false, roll: 0, chargeLen: 0, charges: 0, volleys: 0, hitPlayer: false, oilD: 0, hpLag: BOSS.hp, lagT: 0, rollHit: 0 };
}
function circRect(x, y, r, o) { const cx = clamp(x, o.x, o.x + o.w), cy = clamp(y, o.y, o.y + o.h); return (x - cx) ** 2 + (y - cy) ** 2 < r * r; }
function bossChargeLen(e) {
  const cx = Math.cos(e.aim), cy = Math.sin(e.aim);
  let d = 0;
  for (; d < 1100; d += 8) {
    const x = e.x + cx * d, y = e.y + cy * d;
    if (x < RX0 + e.r || x > RX1 - e.r || y < RY0 + e.r || y > RY1 - e.r) break;
    if (room.obstacles.some((o) => circRect(x, y, e.r, o))) break;
  }
  return d;
}
function bossToMove(e) { e.state = "move"; e.t = e.p2 ? rand(0.7, 1.2) : rand(1.1, 1.8); }
// 돌진 경로: 플레이어를 조금 지나친 곳에서 브레이크. 벽·상자가 그보다 가까우면 그대로 박음
function bossAimPath(e) {
  const p = player, cx = Math.cos(e.aim), cy = Math.sin(e.aim);
  e.chargeLen = bossChargeLen(e);
  const proj = (p.x - e.x) * cx + (p.y - e.y) * cy;
  e.brakeAt = Math.max(100, proj + BOSS.brakePast);
  e.willCrash = e.brakeAt + BOSS.slide >= e.chargeLen - 6;
}
function bossWindup(e, t) { e.state = "windup"; e.t = t; e.tMax = t; e.aim = angTo(e, player); bossAimPath(e); sfx("windup"); }
const BOSS_W = { charge: 0.35, spit: 0.4, suck: 0.25 };
function bossNext(e) {
  let pick = "charge";
  if (e.last) {
    const pool = Object.keys(BOSS_W).filter((k) => k !== e.last), tot = pool.reduce((a, k) => a + BOSS_W[k], 0);
    let r = Math.random() * tot; pick = pool[pool.length - 1];
    for (const k of pool) { r -= BOSS_W[k]; if (r <= 0) { pick = k; break; } }
  }
  e.last = pick;
  if (pick === "charge") { e.charges = e.p2 ? 2 : 1; bossWindup(e, e.p2 ? BOSS.wind2 : BOSS.wind); }
  else if (pick === "spit") { e.state = "spitWind"; e.t = 0.75; e.tMax = 0.75; e.volleys = e.p2 ? 2 : 1; sfx("windup"); }
  else { e.state = "suck"; e.t = BOSS.suckT; e.tMax = BOSS.suckT; e.rollHit = 0; sfx("pull"); if (e.p2) bossSummon(e, 2); }
}
function bossSummon(e, n) {
  const live = enemies.filter((o) => o.type === "spark" && !o.dead).length + pending.length;
  for (let i = 0; i < Math.min(n, 3 - live); i++) {
    let q, tries = 0;
    do { const a = Math.random() * Math.PI * 2; q = { x: clamp(e.x + Math.cos(a) * 120, RX0 + 30, RX1 - 30), y: clamp(e.y + Math.sin(a) * 100, RY0 + 30, RY1 - 30), r: 13 }; tries++; }
    while (tries < 30 && (room.obstacles.some((o) => inRect(q.x, q.y, o, 23)) || dist(q, player) < 130 || dist(q, e) < e.r + 20));
    pending.push({ type: "spark", x: q.x, y: q.y, r: 13, t: 0.6 + i * 0.25 });
  }
}
function bossSpit(e) {
  const base = angTo(e, player);
  for (let i = -3; i <= 3; i++) {
    const a = base + i * 0.24 + rand(-0.03, 0.03), sp = rand(270, 320);
    bolts.push({ x: e.x + Math.cos(a) * (e.r + 6), y: e.y + Math.sin(a) * (e.r + 6), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: 7, ang: a, kind: "scrap", dmg: BOSS.scrapDmg, cause: "그라인더가 뿜은 고철에 맞았어요", spin: Math.random() * 6, col: i % 2 ? "#c9a26a" : "#8a929b" });
  }
  debris(e.x, e.y - 20, 6, "#8a929b");
  shake(6); sfx("shotgun");
}
function bossEnrage(e) {
  const p = player;
  e.p2 = true; e.state = "rage"; e.t = 1.3; e.tMax = 1.3;
  waves.push({ x: e.x, y: e.y, t: 0, max: 0.5, R: 170, col: "#ff6a2b" });
  burst(e.x, e.y, 36, "#ff6a2b", 360, 0.7, 3.4);
  if (!p.dead && dist(p, e) < 190) { const a = angTo(e, p); p.kx += Math.cos(a) * 520; p.ky += Math.sin(a) * 520; }
  showBanner("그라인더 과열!", "더 빠르고 거칠어져요"); banner.t = 1.6;
  hitstop = Math.max(hitstop, 0.12); shake(16); sfx("roar"); buzz(60);
  bossSummon(e, 2);
}
function bossChargeEnd(e) {
  if (e.charges > 1) { e.charges--; bossWindup(e, BOSS.wind2b); }
  else if (e.p2) { e.state = "spitWind"; e.t = 0.35; e.tMax = 0.35; e.volleys = 1; sfx("windup"); } // 2페이즈 연계: 돌진 직후 고철 뿜기
  else { e.state = "recover"; e.t = 0.6; }
}
function bossCrash(e) {
  const cx = Math.cos(e.aim), cy = Math.sin(e.aim);
  const crate = room.obstacles.find((o) => circRect(e.x + cx * 4, e.y + cy * 4, e.r + 2, o));
  if (crate) {
    room.obstacles = room.obstacles.filter((o) => o !== crate);
    const ox = crate.x + crate.w / 2, oy = crate.y + crate.h / 2;
    debris(ox, oy, 16, C.crateHi); debris(ox, oy, 8, C.crate); burst(ox, oy, 18, "#e0bf86", 280, 0.45, 3);
    addText(ox, oy - 30, "상자 파괴", "#e0bf86", false);
  }
  if (e.p2 && e.charges > 1) { e.charges--; shake(10); sfx("clank"); burst(e.x, e.y, 14, C.eye, 260, 0.35, 2.6); bossWindup(e, BOSS.wind2b); return; }
  e.state = "stun"; e.t = crate ? BOSS.stunCrate : BOSS.stunWall; e.tMax = e.t;
  burst(e.x + Math.cos(e.aim) * e.r, e.y + Math.sin(e.aim) * e.r, 22, C.eye, 320, 0.45, 3);
  debris(e.x + Math.cos(e.aim) * e.r, e.y + Math.sin(e.aim) * e.r, 10, "#6b7380");
  room.cracks.push({ x: e.x + Math.cos(e.aim) * e.r * 0.8, y: e.y + Math.sin(e.aim) * e.r * 0.8, seed: Math.random() * 10 });
  hitstop = Math.max(hitstop, 0.1); shake(16); sfx("slam"); buzz(50);
  addText(e.x, e.y - 70, "기절!", C.hazard, true);
}
function updateBoss(e, dt) {
  if (e.kind === "multiarm") { updateMultiarm(e, dt); return; }
  if (e.kind === "qc9") { updateQC9(e, dt); return; }
  const p = player, ap = angTo(e, p), dp = dist(e, p);
  e.roll += dt * (e.state === "charge" || e.state === "brake" ? 3.2 : e.state === "suck" ? 4 : e.state === "stun" ? 0 : 0.6);
  if (!e.p2 && e.hp <= e.maxHp * BOSS.p2At && e.state !== "charge" && e.state !== "windup" && e.state !== "brake") { bossEnrage(e); return; }
  e.t -= dt;
  if (e.state === "move") {
    if (!p.dead && dp > e.r + p.r + 40) { const sp = BOSS.walk * (e.p2 ? 1.3 : 1) * (1 - 0.08 * (e.chillS || 0)); e.x += Math.cos(ap) * sp * dt; e.y += Math.sin(ap) * sp * dt; }
    if (e.t <= 0 && !p.dead) bossNext(e);
  } else if (e.state === "windup") {
    if (e.t > e.tMax * 0.3 && !p.dead) { e.aim += clamp(angDiff(e.aim, ap), -2.6 * dt, 2.6 * dt); bossAimPath(e); }
    if (e.t <= 0) { e.state = "charge"; e.t = 1.8; e.trav = 0; e.hitPlayer = false; e.oilD = 0; sfx("grind"); }
  } else if (e.state === "charge") {
    const sp = e.p2 ? BOSS.chargeSp2 : BOSS.chargeSp, cx = Math.cos(e.aim), cy = Math.sin(e.aim);
    e.x += cx * sp * dt; e.y += cy * sp * dt;
    if (Math.random() < 0.7) particles.push({ x: e.x - cx * e.r + rand(-30, 30), y: e.y - cy * e.r + rand(-20, 20), z: 4, vz: rand(40, 120), vx: -cx * 80, vy: -cy * 80, life: 0.35, max: 0.35, color: "#6b6f74", size: rand(3, 5), glow: false, nograv: false });
    if (!e.hitPlayer && !p.dead && p.z < 40 && dp < e.r + p.r) { e.hitPlayer = true; hurtPlayer(BOSS.chargeDmg, e, "그라인더의 분쇄 돌진에 깔렸어요"); }
    if (e.p2) { e.oilD += sp * dt; if (e.oilD > 56) { e.oilD = 0; oils.push({ x: e.x - cx * e.r * 0.5, y: e.y - cy * e.r * 0.5, r: 24, t: 4.5, max: 4.5 }); } }
    e.trav += sp * dt;
    if (!e.willCrash && e.trav >= e.brakeAt) { e.state = "brake"; e.t = BOSS.brakeT; e.tMax = BOSS.brakeT; e.bv = sp; sfx("dash"); }
    else if (e.t <= 0) bossChargeEnd(e);
  } else if (e.state === "brake") {
    const k = Math.max(0, e.t / e.tMax), v = e.bv * k, cx = Math.cos(e.aim), cy = Math.sin(e.aim);
    e.x += cx * v * dt; e.y += cy * v * dt;
    if (Math.random() < 0.8) particles.push({ x: e.x + rand(-40, 40), y: e.y + rand(-10, 20), z: 2, vz: rand(20, 60), vx: -cx * 60 + rand(-30, 30), vy: -cy * 60, life: 0.3, max: 0.3, color: Math.random() < 0.4 ? C.eye : "#6b6f74", size: rand(2, 4), glow: Math.random() < 0.4, nograv: true });
    if (!e.hitPlayer && !p.dead && p.z < 40 && v > 180 && dp < e.r + p.r) { e.hitPlayer = true; hurtPlayer(BOSS.chargeDmg, e, "그라인더의 분쇄 돌진에 깔렸어요"); }
    if (e.t <= 0) bossChargeEnd(e);
  } else if (e.state === "spitWind") {
    if (e.t <= 0) { bossSpit(e); e.volleys--; if (e.volleys > 0) { e.t = 0.45; e.tMax = 0.45; } else { e.state = "recover"; e.t = 0.7; } }
  } else if (e.state === "suck") {
    if (!p.dead && p.dash.t <= 0) {
      const a = angTo(p, e), f = BOSS.suckF * (e.p2 ? 1.15 : 1) * clamp(1.3 - dp / 500, 0.55, 1.2);
      p.x += Math.cos(a) * f * dt; p.y += Math.sin(a) * f * dt;
      collideWorld(p, false);
    }
    if (Math.random() < (touchMode ? 0.5 : 0.9)) { const a = Math.random() * Math.PI * 2, r = rand(150, 230); particles.push({ x: e.x + Math.cos(a) * r, y: e.y + Math.sin(a) * r * 0.8, z: rand(4, 30), vz: 0, vx: -Math.cos(a) * r * 2.2, vy: -Math.sin(a) * r * 1.8, life: 0.42, max: 0.42, color: "#7fe0ff", size: 2.2, glow: true, nograv: true }); }
    if (e.rollHit > 0) e.rollHit -= dt;
    if (!p.dead && p.z < 30 && dp < e.r + p.r + 8 && e.rollHit <= 0) { e.rollHit = 0.8; hurtPlayer(BOSS.rollerDmg, e, "그라인더의 롤러에 빨려 들어갔어요"); }
    if (e.t <= 0) { e.state = "recover"; e.t = 0.6; }
  } else if (e.state === "recover" || e.state === "stun" || e.state === "rage") {
    if (e.t <= 0) bossToMove(e);
  }
}
function bossDown(e) {
  const p = player;
  run.kills++; run.score += 1000;
  addText(e.x, e.y - 60, "+1000", C.good, true);
  for (const o of enemies) if (!o.dead && o !== e) { o.dead = true; burst(o.x, o.y, 14, "#ffb347", 240, 0.4, 3); }
  pending = []; bolts = [];
  for (const o of oils) o.t = Math.min(o.t, 0.6);
  room.cleared = true; room.bossDeadT = 2.6; room.boomT = 0; room.wreck = { x: e.x, y: e.y, p2: e.p2, roll: e.roll, kind: e.kind, rot: e.rot };
  p.inv = Math.max(p.inv, 3);
  p.grabbed = false; p.thrownT = 0;
  burst(e.x, e.y, 50, "#ffb347", 420, 0.8, 4); debris(e.x, e.y, 22, C.hazard); debris(e.x, e.y, 12, "#6b7380");
  waves.push({ x: e.x, y: e.y, t: 0, max: 0.6, R: 210, col: "#ff6a2b" });
  hitstop = 0.3; shake(24); sfx("explode"); sfx("roar"); buzz(120);
  showBanner("그라인더 파괴 +1000", "잠시 후 출구가 열려요");
}
function updateBossRoom(dt) {
  if (!room.bossSpawned) {
    room.delay -= dt;
    if (room.delay <= 0) { room.bossSpawned = true; const b = curZone() === 3 ? makeQC9(W / 2, RY0 + 170) : curZone() === 2 ? makeMultiarm(W / 2, RY0 + 220) : makeBoss(W / 2, RY0 + 170); b.drop = 0.34; room.boss = b; enemies.push(b); sfx("spawn"); }
    return;
  }
  if (room.bossDeadT > 0) {
    room.bossDeadT -= dt; room.boomT -= dt;
    const w = room.wreck;
    if (room.boomT <= 0 && room.bossDeadT > 0.6) { room.boomT = 0.22; const x = w.x + rand(-50, 50), y = w.y + rand(-30, 30); burst(x, y, 16, Math.random() < 0.5 ? "#ffb347" : "#ff6a2b", 260, 0.45, 3); shake(5); sfx("explode"); }
    if (room.bossDeadT <= 0) { room.doorOpen = true; sfx("door"); showBanner("출구 개방", "폐기장을 빠져나가세요"); }
  }
}
function updateOils(dt) {
  const p = player;
  for (const o of oils) {
    o.t -= dt;
    if (Math.random() < (touchMode ? 0.25 : 0.5)) particles.push({ x: o.x + rand(-o.r, o.r) * 0.8, y: o.y + rand(-o.r, o.r) * 0.5, z: 2, vz: rand(40, 90), vx: 0, vy: 0, life: 0.4, max: 0.4, color: Math.random() < 0.5 ? "#ffb347" : "#ff6a2b", size: rand(2.5, 4), glow: true, nograv: true });
    if (!p.dead && p.z < 10 && dist(o, p) < o.r + p.r * 0.4) hurtPlayer(BOSS.oilDmg, null, "불붙은 기름을 밟았어요");
  }
  oils = oils.filter((o) => o.t > 0);
}
function drawOils() {
  for (const o of oils) {
    const a = clamp(o.t / 0.6, 0, 1) * clamp((o.max - o.t) / 0.2, 0, 1), fl = 0.85 + Math.sin(performance.now() / 70 + o.x) * 0.15;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(o.x, syf(o.y)); ctx.scale(1, SY);
    const g = ctx.createRadialGradient(0, 0, 2, 0, 0, o.r * fl);
    g.addColorStop(0, "rgba(255,210,110,0.9)"); g.addColorStop(0.55, "rgba(255,106,43,0.75)"); g.addColorStop(1, "rgba(120,30,10,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, o.r * 1.1, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
// 보스 바닥 예고
function drawBossMarks(e) {
  if (e.kind === "multiarm") { drawMultiMarks(e); return; }
  if (e.kind === "qc9") { drawQCMarks(e); return; }
  if (e.state === "windup") {
    const k = 1 - e.t / e.tMax, L = (e.willCrash ? e.chargeLen : e.brakeAt + BOSS.slide) + e.r;
    ctx.save(); ctx.translate(e.x, syf(e.y)); ctx.scale(1, SY); ctx.rotate(e.aim);
    ctx.globalAlpha = 0.18 + k * 0.32; ctx.fillStyle = C.danger; ctx.fillRect(0, -e.r, L, e.r * 2);
    ctx.globalAlpha = 0.6 + k * 0.4; ctx.strokeStyle = C.danger; ctx.lineWidth = 3; ctx.setLineDash([14, 10]); ctx.strokeRect(0, -e.r, L, e.r * 2); ctx.setLineDash([]);
    ctx.globalAlpha = 0.9; ctx.fillStyle = C.danger; ctx.fillRect(0, -2, L * k, 4);
    ctx.globalAlpha = 0.95; ctx.fillStyle = e.willCrash ? C.hazard : C.danger; ctx.fillRect(L - (e.willCrash ? 8 : 4), -e.r, e.willCrash ? 8 : 4, e.r * 2);
    ctx.restore();
  } else if (e.state === "spitWind") {
    const k = 1 - e.t / e.tMax, base = angTo(e, player);
    ctx.save(); ctx.translate(e.x, syf(e.y)); ctx.scale(1, SY);
    ctx.globalAlpha = 0.25 + k * 0.5; ctx.strokeStyle = "#e0bf86"; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
    for (let i = -3; i <= 3; i++) { const a = base + i * 0.24; ctx.beginPath(); ctx.moveTo(Math.cos(a) * e.r, Math.sin(a) * e.r); ctx.lineTo(Math.cos(a) * (e.r + 120 + k * 80), Math.sin(a) * (e.r + 120 + k * 80)); ctx.stroke(); }
    ctx.restore();
  } else if (e.state === "suck") {
    const ph = (performance.now() / 600) % 1;
    ctx.save(); ctx.translate(e.x, syf(e.y)); ctx.scale(1, SY); ctx.strokeStyle = "#7fe0ff"; ctx.lineWidth = 2.5;
    for (let i = 0; i < 3; i++) { const k = (ph + i / 3) % 1; ctx.globalAlpha = k * 0.7; ctx.beginPath(); ctx.arc(0, 0, e.r + 20 + (1 - k) * 200, 0, Math.PI * 2); ctx.stroke(); }
    ctx.globalAlpha = 0.25; ctx.fillStyle = C.danger; ctx.beginPath(); ctx.arc(0, 0, e.r + 22, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}
// 몸체 그리기 (X, Y = 화면상 바닥 앞쪽 중앙)
function drawGrinderBody(g, x, y, s, o) {
  const hot = !!o.hot, dead = !!o.dead, rot = o.roll || 0, D = 34 * s, now = performance.now();
  const bw = 200 * s, bh = 112 * s, bx = x - bw / 2, by = y - 40 * s - bh;
  const eyeK = dead ? 0 : o.eye == null ? 0.6 : o.eye;
  // 궤도
  for (const tx of [bx - 14 * s, bx + bw - 54 * s]) {
    g.fillStyle = "#1e2226"; cRR(g, tx, y - 44 * s, 68 * s, 44 * s, 12 * s); g.fill();
    g.fillStyle = "#3a4047"; for (let i = 0; i < 7; i++) g.fillRect(tx + 6 * s + ((i * 10 * s + rot * 12 * s) % (60 * s) + 60 * s) % (60 * s), y - 40 * s, 4 * s, 36 * s);
    g.fillStyle = "#59616b"; for (const wx of [14, 34, 54]) { g.beginPath(); g.arc(tx + wx * s, y - 22 * s, 7 * s, 0, Math.PI * 2); g.fill(); }
  }
  // 옆면, 윗면
  g.fillStyle = dead ? "#241f1a" : hot ? "#7a2a14" : "#7a5418";
  g.beginPath(); g.moveTo(bx + bw, by); g.lineTo(bx + bw + D, by - D * 0.6); g.lineTo(bx + bw + D, by + bh - D * 0.6); g.lineTo(bx + bw, by + bh); g.closePath(); g.fill();
  g.fillStyle = dead ? "#3a332a" : hot ? "#d0552a" : "#e0aa3a";
  g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + D, by - D * 0.6); g.lineTo(bx + bw + D, by - D * 0.6); g.lineTo(bx + bw, by); g.closePath(); g.fill();
  // 호퍼
  const sh = o.spit ? rand(-2, 2) * s * 2 : 0;
  const hx = x - 70 * s + sh, hy = by - 8 * s;
  g.fillStyle = "#3a3026"; g.beginPath(); g.moveTo(hx - 6 * s, hy - 52 * s); g.lineTo(hx + 150 * s, hy - 52 * s); g.lineTo(hx + 120 * s, hy); g.lineTo(hx + 24 * s, hy); g.closePath(); g.fill();
  g.fillStyle = "#5a4a36"; g.fillRect(hx - 8 * s, hy - 58 * s, 160 * s, 8 * s);
  if (!dead) {
    const junk = [[20, -60, 0.4, "#8a929b"], [50, -66, -0.3, "#c9a26a"], [84, -62, 0.8, "#6b7380"], [112, -64, -0.6, "#a87a4a"], [66, -72, 0.2, "#9aa4ad"]];
    for (const [jx, jy, a, c] of junk) { g.save(); g.translate(hx + jx * s, hy + jy * s + (o.spit ? rand(-3, 3) * s : 0)); g.rotate(a); g.fillStyle = c; g.fillRect(-12 * s, -5 * s, 24 * s, 10 * s); g.restore(); }
  }
  // 굴뚝 + 연기
  for (const [cx, ch, ph] of [[bx + bw - 30 * s, 70, 0], [bx + bw - 6 * s, 52, 0.5]]) {
    const top = by - D * 0.6 - ch * s;
    g.fillStyle = "#30353b"; g.fillRect(cx, top, 16 * s, ch * s);
    g.fillStyle = "#454c55"; g.fillRect(cx - 3 * s, top, 22 * s, 6 * s);
    for (let i = 0; i < 3; i++) {
      const k = ((now / 1400 + ph + i / 3) % 1);
      g.fillStyle = dead ? `rgba(30,30,32,${0.55 * (1 - k)})` : hot ? `rgba(255,120,60,${0.4 * (1 - k)})` : `rgba(140,148,158,${0.4 * (1 - k)})`;
      g.beginPath(); g.arc(cx + 8 * s + k * 24 * s, top - 8 * s - k * 60 * s, (8 + k * 16) * s, 0, Math.PI * 2); g.fill();
    }
  }
  // 앞면
  g.fillStyle = dead ? cLin(g, 0, by, 0, by + bh, [[0, "#4a4036"], [1, "#221d18"]]) : hot ? cLin(g, 0, by, 0, by + bh, [[0, "#e0662a"], [1, "#8a2a10"]]) : cLin(g, 0, by, 0, by + bh, [[0, "#f2c230"], [1, "#b88418"]]);
  g.fillRect(bx, by, bw, bh);
  g.fillStyle = "rgba(90,50,20,0.35)"; for (const [rx, ry, r] of [[30, 20, 14], [160, 60, 18], [90, 14, 9], [176, 22, 8]]) { g.beginPath(); g.ellipse(bx + rx * s, by + ry * s, r * s, r * 0.6 * s, 0.3, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = "#6b5414"; for (let i = 0; i < 9; i++) { g.beginPath(); g.arc(bx + (12 + i * 22) * s, by + 8 * s, 2.5 * s, 0, Math.PI * 2); g.fill(); }
  // 감시 슬릿
  g.fillStyle = "#1a1d20"; cRR(g, bx + 40 * s, by + 20 * s, 120 * s, 18 * s, 9 * s); g.fill();
  if (eyeK > 0) {
    const ec = o.stun ? "#7a7f86" : hot ? "#fff0a0" : "#ff4b3a";
    const eg = g.createLinearGradient(bx + 40 * s, 0, bx + 160 * s, 0);
    eg.addColorStop(0, "rgba(255,60,40,0)"); eg.addColorStop(0.5, ec); eg.addColorStop(1, "rgba(255,60,40,0)");
    g.globalAlpha = 0.4 + eyeK * 0.6; g.fillStyle = eg; cRR(g, bx + 46 * s, by + 25 * s, 108 * s, 8 * s, 4 * s); g.fill(); g.globalAlpha = 1;
    if (!o.stun) {
      g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = eyeK;
      const gl = g.createRadialGradient(x, by + 29 * s, 2, x, by + 29 * s, 70 * s); gl.addColorStop(0, hot ? "rgba(255,220,120,0.55)" : "rgba(255,60,40,0.45)"); gl.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = gl; g.fillRect(x - 80 * s, by - 40 * s, 160 * s, 140 * s); g.restore();
    }
  }
  // 명판
  g.fillStyle = "#1b1d20"; cRR(g, bx + 74 * s, by + 46 * s, 52 * s, 14 * s, 3 * s); g.fill();
  g.fillStyle = "#f2c230"; g.font = `700 ${Math.max(6, 10 * s)}px "IBM Plex Mono", monospace`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("G-01", x, by + 53.5 * s);
  // 경고 띠
  g.save(); g.beginPath(); g.rect(bx, by + bh - 14 * s, bw, 14 * s); g.clip();
  g.fillStyle = "#1b1d20"; g.fillRect(bx, by + bh - 14 * s, bw, 14 * s);
  g.fillStyle = dead ? "#5a4a20" : "#f2c230"; for (let i = -2; i < 14; i++) { const sx = bx + i * 20 * s; g.beginPath(); g.moveTo(sx, by + bh); g.lineTo(sx + 10 * s, by + bh); g.lineTo(sx + 24 * s, by + bh - 14 * s); g.lineTo(sx + 14 * s, by + bh - 14 * s); g.fill(); }
  g.restore();
  // 입 (분쇄 롤러)
  const my = by + bh - 6 * s, mw = bw - 20 * s, mx = bx + 10 * s;
  g.fillStyle = "#0b0c0e"; cRR(g, mx, my, mw, 50 * s, 6 * s); g.fill();
  if (hot || o.suck) { g.save(); g.globalCompositeOperation = "lighter"; g.fillStyle = o.suck ? "rgba(127,224,255,0.3)" : "rgba(255,100,40,0.35)"; cRR(g, mx, my, mw, 50 * s, 6 * s); g.fill(); g.restore(); }
  for (let k = 0; k < 2; k++) {
    const ry = my + 12 * s + k * 24 * s;
    g.fillStyle = cLin(g, 0, ry - 10 * s, 0, ry + 10 * s, [[0, "#c9d0d6"], [0.5, "#7c858e"], [1, "#2c3238"]]);
    cRR(g, mx + 6 * s, ry - 10 * s, mw - 12 * s, 20 * s, 10 * s); g.fill();
    g.fillStyle = "#e8edf2";
    const n = 12, off = ((rot * (k ? -1 : 1)) % 1 + 1) % 1;
    for (let i = 0; i < n; i++) {
      const tx = mx + 14 * s + ((i + off) % n / n) * (mw - 28 * s);
      g.beginPath();
      if (k === 0) { g.moveTo(tx - 6 * s, ry + 8 * s); g.lineTo(tx, ry + 18 * s); g.lineTo(tx + 6 * s, ry + 8 * s); }
      else { g.moveTo(tx - 6 * s, ry - 8 * s); g.lineTo(tx, ry - 18 * s); g.lineTo(tx + 6 * s, ry - 8 * s); }
      g.closePath(); g.fill();
    }
  }
  // 옆 경고등
  const blink = o.warn ? Math.floor(now / 90) % 2 === 0 : true;
  for (const lx of [bx - 6 * s, bx + bw + 6 * s]) { g.fillStyle = dead ? "#3a2a26" : !blink ? "#4a1f1a" : hot ? "#fff0a0" : "#ff4b3a"; g.beginPath(); g.arc(lx, by + 30 * s, 6 * s, 0, Math.PI * 2); g.fill(); g.fillStyle = "#30353b"; g.fillRect(lx - 4 * s, by + 36 * s, 8 * s, 10 * s); }
  // 피격·빙결 덧칠
  if (o.flash || o.frozen) {
    g.save(); g.globalCompositeOperation = "lighter"; g.fillStyle = o.frozen ? "rgba(127,224,255,0.35)" : "rgba(255,255,255,0.45)";
    g.fillRect(bx, by, bw, bh + 44 * s); g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + D, by - D * 0.6); g.lineTo(bx + bw + D, by - D * 0.6); g.lineTo(bx + bw + D, by + bh - D * 0.6); g.lineTo(bx + bw, by + bh); g.lineTo(bx + bw, by); g.closePath(); g.fill(); g.restore();
  }
  if (hot && !dead) { g.save(); g.globalCompositeOperation = "lighter"; for (let i = 0; i < 10; i++) { const a = Math.random() * Math.PI * 2, r = Math.random() * 110 * s; g.fillStyle = Math.random() < 0.5 ? "rgba(255,200,90,0.8)" : "rgba(255,110,40,0.7)"; g.beginPath(); g.arc(x + Math.cos(a) * r, by + bh / 2 + Math.sin(a) * r * 0.6, (1 + Math.random() * 2.5) * s * 1.6, 0, Math.PI * 2); g.fill(); } g.restore(); }
  return by - 60 * s;
}
const BOSS_S = 0.55;
function drawBoss(e) {
  if (e.kind === "multiarm") { drawMultiarm(e); return; }
  if (e.kind === "qc9") { drawQC9(e); return; }
  const jit = e.state === "windup" || e.state === "rage" ? rand(-1.5, 1.5) : 0;
  const X = e.x + jit, Y = syf(e.y, dropZ(e)) + e.r * SY * 0.45;
  const top = drawGrinderBody(ctx, X, Y, BOSS_S, {
    hot: e.p2, roll: e.roll, flash: e.flash > 0, frozen: e.frozen > 0, stun: e.state === "stun", suck: e.state === "suck", spit: e.state === "spitWind",
    warn: e.state === "windup" || e.state === "spitWind" || e.state === "rage",
    eye: e.state === "windup" || e.state === "spitWind" || e.state === "rage" ? 0.7 + 0.3 * Math.sin(performance.now() / 50) : 0.55,
  });
  if (e.state === "stun") {
    ctx.fillStyle = C.hazard;
    for (let i = 0; i < 4; i++) { const a = performance.now() / 220 + i * Math.PI / 2; ctx.beginPath(); ctx.arc(X + Math.cos(a) * 40, top - 6 + Math.sin(a) * 8, 4, 0, Math.PI * 2); ctx.fill(); }
  }
}
function drawWreck(w) {
  if (w.kind === "qc9") { drawQCBody(ctx, w.x, syf(w.y) + QC.hover - 30, QC_S, { dead: true }); return; }
  if (w.kind === "multiarm") { drawMultiBody(ctx, w.x, syf(w.y) + MA.r * SY * 0.4, MA_S, { dead: true, rot: w.rot }); return; }
  drawGrinderBody(ctx, w.x, syf(w.y) + BOSS.r * SY * 0.45, BOSS_S, { dead: true, roll: w.roll });
}
function drawBossBar() {
  const b = room.boss;
  if (!b || !room.bossSpawned || (b.dead && !(room.bossDeadT > 0))) return;
  if (b.kind === "qc9") { drawQCBar(b); return; }
  if (b.kind === "multiarm") { if (b.lagT > 0) b.lagT -= 1 / 60; else if (b.hpLag > b.hp) b.hpLag = Math.max(b.hp, b.hpLag - b.maxHp * 0.25 / 60); drawMultiBar(b); return; }
  const w = 420, x = W / 2 - w / 2, y = 82;
  if (b.lagT > 0) b.lagT -= 1 / 60; else if (b.hpLag > b.hp) b.hpLag = Math.max(b.hp, b.hpLag - b.maxHp * 0.25 / 60);
  ctx.save();
  ctx.fillStyle = "rgba(10,12,14,0.8)"; ctx.fillRect(x - 10, y - 22, w + 20, 40);
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.font = '700 12px "IBM Plex Sans KR", sans-serif';
  ctx.fillStyle = C.text; ctx.fillText("그라인더 G-01", x, y - 10);
  ctx.textAlign = "right"; ctx.fillStyle = b.p2 ? "#ff7a33" : C.muted; ctx.fillText(b.hp <= 0 ? "파괴됨" : b.p2 ? "과열" : "1구역 보스", x + w, y - 10);
  ctx.fillStyle = "#2b1a18"; ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillRect(x, y, w * clamp(b.hpLag / b.maxHp, 0, 1), 10);
  ctx.fillStyle = b.p2 ? "#ff7a33" : C.danger; ctx.fillRect(x, y, w * clamp(b.hp / b.maxHp, 0, 1), 10);
  ctx.strokeStyle = C.hazard; ctx.lineWidth = 1.5; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, 11);
  ctx.fillStyle = C.hazard; ctx.fillRect(x + w * BOSS.p2At - 1, y - 3, 2, 16);
  ctx.restore();
}
function startBossTest() {
  startRun();
  run.test = true;
  // 보스방에 도착했을 때와 비슷하게: 무작위 모듈 3개(희귀)
  const slots = shuffleWith(Math.random, SLOT_ORDER).slice(0, 3);
  for (const sl of slots) { const ids = Object.keys(MODS).filter((id) => MODS[id].slot === sl); player.mods[sl] = { id: ids[Math.floor(Math.random() * ids.length)], r: 1 }; }
  recalcStats();
  room.n = ZONE_ROOMS - 1;
  enterDoor({ type: "boss" });
}

// ================= 새 적: 폭발 드럼통 · 방패 지게차 =================
const DRUM = { hp: 20, r: 12, sp: 150, fuse: 1.0, trig: 62, R: 75, dmgP: 20, dmgE: 30, delay: 0.5 };
const LIFT = { hp: 90, r: 20, sp: 60, turn: Math.PI / 2, block: 1.05, tele: 0.7, ramSp: 520, ramT: 0.35, after: 1.0, stun: 1.5, dmg: 18, cd: 2.2 };
let booms = [];
function drumBoom(x, y) {
  const p = player, at = { x, y };
  waves.push({ x, y, t: 0, max: 0.35, R: DRUM.R, col: "#ff8a3a" });
  burst(x, y, 26, "#ffb347", 320, 0.5, 3.2); burst(x, y, 10, "#fff0a0", 200, 0.3, 2.6); debris(x, y, 7, C.spark);
  hitstop = Math.max(hitstop, 0.05); shake(10); sfx("explode"); buzz(30);
  if (!p.dead && p.z < 40 && dist(p, at) < DRUM.R + p.r * 0.5) hurtPlayer(DRUM.dmgP, at, "폭발 드럼통에 휘말렸어요");
  for (const o of enemies) if (!o.dead && !(o.drop > 0) && dist(o, at) < DRUM.R + o.r) hurtEnemy(o, DRUM.dmgE, angTo(at, o), 300, false, "proc", "#ff8a3a");
  for (const b of bolts) if (!b.dead && dist(b, at) < DRUM.R) b.dead = true;
  room.cracks.push({ x, y, seed: Math.random() * 10 });
}
function updateBooms(dt) {
  const list = booms; booms = [];
  for (const b of list) {
    b.t -= dt;
    if (b.vx || b.vy) {
      b.x += b.vx * dt; b.y += b.vy * dt; b.vx -= b.vx * Math.min(1, dt * 3); b.vy -= b.vy * Math.min(1, dt * 3);
      if (collideWorld(b, false)) { b.vx *= -0.3; b.vy *= -0.3; }
      if (Math.hypot(b.vx, b.vy) > 60 && enemies.some((o) => !o.dead && !(o.drop > 0) && dist(o, b) < o.r + b.r + 2)) b.t = 0;
    }
    if (b.t <= 0) drumBoom(b.x, b.y); else booms.push(b);
  }
}
function updateDrum(e, dt, dp, ap) {
  const p = player;
  if (e.fly > 0) {
    e.fly -= dt;
    // 날아가다 다른 적에 부딪히면 그 자리에서 폭발
    for (const o of enemies) if (o !== e && !o.dead && !(o.drop > 0) && dist(o, e) < o.r + e.r + 2) { e.state = "fuse"; e.hp = 0; killEnemy(e); return; }
  }
  if (e.state === "chase") {
    if (!p.dead && e.fly <= 0) { const sp = DRUM.sp * (1 - 0.1 * (e.chillS || 0)); e.x += Math.cos(ap) * sp * dt; e.y += Math.sin(ap) * sp * dt; e.roll += dt * 12; }
    if (!p.dead && e.fly <= 0 && dp < DRUM.trig + p.r && los(e, p)) { e.state = "fuse"; e.t = DRUM.fuse; sfx("windup"); }
  } else if (e.state === "fuse") {
    e.t -= dt;
    if (e.t <= 0) { e.dead = true; drumBoom(e.x, e.y); }
  }
}
function updateLift(e, dt, dp, ap) {
  const p = player;
  if (e.blockT > 0) e.blockT -= dt;
  if (e.state === "chase") {
    const turn = LIFT.turn * (1 - 0.1 * (e.chillS || 0));
    if (!p.dead) e.face += clamp(angDiff(e.face, ap), -turn * dt, turn * dt);
    const fw = Math.max(0, Math.cos(angDiff(e.face, ap)));
    if (!p.dead && dp > e.r + p.r + 10) { e.x += Math.cos(e.face) * LIFT.sp * fw * dt; e.y += Math.sin(e.face) * LIFT.sp * fw * dt; e.roll += dt * fw * 4; }
    e.cd -= dt;
    if (!p.dead && e.cd <= 0 && dp < 230 && Math.abs(angDiff(e.face, ap)) < 0.3 && los(e, p)) { e.state = "tele"; e.t = LIFT.tele; sfx("windup"); }
  } else if (e.state === "tele") {
    e.t -= dt;
    if (e.t <= 0) { e.state = "ram"; e.t = LIFT.ramT; e.hitPlayer = false; sfx("dash"); }
  } else if (e.state === "ram") {
    e.t -= dt;
    e.x += Math.cos(e.face) * LIFT.ramSp * dt; e.y += Math.sin(e.face) * LIFT.ramSp * dt; e.roll += dt * 20;
    if (Math.random() < 0.7) particles.push({ x: e.x - Math.cos(e.face) * 18, y: e.y - Math.sin(e.face) * 18, z: 3, vz: rand(20, 80), vx: rand(-40, 40), vy: rand(-40, 40), life: 0.3, max: 0.3, color: "#6b6f74", size: rand(3, 5), glow: false, nograv: true });
    if (!e.hitPlayer && !p.dead && p.z < 24 && dp < e.r + p.r + 6) { e.hitPlayer = true; hurtPlayer(LIFT.dmg, e, "방패 지게차에 들이받혔어요"); if (p.inv > 0.5) { p.kx += Math.cos(e.face) * 260; p.ky += Math.sin(e.face) * 260; } }
    if (e.t <= 0) { e.state = "after"; e.t = LIFT.after; }
  } else if (e.state === "after" || e.state === "stun") {
    e.t -= dt;
    if (e.t <= 0) { e.state = "chase"; e.cd = LIFT.cd; }
  }
}
// 방패 막기: 앞쪽에서 들어온 직접 공격만. 상태이상(proc)·내려찍기·장판은 통과
function liftBlocks(e, ang, src) {
  if (e.type !== "lift" || ang === null || src === "proc" || src === "slam" || e.state === "stun" || e.frozen > 0) return false;
  if (Math.abs(angDiff(e.face, ang + Math.PI)) >= LIFT.block) return false;
  const sx = e.x + Math.cos(e.face) * (e.r + 2), sy = e.y + Math.sin(e.face) * (e.r + 2);
  burst(sx, sy, 5, "#bff3ff", 180, 0.2, 2, ang + Math.PI, 0.8);
  e.flash = 0.04;
  if (!(e.blockT > 0)) { e.blockT = 0.3; addText(sx, sy - 10, "막힘", "#7fe0ff", false); sfx("clank"); }
  if (src === "atk" && player.weapon === "wrench" && dist(player, e) < 110) { player.kx += Math.cos(ang + Math.PI) * 170; player.ky += Math.sin(ang + Math.PI) * 170; }
  return true;
}

// ---------- 그리기 ----------
function drawBarrel(e) {
  const flash = e.flash > 0, z0 = dropZ(e), s = 0.55;
  const lit = e.state === "fuse", blinkOn = lit ? Math.floor(performance.now() / (e.t < 0.4 ? 50 : 100)) % 2 === 0 : Math.floor(performance.now() / 500) % 2 === 0;
  const bob = e.state === "chase" ? Math.abs(Math.sin(e.roll)) * 1.5 : 0;
  const x = e.x + (lit ? rand(-1, 1) : 0), y = syf(e.y, z0 + bob) + 4;
  const w = 46 * s, h = 58 * s, top = y - 10 * s - h, rx = w / 2, ry = 9 * s;
  ctx.fillStyle = "#1e2226"; for (const dx of [-15, 15]) { ctx.beginPath(); ctx.ellipse(x + dx * s, y - 6 * s, 8 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill(); }
  const body = flash ? [[0, "#fff"], [1, "#fff"]] : lit && blinkOn ? [[0, "#ff8a5a"], [0.4, "#ffd0a0"], [1, "#a8341a"]] : [[0, "#a8341a"], [0.35, "#e0662a"], [1, "#6a1f0e"]];
  ctx.fillStyle = cLin(ctx, x - rx, 0, x + rx, 0, body);
  ctx.fillRect(x - rx, top, w, h); ctx.beginPath(); ctx.ellipse(x, top + h, rx, ry, 0, 0, Math.PI); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.rect(x - rx, top + h * 0.4, w, 12 * s); ctx.clip();
  ctx.fillStyle = "#1b1d20"; ctx.fillRect(x - rx, top + h * 0.4, w, 12 * s);
  ctx.fillStyle = "#f2c230"; for (let i = -2; i < 8; i++) { const sx = x - rx + i * 10 * s; ctx.beginPath(); ctx.moveTo(sx, top + h * 0.4 + 12 * s); ctx.lineTo(sx + 5 * s, top + h * 0.4 + 12 * s); ctx.lineTo(sx + 12 * s, top + h * 0.4); ctx.lineTo(sx + 7 * s, top + h * 0.4); ctx.fill(); }
  ctx.restore();
  const ey = top + h * 0.24;
  ctx.fillStyle = "#2a0f08"; cRR(ctx, x - 13 * s, ey - 5 * s, 26 * s, 10 * s, 5 * s); ctx.fill();
  ctx.fillStyle = lit ? "#fff0a0" : "#ffd23f";
  if (lit) { ctx.beginPath(); ctx.moveTo(x - 10 * s, ey - 3 * s); ctx.lineTo(x - 3 * s, ey + 1 * s); ctx.lineTo(x - 10 * s, ey + 3 * s); ctx.fill(); ctx.beginPath(); ctx.moveTo(x + 10 * s, ey - 3 * s); ctx.lineTo(x + 3 * s, ey + 1 * s); ctx.lineTo(x + 10 * s, ey + 3 * s); ctx.fill(); }
  else { ctx.beginPath(); ctx.arc(x - 6 * s, ey, 2.6 * s, 0, Math.PI * 2); ctx.arc(x + 6 * s, ey, 2.6 * s, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = flash ? "#fff" : lit && blinkOn ? "#ffb58a" : "#c24a20"; ctx.beginPath(); ctx.ellipse(x, top, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#30353b"; ctx.fillRect(x + 6 * s, top - 12 * s, 4 * s, 10 * s);
  ctx.fillStyle = blinkOn ? "#ff4b3a" : "#5a1a14"; ctx.beginPath(); ctx.arc(x + 8 * s, top - 14 * s, 5 * s, 0, Math.PI * 2); ctx.fill();
  if (blinkOn) { const lg = ctx.createRadialGradient(x + 8 * s, top - 14 * s, 1, x + 8 * s, top - 14 * s, lit ? 26 : 14); lg.addColorStop(0, "rgba(255,80,50,0.6)"); lg.addColorStop(1, "rgba(255,80,50,0)"); ctx.fillStyle = lg; ctx.fillRect(x - 30, top - 45, 70, 60); }
  return z0 + 44;
}
// 회전하는 직육면체 (지게차용). 앞면(0번)은 +x 방향
function box3(cx, cy, ang, len, wid, z0, h, cTop, cSide, cFront) {
  const ca = Math.cos(ang), sa = Math.sin(ang), hl = len / 2, hw = wid / 2;
  const P = [[hl, -hw], [hl, hw], [-hl, hw], [-hl, -hw]].map(([lx, ly]) => ({ x: cx + lx * ca - ly * sa, y: cy + lx * sa + ly * ca }));
  for (let i = 0; i < 4; i++) {
    const a = P[i], b = P[(i + 1) % 4], my = (a.y + b.y) / 2 - cy, mx = (a.x + b.x) / 2 - cx;
    if (my < -0.01) continue;
    ctx.fillStyle = i === 0 && cFront ? cFront : cSide;
    ctx.beginPath(); ctx.moveTo(a.x, syf(a.y, z0)); ctx.lineTo(b.x, syf(b.y, z0)); ctx.lineTo(b.x, syf(b.y, z0 + h)); ctx.lineTo(a.x, syf(a.y, z0 + h)); ctx.closePath(); ctx.fill();
    if (mx > 0.01) { ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fill(); }
  }
  ctx.fillStyle = cTop; ctx.beginPath(); P.forEach((q, i) => (i ? ctx.lineTo(q.x, syf(q.y, z0 + h)) : ctx.moveTo(q.x, syf(q.y, z0 + h)))); ctx.closePath(); ctx.fill();
  return P;
}
function drawLift(e) {
  const flash = e.flash > 0, z0 = dropZ(e), f = e.face, ca = Math.cos(f), sa = Math.sin(f);
  const jit = e.state === "tele" ? rand(-1.2, 1.2) : 0, X = e.x + jit, Y = e.y;
  const at = (o) => ({ x: X + ca * o, y: Y + sa * o });
  const W_ = (c) => (flash ? "#ffffff" : c);
  // 바퀴
  for (const [lx, ly] of [[11, -13], [11, 13], [-11, -13], [-11, 13]]) { const wx = X + lx * ca - ly * sa, wy = Y + lx * sa + ly * ca; ctx.fillStyle = "#1a1d20"; ctx.beginPath(); ctx.ellipse(wx, syf(wy, z0 + 4), 6, 5, 0, 0, Math.PI * 2); ctx.fill(); }
  const down = e.state === "stun";
  const parts = [
    { o: -2, z: 4, k: 0, f: (c) => box3(c.x, c.y, f, 34, 26, z0 + 4, 14, W_("#f2c230"), W_("#b88418"), W_("#d9a828")) },
    { o: -17, z: 4, k: 0.5, f: (c) => box3(c.x, c.y, f, 7, 24, z0 + 4, 19, W_("#59616b"), W_("#30353b"), W_("#3a4047")) },
    { o: -5, z: 18, k: 9, f: (c) => {
      box3(c.x, c.y, f, 13, 17, z0 + 18, 13, W_("#e8edf2"), W_("#9aa4ad"), W_("#c9d0d6"));
      if (sa > -0.35) { const fx = c.x + ca * 7, fy = c.y + sa * 7, px = -sa, py = ca; ctx.fillStyle = e.state === "tele" || e.state === "ram" ? C.danger : e.state === "stun" ? "#777" : C.eye; for (const k of [-4, 4]) { ctx.beginPath(); ctx.arc(fx + px * k, syf(fy + py * k, z0 + 25), 2.2, 0, Math.PI * 2); ctx.fill(); } }
    } },
    { o: 14, z: 4, k: 2, f: (c) => box3(c.x, c.y, f, 4, 22, z0 + 4, down ? 14 : 32, W_("#454c55"), W_("#30353b"), W_("#3a4047")) },
    { o: down ? 26 : 21, z: 6, k: 3, f: (c) => {
      const zb = z0 + (down ? 1 : 6), hh = down ? 5 : 34;
      const P = box3(c.x, c.y, f, 4, 40, zb, hh, W_(down ? "#7c858e" : "#dfe5ea"), W_("#7c858e"), W_("#a9b2ba"));
      if (!down && !flash && (P[0].y + P[1].y) / 2 - c.y > 0.01) {
        ctx.fillStyle = C.hazardDark; ctx.beginPath(); ctx.moveTo(P[0].x, syf(P[0].y, zb + hh - 4)); ctx.lineTo(P[1].x, syf(P[1].y, zb + hh - 4)); ctx.lineTo(P[1].x, syf(P[1].y, zb + hh - 12)); ctx.lineTo(P[0].x, syf(P[0].y, zb + hh - 12)); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = C.hazard; ctx.lineWidth = 2; ctx.beginPath();
        for (let i = 1; i < 6; i++) { const t = i / 6, x = P[0].x + (P[1].x - P[0].x) * t, y = P[0].y + (P[1].y - P[0].y) * t; ctx.moveTo(x - 3, syf(y, zb + hh - 5)); ctx.lineTo(x + 3, syf(y, zb + hh - 11)); }
        ctx.stroke();
      }
    } },
  ];
  parts.map((q) => ({ ...q, c: at(q.o) })).sort((a, b) => a.c.y + a.k - (b.c.y + b.k)).forEach((q) => q.f(q.c));
  if (e.state === "stun") { ctx.fillStyle = C.hazard; for (let i = 0; i < 3; i++) { const a = performance.now() / 200 + i * 2.1; ctx.beginPath(); ctx.arc(X + Math.cos(a) * 16, syf(Y, z0 + 44) + Math.sin(a) * 4, 2.5, 0, Math.PI * 2); ctx.fill(); } }
  return z0 + 46;
}
function drawNewEnemyMarks(e) {
  if (e.type === "drum" && e.state === "fuse") {
    const k = 1 - e.t / DRUM.fuse;
    ctx.save(); ctx.translate(e.x, syf(e.y)); ctx.scale(1, SY);
    ctx.globalAlpha = 0.15 + k * 0.3; ctx.fillStyle = C.danger; ctx.beginPath(); ctx.arc(0, 0, DRUM.R * k, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.85; ctx.strokeStyle = C.danger; ctx.lineWidth = 2.5; ctx.setLineDash([9, 6]); ctx.beginPath(); ctx.arc(0, 0, DRUM.R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  if (e.type === "lift") {
    ctx.save(); ctx.translate(e.x, syf(e.y)); ctx.scale(1, SY);
    if (e.state !== "stun" && !(e.frozen > 0)) { ctx.globalAlpha = 0.35; ctx.strokeStyle = "#7fe0ff"; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, e.r + 12, e.face - LIFT.block, e.face + LIFT.block); ctx.stroke(); }
    if (e.state === "tele") {
      const k = 1 - e.t / LIFT.tele; ctx.rotate(e.face);
      ctx.globalAlpha = 0.2 + k * 0.35; ctx.fillStyle = C.danger; ctx.fillRect(e.r, -e.r, 180, e.r * 2);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = C.danger; ctx.lineWidth = 2.5; ctx.setLineDash([10, 7]); ctx.strokeRect(e.r, -e.r, 180, e.r * 2);
    }
    ctx.restore();
  }
}
function drawBooms() {
  for (const b of booms) {
    if (Math.hypot(b.vx || 0, b.vy || 0) > 60) continue; // 날아가는 중엔 범위 표시 생략
    const blink = Math.floor(performance.now() / 60) % 2 === 0;
    ctx.save(); ctx.translate(b.x, syf(b.y)); ctx.scale(1, SY);
    ctx.globalAlpha = blink ? 0.4 : 0.2; ctx.fillStyle = C.danger; ctx.beginPath(); ctx.arc(0, 0, DRUM.R, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 0.9; ctx.strokeStyle = "#fff0a0"; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, DRUM.R, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}

// ================= 구역 =================
const ZONES = 3; // 지금까지 만든 구역 수
const zoneOf = (n) => Math.ceil(n / ZONE_ROOMS);
const localN = (n) => (n - 1) % ZONE_ROOMS + 1;
const curZone = () => (room ? zoneOf(room.n) : 1);
const ZONE_NAME = { 1: "폐기장", 2: "조립 라인", 3: "품질 검사실" };
function roomLabel(n) { return zoneOf(n) + "구역 " + localN(n) + "/" + ZONE_ROOMS; }

// ================= 2구역 함정: 컨베이어 벨트 · 프레스 =================
const BELT = { sp: 90, w: 60 };
const PRESS = { r: 34, warn: 1.0, drop: 0.08, hold: 0.3, rise: 0.45, dmgP: 25, dmgE: 60, top: 60 };
function genBelts(rng, doors) {
  const belts = [];
  const want = 1 + (rng() < 0.5 ? 1 : 0);
  let tries = 0;
  while (belts.length < want && tries++ < 200) {
    const horiz = rng() < 0.55;
    const len = horiz ? 340 + Math.floor(rng() * 5) * 40 : 240 + Math.floor(rng() * 4) * 40;
    const w = horiz ? len : BELT.w, h = horiz ? BELT.w : len;
    const x = Math.round((RX0 + 40 + rng() * (RX1 - RX0 - 80 - w)) / 8) * 8;
    const y = Math.round((RY0 + 110 + rng() * (RY1 - RY0 - 200 - h)) / 8) * 8;
    const b = { x, y, w, h, dir: horiz ? (rng() < 0.5 ? 0 : Math.PI) : (rng() < 0.5 ? Math.PI / 2 : -Math.PI / 2) };
    if (inRect(W / 2, RY1 - 60, b, 70)) continue;
    if (belts.some((q) => x < q.x + q.w + 40 && x + w > q.x - 40 && y < q.y + q.h + 40 && y + h > q.y - 40)) continue;
    belts.push(b);
  }
  return belts;
}
function genPresses(rng, count, obstacles) {
  const ps = [];
  let tries = 0;
  while (ps.length < count && tries++ < 300) {
    const q = { x: RX0 + 90 + rng() * (RX1 - RX0 - 180), y: RY0 + 130 + rng() * (RY1 - RY0 - 260), r: PRESS.r };
    if (dist(q, { x: W / 2, y: RY1 - 60 }) < 160) continue;
    if (obstacles.some((o) => inRect(q.x, q.y, o, PRESS.r + 8))) continue;
    if (ps.some((o) => dist(o, q) < 130)) continue;
    ps.push({ ...q, state: "idle", t: 1.2 + ps.length * 0.9 + rng() * 0.8, z: PRESS.top });
  }
  return ps;
}
function onBelt(e) { for (const b of room.belts || []) if (inRect(e.x, e.y, b)) return b; return null; }
function beltPush(e, dt) { const b = onBelt(e); if (b) { e.x += Math.cos(b.dir) * BELT.sp * dt; e.y += Math.sin(b.dir) * BELT.sp * dt; } }
function updatePresses(dt) {
  const ps = room.presses; if (!ps || !ps.length) return;
  const p = player, active = room.wave > 0 && !room.cleared;
  for (const q of ps) {
    q.t -= dt;
    if (q.state === "idle") { q.z = PRESS.top; if (q.t <= 0 && active) { q.state = "warn"; q.t = PRESS.warn; } else if (q.t <= 0) q.t = 0.5; }
    else if (q.state === "warn") { if (q.t <= 0) { q.state = "drop"; q.t = PRESS.drop; } }
    else if (q.state === "drop") {
      q.z = PRESS.top * Math.max(0, q.t / PRESS.drop);
      if (q.t <= 0) {
        q.state = "hold"; q.t = PRESS.hold; q.z = 0;
        shake(7); sfx("slam");
        burst(q.x, q.y, 14, "#9aa4ad", 260, 0.35, 2.6);
        room.cracks.push({ x: q.x, y: q.y, seed: Math.random() * 10 });
        if (!p.dead && p.z < 40 && dist(p, q) < q.r + p.r * 0.5) hurtPlayer(PRESS.dmgP, q, "프레스에 눌렸어요");
        for (const e of enemies) if (!e.dead && !(e.drop > 0) && e.type !== "drone" && e.type !== "boss" && dist(e, q) < q.r + e.r * 0.5) hurtEnemy(e, PRESS.dmgE, angTo(q, e), 200, false, "proc", "#c9d0d6");
      }
    } else if (q.state === "hold") { if (q.t <= 0) { q.state = "rise"; q.t = PRESS.rise; } }
    else if (q.state === "rise") { q.z = PRESS.top * (1 - Math.max(0, q.t / PRESS.rise)); if (q.t <= 0) { q.state = "idle"; q.t = 1.6 + Math.random() * 1.2; } }
  }
}
function drawBelts() {
  const bs = room.belts; if (!bs || !bs.length) return;
  const now = performance.now() / 1000;
  for (const b of bs) {
    const x0 = b.x, x1 = b.x + b.w, y0 = syf(b.y), y1 = syf(b.y + b.h), horiz = b.w > b.h;
    ctx.save(); ctx.beginPath(); ctx.rect(x0, y0, x1 - x0, y1 - y0); ctx.clip();
    ctx.fillStyle = "#14191f"; ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    // 롤러 줄
    const off = (now * BELT.sp) % 16, sgn = Math.cos(b.dir) + Math.sin(b.dir);
    ctx.strokeStyle = "#232b33"; ctx.lineWidth = 3; ctx.beginPath();
    if (horiz) for (let x = x0 - 16; x < x1 + 16; x += 16) { const xx = x + off * sgn; ctx.moveTo(xx, y0); ctx.lineTo(xx, y1); }
    else for (let y = b.y - 16; y < b.y + b.h + 16; y += 16) { const yy = syf(y + off * sgn); ctx.moveTo(x0, yy); ctx.lineTo(x1, yy); }
    ctx.stroke();
    // 흐르는 화살표
    const aoff = (now * BELT.sp) % 48;
    ctx.strokeStyle = room.beltWarn && Math.floor(performance.now() / 120) % 2 ? "rgba(255,90,70,0.85)" : "rgba(110,170,255,0.45)"; ctx.lineWidth = 3; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.beginPath();
    if (horiz) {
      const cy = b.y + b.h / 2, d = Math.cos(b.dir);
      for (let x = b.x - 48; x < b.x + b.w + 48; x += 48) { const ax = x + aoff * d; ctx.moveTo(ax - 7 * d, syf(cy - 10)); ctx.lineTo(ax + 5 * d, syf(cy)); ctx.lineTo(ax - 7 * d, syf(cy + 10)); }
    } else {
      const cx = b.x + b.w / 2, d = Math.sin(b.dir);
      for (let y = b.y - 48; y < b.y + b.h + 48; y += 48) { const ay = y + aoff * d; ctx.moveTo(cx - 10, syf(ay - 7 * d)); ctx.lineTo(cx, syf(ay + 5 * d)); ctx.lineTo(cx + 10, syf(ay - 7 * d)); }
    }
    ctx.stroke();
    ctx.restore();
    // 가장자리 레일
    ctx.fillStyle = "#3a4552";
    if (horiz) { ctx.fillRect(x0, y0 - 2, x1 - x0, 4); ctx.fillRect(x0, y1 - 2, x1 - x0, 4); }
    else { ctx.fillRect(x0 - 2, y0, 4, y1 - y0); ctx.fillRect(x1 - 2, y0, 4, y1 - y0); }
  }
}
function drawPressMarks() {
  for (const q of room.presses || []) {
    ctx.save(); ctx.translate(q.x, syf(q.y)); ctx.scale(1, SY);
    if (q.state === "warn") {
      const k = 1 - q.t / PRESS.warn;
      ctx.fillStyle = `rgba(0,0,0,${0.2 + k * 0.4})`; ctx.beginPath(); ctx.arc(0, 0, q.r * (0.5 + k * 0.5), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.5 + k * 0.5; ctx.strokeStyle = C.danger; ctx.lineWidth = 3; ctx.setLineDash([8, 6]); ctx.beginPath(); ctx.arc(0, 0, q.r, 0, Math.PI * 2); ctx.stroke();
    } else {
      ctx.fillStyle = "rgba(0,0,0,0.22)"; ctx.beginPath(); ctx.arc(0, 0, q.r * (q.state === "hold" ? 1 : 0.5), 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.35; ctx.strokeStyle = C.hazard; ctx.lineWidth = 2; ctx.setLineDash([5, 7]); ctx.beginPath(); ctx.arc(0, 0, q.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
}
function drawPress(q) {
  const jit = q.state === "warn" ? rand(-1, 1) : 0, x = q.x + jit, z = q.z;
  const s = q.r * 1.55;
  if (q.state === "warn" || q.state === "idle") { // 바닥까지 안내선
    ctx.save(); ctx.globalAlpha = q.state === "warn" ? 0.8 : 0.25; ctx.strokeStyle = q.state === "warn" ? C.danger : C.hazard; ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
    ctx.beginPath(); ctx.moveTo(x, syf(q.y, z)); ctx.lineTo(x, syf(q.y, 2)); ctx.stroke(); ctx.restore();
  }
  // 피스톤 막대
  ctx.fillStyle = "#59616b"; ctx.fillRect(x - 6, syf(q.y, 190), 12, syf(q.y, z + 20) - syf(q.y, 190));
  ctx.fillStyle = "#7c858e"; ctx.fillRect(x - 6, syf(q.y, 190), 4, syf(q.y, z + 20) - syf(q.y, 190));
  const P = box3(x, q.y, 0, s, s, z, 20, "#8a96a3", "#4a5562", "#5d6a78");
  // 앞면 경고 띠
  const fy = q.y + s / 2;
  ctx.save(); ctx.beginPath(); ctx.rect(x - s / 2, syf(fy, z + 14), s, 8); ctx.clip();
  ctx.fillStyle = C.hazardDark; ctx.fillRect(x - s / 2, syf(fy, z + 14), s, 8);
  ctx.fillStyle = q.state === "warn" && Math.floor(performance.now() / 90) % 2 ? C.danger : C.hazard;
  for (let i = -1; i < s / 10 + 1; i++) { const sx = x - s / 2 + i * 10; ctx.beginPath(); ctx.moveTo(sx, syf(fy, z + 6)); ctx.lineTo(sx + 5, syf(fy, z + 6)); ctx.lineTo(sx + 11, syf(fy, z + 14)); ctx.lineTo(sx + 6, syf(fy, z + 14)); ctx.fill(); }
  ctx.restore();
}

// ================= 2구역 새 적: 드론 떼 · 수리봇 =================
const DRONE = { hp: 8, r: 9, z: 26, sp: 170, aimT: 0.45, diveT: 0.38, diveSp: 430, dmg: 6 };
const MEDIC = { hp: 40, r: 13, sp: 80, flee: 150, range: 190, heal: 8 };
function updateDrone(e, dt, dp, ap) {
  const p = player;
  e.bob += dt * 6;
  if (e.state === "orbit") {
    e.ang += e.spin * 1.1 * dt;
    const tx = p.x + Math.cos(e.ang) * e.orbitR, ty = p.y + Math.sin(e.ang) * e.orbitR * 0.85;
    const a = Math.atan2(ty - e.y, tx - e.x), d = Math.hypot(tx - e.x, ty - e.y), sp = Math.min(DRONE.sp * (1 - 0.1 * (e.chillS || 0)), d * 4);
    e.x += Math.cos(a) * sp * dt; e.y += Math.sin(a) * sp * dt;
    e.cd -= dt;
    if (!p.dead && e.cd <= 0) {
      const busy = enemies.filter((o) => o.type === "drone" && !o.dead && (o.state === "aim" || o.state === "dive")).length;
      if (busy < 2) { e.state = "aim"; e.t = DRONE.aimT; e.aim = ap; } else e.cd = 0.4;
    }
  } else if (e.state === "aim") {
    e.t -= dt; if (e.t > 0.15) e.aim = ap;
    if (e.t <= 0) { e.state = "dive"; e.t = DRONE.diveT; e.hitPlayer = false; sfx("dash"); }
  } else if (e.state === "dive") {
    e.t -= dt;
    e.x += Math.cos(e.aim) * DRONE.diveSp * dt; e.y += Math.sin(e.aim) * DRONE.diveSp * dt;
    if (!e.hitPlayer && !p.dead && p.z < 44 && dp < e.r + p.r) { e.hitPlayer = true; hurtPlayer(DRONE.dmg, e, "드론 떼에 쪼였어요"); }
    if (e.t <= 0) { e.state = "orbit"; e.cd = 2 + Math.random() * 2.2; }
  }
}
function medicAlly(e) {
  let best = null, bv = 9;
  for (const o of enemies) {
    if (o === e || o.dead || o.drop > 0 || o.type === "boss") continue;
    const d = dist(e, o); if (d > 320) continue;
    const v = o.hp < o.maxHp ? o.hp / o.maxHp : 2 + d / 1000;
    if (v < bv) { bv = v; best = o; }
  }
  return best;
}
function updateMedic(e, dt, dp, ap) {
  const p = player;
  e.bob += dt * 5;
  const ally = medicAlly(e);
  let mx = 0, my = 0, sp = MEDIC.sp;
  if (!p.dead && dp < MEDIC.flee) { mx = -Math.cos(ap); my = -Math.sin(ap); sp = MEDIC.sp * 1.2; }
  else if (ally) {
    const awa = angTo(p, ally), tx = ally.x + Math.cos(awa) * 80, ty = ally.y + Math.sin(awa) * 80, d = Math.hypot(tx - e.x, ty - e.y);
    if (d > 12) { mx = (tx - e.x) / d; my = (ty - e.y) / d; }
  } else if (!p.dead) { mx = -Math.cos(ap) * 0.5; my = -Math.sin(ap) * 0.5; }
  sp *= 1 - 0.1 * (e.chillS || 0);
  e.x += mx * sp * dt; e.y += my * sp * dt;
  e.beam = null;
  if (ally && ally.hp < ally.maxHp && dist(e, ally) < MEDIC.range && los(e, ally)) {
    e.beam = ally; ally.hp = Math.min(ally.maxHp, ally.hp + MEDIC.heal * dt);
    e.healT = (e.healT || 0) - dt;
    if (e.healT <= 0) { e.healT = 0.25; particles.push({ x: ally.x + rand(-8, 8), y: ally.y, z: 18, vz: 50, vx: 0, vy: 0, life: 0.5, max: 0.5, color: C.good, size: 3, glow: true, nograv: true }); }
  }
}
function drawDrone(e) {
  const flash = e.flash > 0, z0 = dropZ(e), z = DRONE.z + Math.sin(e.bob) * 3 + z0;
  const X = e.x, Y = syf(e.y, z), hot = e.state === "aim" || e.state === "dive";
  const spin = performance.now() / 30;
  for (const [dx, dy] of [[-9, -5], [9, -5], [-9, 5], [9, 5]]) {
    ctx.fillStyle = "rgba(200,220,240,0.25)"; ctx.beginPath(); ctx.ellipse(X + dx, Y + dy * 0.7 - 3, 6, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(230,240,255,0.6)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(X + dx - Math.cos(spin) * 5, Y + dy * 0.7 - 3 - Math.sin(spin) * 1.6); ctx.lineTo(X + dx + Math.cos(spin) * 5, Y + dy * 0.7 - 3 + Math.sin(spin) * 1.6); ctx.stroke();
  }
  ctx.strokeStyle = "#3a4552"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X - 9, Y - 4); ctx.lineTo(X + 9, Y + 2); ctx.moveTo(X + 9, Y - 4); ctx.lineTo(X - 9, Y + 2); ctx.stroke();
  ctx.fillStyle = flash ? "#fff" : "#5a7ea8"; cRR(ctx, X - 7, Y - 6, 14, 9, 3); ctx.fill();
  ctx.fillStyle = flash ? "#fff" : "#7fa6d0"; ctx.fillRect(X - 6, Y - 6, 12, 3);
  const ea = hot ? e.aim : angTo(e, player);
  ctx.fillStyle = hot ? C.danger : "#7fe0ff"; ctx.beginPath(); ctx.arc(X + Math.cos(ea) * 3, Y - 1 + Math.sin(ea) * 1.5, 2.2, 0, Math.PI * 2); ctx.fill();
  if (hot) { const lg = ctx.createRadialGradient(X, Y, 1, X, Y, 14); lg.addColorStop(0, "rgba(255,75,58,0.4)"); lg.addColorStop(1, "rgba(255,75,58,0)"); ctx.fillStyle = lg; ctx.fillRect(X - 14, Y - 14, 28, 28); }
  return z + 10;
}
function drawMedic(e) {
  const flash = e.flash > 0, z0 = dropZ(e), X = e.x, Y = syf(e.y, z0), bob = Math.sin(e.bob) * 1;
  ctx.fillStyle = "#1e2226"; ctx.beginPath(); ctx.ellipse(X, Y - 3, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = flash ? "#fff" : "#9aa4ad"; ctx.fillRect(X - 3, Y - 12, 6, 8);
  ctx.fillStyle = flash ? "#fff" : cLin(ctx, X - 13, 0, X + 13, 0, [[0, "#c9d0d6"], [0.4, "#f2f5f7"], [1, "#8b949e"]]);
  cRR(ctx, X - 13, Y - 34 + bob, 26, 22, 8); ctx.fill();
  ctx.fillStyle = C.good; ctx.fillRect(X - 2.5, Y - 30 + bob, 5, 14); ctx.fillRect(X - 7, Y - 25.5 + bob, 14, 5);
  // 접시 안테나
  ctx.strokeStyle = "#59616b"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X + 6, Y - 34 + bob); ctx.lineTo(X + 9, Y - 42 + bob); ctx.stroke();
  ctx.fillStyle = e.beam ? C.good : "#8b949e"; ctx.beginPath(); ctx.ellipse(X + 10, Y - 44 + bob, 6, 3, -0.4, 0, Math.PI * 2); ctx.fill();
  if (e.beam) { const lg = ctx.createRadialGradient(X + 10, Y - 44, 1, X + 10, Y - 44, 16); lg.addColorStop(0, "rgba(89,227,154,0.6)"); lg.addColorStop(1, "rgba(89,227,154,0)"); ctx.fillStyle = lg; ctx.fillRect(X - 6, Y - 60, 32, 32); }
  return z0 + 52;
}
function drawBeams() {
  for (const e of enemies) {
    if (e.type !== "medic" || e.dead || !e.beam || e.beam.dead) continue;
    const t = e.beam, x0 = e.x + 10, y0 = syf(e.y, 44), x1 = t.x, y1 = syf(t.y, 20);
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    ctx.strokeStyle = "rgba(89,227,154,0.35)"; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.strokeStyle = "rgba(200,255,220,0.9)"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]); ctx.lineDashOffset = -performance.now() / 20;
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    ctx.restore();
  }
}
function drawDroneMarks(e) {
  if (e.type === "drone") {
    floorEllipse(e.x, e.y, 6, 4, "rgba(0,0,0,0.3)");
    if (e.state === "aim") { ctx.save(); ctx.globalAlpha = 0.7; ctx.strokeStyle = C.danger; ctx.lineWidth = 2; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.moveTo(e.x, syf(e.y)); ctx.lineTo(e.x + Math.cos(e.aim) * 165, syf(e.y + Math.sin(e.aim) * 165)); ctx.stroke(); ctx.restore(); }
    return true;
  }
  return false;
}
// 2구역 테스트: 무작위 모듈 3개(희귀)로 2구역 첫 방에서 시작
function startZone2Test() {
  startRun();
  run.test = "z2";
  const slots = shuffleWith(Math.random, SLOT_ORDER).slice(0, 3);
  for (const sl of slots) { const ids = Object.keys(MODS).filter((id) => MODS[id].slot === sl); player.mods[sl] = { id: ids[Math.floor(Math.random() * ids.length)], r: 1 }; }
  recalcStats();
  room.n = ZONE_ROOMS;
  enterDoor({ type: "exit" });
}

// ================= 2구역 보스: 조립 로봇 멀티암 A-02 =================
const MA = {
  bodyHp: 1000, armHp: 320, r: 46, shield: 0.25, walk: 28, rot: 0.6, aimRot: 3.2,
  clawWind: 0.8, reach: 230, reachT: 0.25, holdT: 0.35, stuckT: 1.5, grabDmg: 20, wallDmg: 12, throwV: 1500,
  flameWind: 0.6, flameT: 2, flameTurns: 1.5, flameLen: 150, flameHalf: 0.24, flameDmg: 12,
  gunWind: 0.5, gunShots: 4, gunGap: 0.14, boltDmg: 10, combo: 0.4, supVolleys: 3, supGap: 0.35, supWarn: 0.4,
  spinWind: 0.9, spinSp: 520, bounces: 4, spinDmg: 25, dizzy: 1.4, flip: 6, ring: 8,
};
const ARM_DEF = { claw: { off: 0, name: "집게 팔", col: "#f2c230" }, torch: { off: Math.PI * 2 / 3, name: "용접 팔", col: "#ff8a3a" }, gun: { off: Math.PI * 4 / 3, name: "리벳 팔", col: "#c9d0d6" } };
function makeMultiarm(x, y) {
  return { type: "boss", kind: "multiarm", x, y, r: MA.r, hp: MA.bodyHp, maxHp: MA.bodyHp, vx: 0, vy: 0, flash: 0, state: "move", t: 1.6, tMax: 1, rot: Math.PI / 2, last: "", p2: false, arms: [], armsAlive: 0, hpLag: MA.bodyHp, lagT: 0, sx: 0, sy: 0, bounce: 0, hitCd: 0, flipT: MA.flip };
}
function spawnArms(b) {
  for (const k of ["claw", "torch", "gun"]) {
    const a = { type: "arm", kind: k, owner: b, x: b.x, y: b.y, r: 17, hp: MA.armHp, maxHp: MA.armHp, vx: 0, vy: 0, flash: 0, state: "idle", t: 0, ext: 0 };
    b.arms.push(a); enemies.push(a);
  }
  b.armsAlive = 3; maPlaceArms(b);
}
function armAng(b, a) { return b.rot + ARM_DEF[a.kind].off; }
function maPlaceArms(b) {
  for (const a of b.arms) { if (a.dead) continue; const an = armAng(b, a), d = b.r + 26 + a.ext; a.x = b.x + Math.cos(an) * d; a.y = b.y + Math.sin(an) * d; }
}
function maArm(b, k) { return b.arms.find((a) => a.kind === k && !a.dead); }
function maSpd(b) { return 1 + 0.2 * (3 - b.armsAlive); }
function maAimArm(b, a, dt, rate) { const want = angTo(b, player) - ARM_DEF[a.kind].off; b.rot += clamp(angDiff(b.rot, want), -rate * dt, rate * dt); }
function maRecover(b, t) { b.state = "recover"; b.t = t; b.act = null; b.sup = null; }
function maSupport(b, dt) {
  const s = b.sup, g = maArm(b, "gun"), p = player;
  if (!s || !g || p.dead) { b.sup = null; return; }
  if (p.grabbed || p.thrownT > 0) return; // 붙잡힌 동안엔 쉬어요
  s.t -= dt;
  if (s.t <= 0) {
    s.warn = false;
    const base = angTo(g, p);
    for (const off of [-0.3, 0, 0.3]) { const an = base + off; bolts.push({ x: g.x + Math.cos(an) * 14, y: g.y + Math.sin(an) * 14, vx: Math.cos(an) * 320, vy: Math.sin(an) * 320, r: 5, ang: an, dmg: MA.boltDmg, cause: "멀티암의 리벳에 맞았어요" }); }
    sfx("shoot"); s.left--; s.t = MA.supGap;
    if (s.left <= 0) b.sup = null;
  }
}
function maRing(b, off) {
  for (let i = 0; i < MA.ring; i++) { const an = off + i / MA.ring * Math.PI * 2; bolts.push({ x: b.x + Math.cos(an) * (b.r + 6), y: b.y + Math.sin(an) * (b.r + 6), vx: Math.cos(an) * 280, vy: Math.sin(an) * 280, r: 5, ang: an, dmg: MA.boltDmg, cause: "멀티암의 리벳 폭발에 맞았어요" }); }
  sfx("shotgun"); shake(5);
}
function maNext(b) {
  const opts = ["claw", "torch", "gun"].filter((k) => maArm(b, k) && k !== b.last);
  const pool = opts.length ? opts : ["claw", "torch", "gun"].filter((k) => maArm(b, k));
  if (!pool.length) return;
  const k = pool[Math.floor(Math.random() * pool.length)], sp = maSpd(b);
  b.last = k; b.act = maArm(b, k);
  if (k === "claw") { b.state = "clawWind"; b.t = b.tMax = MA.clawWind / sp; }
  else if (k === "torch") { b.state = "flameWind"; b.t = b.tMax = MA.flameWind / sp; b.fdir = Math.random() < 0.5 ? -1 : 1; }
  else { b.state = "gunWind"; b.t = b.tMax = MA.gunWind / sp; b.shots = MA.gunShots; b.gAim = 0; }
  // 동시 공격: 팔이 2개 이상이면 40% 확률로 리벳 팔이 B-07을 따라 쏘며 거들어요
  b.sup = null;
  if (k !== "gun" && b.armsAlive >= 2 && maArm(b, "gun") && Math.random() < MA.combo) b.sup = { left: MA.supVolleys, t: MA.supWarn, warn: true };
  sfx("windup");
}
function armDown(a) {
  const b = a.owner;
  run.score += 150; addText(a.x, a.y - 30, ARM_DEF[a.kind].name + " 파괴 +150", ARM_DEF[a.kind].col, true);
  burst(a.x, a.y, 30, "#ffb347", 320, 0.55, 3.2); debris(a.x, a.y, 12, ARM_DEF[a.kind].col);
  hitstop = Math.max(hitstop, 0.12); shake(12); sfx("explode");
  b.armsAlive = b.arms.filter((x) => !x.dead).length;
  // 팔이 부서질 때마다 드론 3기 호출
  for (let i = 0; i < 3; i++) { const an = Math.random() * Math.PI * 2; pending.push({ type: "drone", x: clamp(b.x + Math.cos(an) * 110, RX0 + 30, RX1 - 30), y: clamp(b.y + Math.sin(an) * 90, RY0 + 30, RY1 - 30), r: DRONE.r, t: 0.6 + i * 0.12 }); }
  if (b.act === a) { if (b.grab) maRelease(b); maRecover(b, 0.6); }
  if (b.armsAlive === 0) maEnrage(b);
  else { showBanner(ARM_DEF[a.kind].name + " 파괴", "남은 팔이 더 빨라져요 · 남은 팔 " + b.armsAlive + "개"); banner.t = 1.4; }
}
function maEnrage(b) {
  b.p2 = true; b.state = "rage"; b.t = 1.3; b.act = null; b.flipT = MA.flip;
  waves.push({ x: b.x, y: b.y, t: 0, max: 0.5, R: 180, col: "#5ab0ff" });
  burst(b.x, b.y, 40, "#7fb4ff", 360, 0.7, 3.4);
  showBanner("보호막 해제!", "멀티암이 회전 돌진을 시작해요 · 벨트 방향이 바뀌어요"); banner.t = 1.8;
  hitstop = Math.max(hitstop, 0.15); shake(16); sfx("roar"); buzz(60);
}
function maRelease(b) { b.grab = false; player.grabbed = false; }
function maCancel(b) { if (b.grab) maRelease(b); const c = maArm(b, "claw"); if (c) c.ext = 0; if (b.state !== "stun") maRecover(b, 0.3); }
function updateMultiarm(b, dt) {
  const p = player, ap = angTo(b, p), dp = dist(b, p), sp = maSpd(b);
  b.t -= dt; if (b.hitCd > 0) b.hitCd -= dt; if (b.shT > 0) b.shT -= dt;
  if (b.sup && !["clawWind", "clawReach", "clawHold", "clawStuck", "clawBack", "flameWind", "flame"].includes(b.state)) b.sup = null;
  maSupport(b, dt);
  const s = b.state;
  if (s === "move") {
    b.rot += MA.rot * dt;
    if (!p.dead && dp > 170) { b.x += Math.cos(ap) * MA.walk * dt; b.y += Math.sin(ap) * MA.walk * dt; }
    if (b.t <= 0 && !p.dead) { if (b.p2) { b.state = "spinWind"; b.t = b.tMax = MA.spinWind; b.aim = ap; sfx("windup"); } else maNext(b); }
  } else if (s === "clawWind") {
    const a = maArm(b, "claw"); if (!a) { maRecover(b, 0.4); return; }
    if (b.t > b.tMax * 0.25) maAimArm(b, a, dt, MA.aimRot);
    if (b.t <= 0) { b.state = "clawReach"; b.t = MA.reachT; b.cAng = armAng(b, a); sfx("dash"); }
  } else if (s === "clawReach") {
    const a = maArm(b, "claw"); if (!a) { maRecover(b, 0.4); return; }
    a.ext = MA.reach * (1 - Math.max(0, b.t) / MA.reachT);
    maPlaceArms(b);
    if (!p.dead && p.dash.t <= 0 && p.z < 30 && dist(a, p) < a.r + p.r + 6) {
      b.grab = true; p.grabbed = true; b.state = "clawHold"; b.t = MA.holdT; sfx("catch"); shake(6);
    } else if (b.t <= 0) {
      a.state = "stun"; a.t = MA.stuckT; b.state = "clawStuck"; b.t = MA.stuckT;
      shake(8); sfx("slam"); burst(a.x, a.y, 14, "#9aa4ad", 240, 0.35, 2.4); room.cracks.push({ x: a.x, y: a.y, seed: Math.random() * 10 });
      addText(a.x, a.y - 30, "팔이 박힘!", C.hazard, true);
    }
  } else if (s === "clawHold") {
    const a = maArm(b, "claw"); if (!a) { maRelease(b); maRecover(b, 0.4); return; }
    if (p.dash.t > 0 || p.dead) { maRelease(b); b.state = "clawBack"; b.t = 0.3; return; }
    p.x = a.x; p.y = a.y; p.kx = p.ky = 0; p.z = 0;
    if (b.t <= 0) {
      maRelease(b);
      const th = b.cAng; p.inv = 0;
      hurtPlayer(MA.grabDmg, null, "멀티암에게 붙잡혀 내던져졌어요");
      p.kx = Math.cos(th) * MA.throwV; p.ky = Math.sin(th) * MA.throwV; p.thrownT = 0.5;
      b.state = "clawBack"; b.t = 0.35; sfx("throw");
    }
  } else if (s === "clawStuck") {
    const a = maArm(b, "claw"); if (!a) { maRecover(b, 0.4); return; }
    a.state = "stun";
    if (b.t <= 0) { a.state = "idle"; b.state = "clawBack"; b.t = 0.35; }
  } else if (s === "clawBack") {
    const a = maArm(b, "claw");
    if (a) { a.ext = Math.max(0, a.ext - MA.reach / 0.35 * dt); a.state = "idle"; }
    if (b.t <= 0) { if (a) a.ext = 0; maRecover(b, 0.5 / sp); }
  } else if (s === "flameWind") {
    const a = maArm(b, "torch"); if (!a) { maRecover(b, 0.4); return; }
    if (b.t > b.tMax * 0.2) maAimArm(b, a, dt, MA.aimRot);
    if (b.t <= 0) { b.state = "flame"; b.t = b.tMax = MA.flameT / Math.sqrt(sp); b.fTick = 0; sfx("ignite"); }
  } else if (s === "flame") {
    const a = maArm(b, "torch"); if (!a) { maRecover(b, 0.4); return; }
    b.rot += b.fdir * (MA.flameTurns * Math.PI * 2 / b.tMax) * dt;
    const fa = armAng(b, a);
    for (let i = 0; i < (touchMode ? 3 : 5); i++) {
      const aa = fa + rand(-MA.flameHalf, MA.flameHalf) * 0.8, v = rand(380, 560);
      particles.push({ x: a.x + Math.cos(fa) * 12, y: a.y + Math.sin(fa) * 12, z: 22, vz: rand(-10, 20), vx: Math.cos(aa) * v, vy: Math.sin(aa) * v, life: rand(0.18, 0.28), max: 0.28, color: Math.random() < 0.4 ? "#fff1a8" : Math.random() < 0.5 ? "#ffb347" : "#ff6a2b", size: rand(3, 6), glow: true, nograv: true });
    }
    b.fTick -= dt; if (b.fTick <= 0) { b.fTick = 0.11; sfx("flame"); }
    const pd = dist(a, p);
    if (!p.dead && p.z < 34 && pd < MA.flameLen + p.r && Math.abs(angDiff(fa, angTo(a, p))) < MA.flameHalf + Math.atan2(p.r, Math.max(pd, 1))) hurtPlayer(MA.flameDmg, a, "멀티암의 용접 화염에 데었어요");
    if (b.t <= 0) maRecover(b, 0.7 / sp);
  } else if (s === "gunWind") {
    const a = maArm(b, "gun"); if (!a) { maRecover(b, 0.4); return; }
    maAimArm(b, a, dt, MA.aimRot);
    if (b.t <= 0) { b.state = "gun"; b.t = 0; }
  } else if (s === "gun") {
    const a = maArm(b, "gun"); if (!a) { maRecover(b, 0.4); return; }
    maAimArm(b, a, dt, 1.2);
    if (b.t <= 0) {
      const base = armAng(b, a) + b.gAim;
      for (const off of [-0.35, 0, 0.35]) { const an = base + off; bolts.push({ x: a.x + Math.cos(an) * 14, y: a.y + Math.sin(an) * 14, vx: Math.cos(an) * 320, vy: Math.sin(an) * 320, r: 5, ang: an, dmg: MA.boltDmg, cause: "멀티암의 리벳에 맞았어요" }); }
      sfx("shoot"); b.gAim += 0.08 * (b.fdir || 1); b.shots--; b.t = MA.gunGap / sp;
      if (b.shots <= 0) maRecover(b, 0.8 / sp);
    }
  } else if (s === "recover") {
    if (b.t <= 0) { b.state = "move"; b.t = (b.p2 ? 0.8 : rand(0.6, 1.0)) / sp; b.act = null; }
  } else if (s === "rage") {
    b.rot += 8 * dt;
    if (b.t <= 0) { b.state = "move"; b.t = 0.6; }
  } else if (s === "spinWind") {
    b.rot += 10 * dt * (1 - b.t / b.tMax) + 2 * dt;
    if (b.t > 0.25 && !p.dead) b.aim = ap;
    if (b.t <= 0) { b.state = "spin"; b.sx = Math.cos(b.aim) * MA.spinSp; b.sy = Math.sin(b.aim) * MA.spinSp; b.bounce = 0; b.t = 4; sfx("grind"); }
  } else if (s === "spin") {
    b.rot += 16 * dt;
    b.x += b.sx * dt; b.y += b.sy * dt;
    let bounced = false;
    if (b.x < RX0 + b.r) { b.x = RX0 + b.r; b.sx = Math.abs(b.sx); bounced = true; }
    if (b.x > RX1 - b.r) { b.x = RX1 - b.r; b.sx = -Math.abs(b.sx); bounced = true; }
    if (b.y < RY0 + b.r) { b.y = RY0 + b.r; b.sy = Math.abs(b.sy); bounced = true; }
    if (b.y > RY1 - b.r) { b.y = RY1 - b.r; b.sy = -Math.abs(b.sy); bounced = true; }
    for (const o of room.obstacles) {
      const cx = clamp(b.x, o.x, o.x + o.w), cy = clamp(b.y, o.y, o.y + o.h), dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy);
      if (d < b.r && d > 0.01) { const nx = dx / d, ny = dy / d, dot = b.sx * nx + b.sy * ny; if (dot < 0) { b.sx -= 2 * dot * nx; b.sy -= 2 * dot * ny; } b.x = cx + nx * b.r; b.y = cy + ny * b.r; bounced = true; }
    }
    if (bounced) {
      b.bounce++; shake(10); sfx("clank"); burst(b.x, b.y, 14, C.eye, 260, 0.35, 2.6);
      // 다음 튕김은 플레이어 쪽으로 살짝 꺾임
      const cur = Math.atan2(b.sy, b.sx), want = angTo(b, p), na = cur + clamp(angDiff(cur, want), -0.5, 0.5);
      b.sx = Math.cos(na) * MA.spinSp; b.sy = Math.sin(na) * MA.spinSp;
    }
    if (Math.random() < 0.8) particles.push({ x: b.x + rand(-30, 30), y: b.y + rand(-20, 20), z: 4, vz: rand(40, 100), vx: rand(-60, 60), vy: rand(-60, 60), life: 0.3, max: 0.3, color: Math.random() < 0.5 ? C.eye : "#7fb4ff", size: rand(2, 4), glow: true, nograv: true });
    if (!p.dead && p.z < 34 && dp < b.r + p.r && b.hitCd <= 0) { b.hitCd = 1.0; hurtPlayer(MA.spinDmg, b, "멀티암의 회전 돌진에 휩쓸렸어요"); }
    if (b.bounce >= MA.bounces || b.t <= 0) { b.state = "stun"; b.t = b.tMax = MA.dizzy; addText(b.x, b.y - 70, "어지러움!", C.hazard, true); sfx("slam"); }
  } else if (s === "stun") {
    if (b.t <= 0) {
      if (b.p2) { b.state = "ring"; b.t = 0.25; maRing(b, b.rot); burst(b.x, b.y, 16, C.eye, 260, 0.35, 2.4); }
      else { b.state = "move"; b.t = 1.0; }
    }
  } else if (s === "ring") {
    b.rot += 6 * dt;
    if (b.t <= 0) { maRing(b, b.rot + Math.PI / MA.ring); b.state = "move"; b.t = 0.8; }
  }
  // 2페이즈: 벨트 방향 뒤집기
  if (b.p2 && room.belts) {
    b.flipT -= dt; room.beltWarn = b.flipT < 1;
    if (b.flipT <= 0) { b.flipT = MA.flip; for (const bl of room.belts) bl.dir += Math.PI; sfx("door"); showBanner("벨트 방향 전환", ""); banner.t = 0.9; }
  }
  b.x = clamp(b.x, RX0 + b.r, RX1 - b.r); b.y = clamp(b.y, RY0 + b.r, RY1 - b.r);
  maPlaceArms(b);
}
// ---------- 그리기 ----------
function drawMultiBody(g, x, y, s, o) {
  const p2 = !!o.p2, dead = !!o.dead;
  // 회전판
  g.fillStyle = "#1e2226"; g.beginPath(); g.ellipse(x, y - 6 * s, 92 * s, 28 * s, 0, 0, 6.28); g.fill();
  g.save(); g.beginPath(); g.ellipse(x, y - 10 * s, 88 * s, 26 * s, 0, 0, 6.28); g.ellipse(x, y - 10 * s, 74 * s, 21 * s, 0, 0, 6.28); g.clip("evenodd");
  for (let i = 0; i < 24; i++) { const a = i / 24 * 6.28 + (o.rot || 0); g.fillStyle = dead ? (i % 2 ? "#4a3e1a" : "#1b1d20") : i % 2 ? "#f2c230" : "#1b1d20"; g.beginPath(); g.moveTo(x, y - 10 * s); g.arc(x, y - 10 * s, 100 * s, a, a + 6.28 / 24); g.closePath(); g.fill(); }
  g.restore();
  g.fillStyle = "#2b3440"; g.beginPath(); g.ellipse(x, y - 12 * s, 72 * s, 20 * s, 0, 0, 6.28); g.fill();
  const cw = 50 * s, ct = y - 100 * s, cb = y - 14 * s;
  g.fillStyle = dead ? cLin(g, x - cw, 0, x + cw, 0, [[0, "#1d2228"], [0.4, "#3a424c"], [1, "#16191d"]]) : cLin(g, x - cw, 0, x + cw, 0, [[0, "#2f3c4a"], [0.35, "#6f8296"], [0.7, "#3d4b5a"], [1, "#222b35"]]);
  g.fillRect(x - cw, ct, cw * 2, cb - ct); g.beginPath(); g.ellipse(x, cb, cw, 14 * s, 0, 0, Math.PI); g.fill();
  g.save(); g.beginPath(); g.rect(x - cw, cb - 22 * s, cw * 2, 10 * s); g.clip(); g.fillStyle = "#1b1d20"; g.fillRect(x - cw, cb - 22 * s, cw * 2, 10 * s);
  g.fillStyle = dead ? "#5a4a20" : "#f2c230"; for (let i = -2; i < 14; i++) { const sx = x - cw + i * 10 * s; g.beginPath(); g.moveTo(sx, cb - 12 * s); g.lineTo(sx + 5 * s, cb - 12 * s); g.lineTo(sx + 12 * s, cb - 22 * s); g.lineTo(sx + 7 * s, cb - 22 * s); g.fill(); } g.restore();
  g.fillStyle = "#1b1d20"; cRR(g, x - 22 * s, cb - 46 * s, 44 * s, 14 * s, 3 * s); g.fill();
  g.fillStyle = "#7fb4ff"; g.font = `700 ${Math.max(6, 10 * s)}px "IBM Plex Mono", monospace`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("A-02", x, cb - 39 * s);
  const hy = ct;
  g.fillStyle = dead ? cLin(g, x - 56 * s, 0, x + 56 * s, 0, [[0, "#1d2228"], [0.4, "#3a424c"], [1, "#16191d"]]) : cLin(g, x - 56 * s, 0, x + 56 * s, 0, [[0, "#3d4b5a"], [0.4, "#8ea2b6"], [1, "#2a3440"]]);
  g.beginPath(); g.ellipse(x, hy, 56 * s, 18 * s, 0, 0, Math.PI); g.ellipse(x, hy, 56 * s, 52 * s, 0, Math.PI, 0); g.fill();
  g.fillStyle = "#0f1418"; cRR(g, x - 40 * s, hy - 26 * s, 80 * s, 18 * s, 9 * s); g.fill();
  if (!dead) {
    const vc = o.stun ? "#7a7f86" : p2 ? "#ff4b3a" : "#5ab0ff";
    const vg = g.createLinearGradient(x - 40 * s, 0, x + 40 * s, 0); vg.addColorStop(0, "rgba(0,0,0,0)"); vg.addColorStop(0.5, vc); vg.addColorStop(1, "rgba(0,0,0,0)");
    g.globalAlpha = o.warn ? 0.7 + 0.3 * Math.sin(performance.now() / 50) : 1;
    g.fillStyle = vg; cRR(g, x - 34 * s, hy - 21 * s, 68 * s, 8 * s, 4 * s); g.fill(); g.globalAlpha = 1;
  }
  g.strokeStyle = "#59616b"; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(x - 20 * s, hy - 48 * s); g.lineTo(x - 26 * s, hy - 70 * s); g.stroke();
  g.fillStyle = dead ? "#3a2a26" : p2 ? "#ff4b3a" : "#59e39a"; g.beginPath(); g.arc(x - 26 * s, hy - 72 * s, 4 * s, 0, 6.28); g.fill();
  if (o.flash || o.frozen) {
    g.save(); g.globalCompositeOperation = "lighter"; g.fillStyle = o.frozen ? "rgba(127,224,255,0.35)" : "rgba(255,255,255,0.4)";
    g.fillRect(x - cw, ct, cw * 2, cb - ct); g.beginPath(); g.ellipse(x, hy, 56 * s, 52 * s, 0, Math.PI, 0); g.fill(); g.restore();
  }
  if (o.shield) {
    g.save(); g.globalCompositeOperation = "lighter";
    const pul = 0.5 + 0.2 * Math.sin(performance.now() / 300) + (o.shHit ? 0.4 : 0);
    g.strokeStyle = `rgba(90,176,255,${pul})`; g.lineWidth = 2.5 * s;
    g.beginPath(); g.ellipse(x, y - 60 * s, 80 * s, 96 * s, 0, 0, 6.28); g.stroke();
    g.fillStyle = `rgba(90,176,255,${0.05 + (o.shHit ? 0.12 : 0)})`; g.fill();
    for (let i = 1; i < 4; i++) { const a = i / 4 * Math.PI; g.strokeStyle = "rgba(150,200,255,0.18)"; g.lineWidth = 1.2; g.beginPath(); g.ellipse(x, y - 60 * s, 80 * s * Math.abs(Math.cos(a + (o.rot || 0))), 96 * s, 0, 0, 6.28); g.stroke(); }
    g.restore();
  }
  if (p2 && !dead) { g.save(); g.globalCompositeOperation = "lighter"; for (let i = 0; i < 8; i++) { g.fillStyle = Math.random() < 0.5 ? "rgba(255,200,90,0.85)" : "rgba(127,180,255,0.7)"; g.beginPath(); g.arc(x + rand(-60, 60) * s, y + rand(-150, -20) * s, rand(1, 2.6) * s * 1.6, 0, 6.28); g.fill(); } g.restore(); }
  return ct - 52 * s;
}
const MA_S = 0.5;
function drawMultiarm(b) {
  const jit = b.state === "rage" || b.state === "spinWind" ? rand(-1.5, 1.5) : 0;
  const X = b.x + jit, Y = syf(b.y, dropZ(b)) + b.r * SY * 0.4;
  const warn = ["clawWind", "flameWind", "gunWind", "spinWind", "rage"].includes(b.state);
  const top = drawMultiBody(ctx, X, Y, MA_S, { p2: b.p2, rot: b.rot, flash: b.flash > 0, frozen: b.frozen > 0, stun: b.state === "stun", shield: b.armsAlive > 0 && !(b.drop > 0), shHit: b.shT > 0, warn });
  if (b.state === "stun") { ctx.fillStyle = C.hazard; for (let i = 0; i < 4; i++) { const a = performance.now() / 220 + i * Math.PI / 2; ctx.beginPath(); ctx.arc(X + Math.cos(a) * 36, top - 4 + Math.sin(a) * 7, 4, 0, Math.PI * 2); ctx.fill(); } }
  // 팔이 없는 어깨 자리: 2페이즈 불꽃
  if (b.p2 && Math.random() < 0.5) for (const k of ["claw", "torch", "gun"]) { const an = b.rot + ARM_DEF[k].off; particles.push({ x: b.x + Math.cos(an) * 24, y: b.y + Math.sin(an) * 24, z: 44, vz: rand(60, 160), vx: rand(-40, 40), vy: rand(-40, 40), life: 0.35, max: 0.35, color: C.eye, size: 2, glow: true, nograv: false }); }
}
function drawArm(a) {
  const b = a.owner; if (!b || b.dead) return 30;
  const an = armAng(b, a), flash = a.flash > 0;
  const shX = b.x + Math.cos(an) * 18, shY = syf(b.y + Math.sin(an) * 18, 46);
  const hx = a.x, hy = syf(a.y, a.state === "stun" ? 8 : 26);
  const ex = (shX + hx) / 2, ey = Math.min(shY, hy) - 18 - a.ext * 0.05;
  const def = ARM_DEF[a.kind], col = flash ? "#fff" : a.kind === "claw" ? "#f2c230" : a.kind === "torch" ? "#e0662a" : "#8a96a3", dark = a.kind === "claw" ? "#7a5418" : a.kind === "torch" ? "#6a2a10" : "#30353b";
  const seg2 = (x0, y0, x1, y1, w) => { ctx.lineCap = "round"; ctx.strokeStyle = dark; ctx.lineWidth = w + 3; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.strokeStyle = col; ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); };
  const jnt = (x, y, r) => { ctx.fillStyle = "#30353b"; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#59616b"; ctx.beginPath(); ctx.arc(x, y, r * 0.55, 0, Math.PI * 2); ctx.fill(); };
  jnt(shX, shY, 7); seg2(shX, shY, ex, ey, 9); jnt(ex, ey, 6); seg2(ex, ey, hx, hy, 7);
  const sa = Math.atan2(Math.sin(an) * SY, Math.cos(an)), s = 0.5;
  ctx.save(); ctx.translate(hx, hy); ctx.rotate(sa);
  if (a.kind === "claw") {
    ctx.fillStyle = "#454c55"; cRR(ctx, -6 * s, -10 * s, 16 * s, 20 * s, 4 * s); ctx.fill();
    const open = b.state === "clawHold" ? 0.1 : b.state === "clawWind" || b.state === "clawReach" ? 0.6 : 0.35;
    for (const sg of [-1, 1]) { ctx.save(); ctx.rotate(sg * open); ctx.fillStyle = col; ctx.strokeStyle = dark; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(8 * s, sg * 4 * s); ctx.lineTo(30 * s, sg * 8 * s); ctx.lineTo(38 * s, sg * 2 * s); ctx.lineTo(34 * s, sg * 1 * s); ctx.lineTo(26 * s, sg * 4 * s); ctx.lineTo(8 * s, sg * 10 * s); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
  } else if (a.kind === "torch") {
    ctx.fillStyle = "#59616b"; cRR(ctx, -6 * s, -9 * s, 20 * s, 18 * s, 4 * s); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(12 * s, -6 * s); ctx.lineTo(30 * s, -3 * s); ctx.lineTo(30 * s, 3 * s); ctx.lineTo(12 * s, 6 * s); ctx.closePath(); ctx.fill();
    if (b.state === "flameWind") { ctx.fillStyle = `rgba(255,180,70,${0.5 + 0.5 * Math.sin(performance.now() / 40)})`; ctx.beginPath(); ctx.arc(32 * s, 0, 5 * s, 0, Math.PI * 2); ctx.fill(); }
  } else {
    ctx.fillStyle = "#454c55"; cRR(ctx, -8 * s, -11 * s, 22 * s, 22 * s, 5 * s); ctx.fill();
    ctx.fillStyle = flash ? "#fff" : "#8a96a3"; for (const yy of [-6, 0, 6]) ctx.fillRect(12 * s, (yy - 2) * s, 30 * s, 4 * s);
    ctx.fillStyle = "#30353b"; ctx.fillRect(12 * s, -9 * s, 5 * s, 18 * s); ctx.fillRect(34 * s, -9 * s, 4 * s, 18 * s);
    if (b.state === "gunWind" || (b.state === "gun" && b.t > MA.gunGap * 0.5) || (b.sup && b.sup.warn)) { ctx.fillStyle = "rgba(255,210,63,0.8)"; ctx.beginPath(); ctx.arc(46 * s, 0, 5 * s, 0, Math.PI * 2); ctx.fill(); }
  }
  ctx.restore();
  if (a.frozen > 0) { ctx.save(); ctx.globalAlpha = 0.5; ctx.fillStyle = "#bff3ff"; ctx.beginPath(); ctx.arc(hx, hy, a.r, 0, Math.PI * 2); ctx.fill(); ctx.restore(); }
  if (a.state === "stun") { ctx.fillStyle = C.hazard; for (let i = 0; i < 3; i++) { const t = performance.now() / 200 + i * 2.1; ctx.beginPath(); ctx.arc(hx + Math.cos(t) * 13, hy - 18 + Math.sin(t) * 3, 2.5, 0, Math.PI * 2); ctx.fill(); } }
  return 38;
}
function drawMultiMarks(b) {
  if (b.drop > 0) return;
  const p = player;
  if (b.sup && b.sup.warn) {
    const g = maArm(b, "gun");
    if (g) { const base = angTo(g, p); ctx.save(); ctx.translate(g.x, syf(g.y)); ctx.scale(1, SY); ctx.globalAlpha = 0.7; ctx.strokeStyle = C.eye; ctx.lineWidth = 1.5; ctx.setLineDash([5, 6]);
      for (const off of [-0.3, 0, 0.3]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(base + off) * 260, Math.sin(base + off) * 260); ctx.stroke(); } ctx.restore(); }
  }
  ctx.save();
  if (b.state === "clawWind") {
    const a = maArm(b, "claw");
    if (a) { const an = armAng(b, a), k = 1 - b.t / b.tMax; ctx.translate(a.x, syf(a.y)); ctx.scale(1, SY); ctx.rotate(an);
      ctx.globalAlpha = 0.2 + k * 0.35; ctx.fillStyle = C.danger; ctx.fillRect(0, -16, MA.reach, 32);
      ctx.globalAlpha = 0.9; ctx.strokeStyle = C.danger; ctx.lineWidth = 2.5; ctx.setLineDash([10, 7]); ctx.strokeRect(0, -16, MA.reach, 32); }
  } else if (b.state === "flameWind") {
    const a = maArm(b, "torch");
    if (a) { const an = armAng(b, a), k = 1 - b.t / b.tMax; ctx.translate(b.x, syf(b.y)); ctx.scale(1, SY);
      ctx.globalAlpha = 0.25 + k * 0.4; ctx.strokeStyle = "#ff8a3a"; ctx.lineWidth = 4; const R = b.r + 26 + MA.flameLen;
      ctx.beginPath(); ctx.arc(0, 0, R, an, an + b.fdir * 2.2, b.fdir < 0); ctx.stroke();
      const ea = an + b.fdir * 2.2; ctx.fillStyle = "#ff8a3a"; ctx.beginPath(); ctx.arc(Math.cos(ea) * R, Math.sin(ea) * R, 7, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.18 + k * 0.25; ctx.fillStyle = "#ff6a2b"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, R, an - MA.flameHalf, an + MA.flameHalf); ctx.closePath(); ctx.fill(); }
  } else if (b.state === "flame") {
    const a = maArm(b, "torch");
    if (a) { const an = armAng(b, a); ctx.translate(a.x, syf(a.y)); ctx.scale(1, SY); ctx.globalAlpha = 0.25; ctx.fillStyle = "#ff6a2b"; ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, MA.flameLen, an - MA.flameHalf, an + MA.flameHalf); ctx.closePath(); ctx.fill(); }
  } else if (b.state === "gunWind") {
    const a = maArm(b, "gun");
    if (a) { const an = armAng(b, a); ctx.translate(a.x, syf(a.y)); ctx.scale(1, SY); ctx.globalAlpha = 0.6; ctx.strokeStyle = C.eye; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      for (const off of [-0.35, 0, 0.35]) { ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(an + off) * 300, Math.sin(an + off) * 300); ctx.stroke(); } }
  } else if (b.state === "spinWind") {
    const k = 1 - b.t / b.tMax; ctx.translate(b.x, syf(b.y)); ctx.scale(1, SY); ctx.rotate(b.aim);
    ctx.globalAlpha = 0.2 + k * 0.4; ctx.fillStyle = C.danger; ctx.fillRect(0, -b.r, 420, b.r * 2);
    ctx.globalAlpha = 0.9; ctx.strokeStyle = C.danger; ctx.lineWidth = 2.5; ctx.setLineDash([12, 8]); ctx.strokeRect(0, -b.r, 420, b.r * 2);
  }
  ctx.restore();
}
function drawMultiBar(b) {
  const w = 420, x = W / 2 - w / 2, y = 82;
  ctx.save();
  ctx.fillStyle = "rgba(10,12,14,0.82)"; ctx.fillRect(x - 10, y - 22, w + 20, 54);
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.font = '700 12px "IBM Plex Sans KR", sans-serif';
  ctx.fillStyle = C.text; ctx.fillText("멀티암 A-02", x, y - 10);
  ctx.textAlign = "right"; ctx.fillStyle = b.hp <= 0 ? C.muted : b.armsAlive > 0 ? "#7fb4ff" : C.danger; ctx.fillText(b.hp <= 0 ? "파괴됨" : b.armsAlive > 0 ? "보호막 (피해 25%)" : "보호막 해제", x + w, y - 10);
  ctx.fillStyle = "#1a2230"; ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillRect(x, y, w * clamp(b.hpLag / b.maxHp, 0, 1), 10);
  ctx.fillStyle = b.armsAlive > 0 ? "#5ab0ff" : C.danger; ctx.fillRect(x, y, w * clamp(b.hp / b.maxHp, 0, 1), 10);
  ctx.strokeStyle = C.hazard; ctx.lineWidth = 1.5; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, 11);
  const aw = (w - 16) / 3;
  ["claw", "torch", "gun"].forEach((k, i) => {
    const a = b.arms.find((q) => q.kind === k), ax = x + i * (aw + 8), f = a && !a.dead ? a.hp / a.maxHp : 0;
    ctx.fillStyle = "#101215"; ctx.fillRect(ax, y + 16, aw, 6);
    ctx.fillStyle = f > 0 ? ARM_DEF[k].col : "#3a3f45"; ctx.fillRect(ax, y + 16, aw * f, 6);
    ctx.textAlign = "left"; ctx.font = '600 9px "IBM Plex Sans KR", sans-serif'; ctx.fillStyle = f > 0 ? ARM_DEF[k].col : "#59616b"; ctx.fillText(f > 0 ? ARM_DEF[k].name : "파괴", ax, y + 28);
  });
  ctx.restore();
}
function startBoss2Test() {
  startRun();
  run.test = "b2";
  const slots = shuffleWith(Math.random, SLOT_ORDER).slice(0, 4);
  for (const sl of slots) { const ids = Object.keys(MODS).filter((id) => MODS[id].slot === sl); player.mods[sl] = { id: ids[Math.floor(Math.random() * ids.length)], r: 1 }; }
  recalcStats();
  room.n = ZONE_ROOMS * 2 - 1;
  enterDoor({ type: "boss" });
}

// ================= 3구역: 레이저 스캐너 · 정예 적 · 인스펙터 =================
const LASER = { sp: 115, warn: 1.0, z: 10, half: 7, dmg: 12, mark: 3, markMul: 1.25 };
const INSP = { hp: 60, r: 15, sp: 50, aimT: 1.2, lockT: 0.3, dmg: 20, near: 200, far: 420, cd: 1.6 };
const ELITE = { chance: 0.25, hpMul: 1.5, shield: 30, shRegen: 15, shDelay: 5, haste: 1.4,
  col: { shield: "#5ab0ff", split: "#c58cff", haste: "#ff6a2b" }, name: { shield: "보호막", split: "분열", haste: "가속" } };
const ELITE_ALLOW = { spark: ["shield", "split", "haste"], turret: ["shield", "haste"], drum: ["haste"], lift: ["shield", "haste"], medic: ["shield"], insp: ["shield", "haste"] };
function genLasers(rng, count) {
  const ls = [];
  const span = (RY1 - RY0 - 200) / count;
  for (let i = 0; i < count; i++) {
    const y0 = RY0 + 90 + i * span, y1 = y0 + span - 30;
    ls.push({ y0, y1, y: rng() < 0.5 ? y0 : y1, dir: 0, state: "off", t: 1.5 + i * 1.6 + rng() });
  }
  return ls;
}
function updateLasers(dt) {
  const ls = room.lasers; if (!ls || !ls.length) return;
  const p = player, active = room.wave > 0 && !room.cleared;
  for (const L of ls) {
    L.t -= dt;
    if (L.state === "off") {
      if (L.t <= 0) { if (active) { L.state = "warn"; L.t = LASER.warn; L.dir = Math.abs(L.y - L.y0) < 2 ? 1 : -1; sfx("windup"); } else L.t = 0.5; }
    } else if (L.state === "warn") {
      if (L.t <= 0) { L.state = "on"; sfx("zap"); }
    } else if (L.state === "on") {
      L.y += L.dir * LASER.sp * dt;
      if ((L.dir > 0 && L.y >= L.y1) || (L.dir < 0 && L.y <= L.y0)) { L.y = L.dir > 0 ? L.y1 : L.y0; L.state = "off"; L.t = 1.8 + Math.random() * 1.2; }
      if (!p.dead && p.z < 14 && Math.abs(p.y - L.y) < LASER.half + 4 && p.inv <= 0 && p.dash.t <= 0) {
        hurtPlayer(LASER.dmg, null, "레이저 스캐너에 불량 판정을 받았어요");
        p.markT = LASER.mark; addText(p.x, p.y - 44, "불량 표식", C.danger, true);
      }
    }
    if (!active && L.state === "on") { L.state = "off"; L.t = 9; }
  }
}
function drawLaserEmitter(x, y, on) {
  const Y = syf(y, LASER.z);
  ctx.fillStyle = "#3a4552"; ctx.fillRect(x - 6, Y - 16, 12, 22);
  ctx.fillStyle = C.hazard; ctx.fillRect(x - 6, Y - 16, 12, 3);
  ctx.fillStyle = on ? C.danger : "#5a1a14"; ctx.beginPath(); ctx.arc(x, Y, 4, 0, Math.PI * 2); ctx.fill();
}
function drawLasers() {
  const ls = room.lasers; if (!ls || !ls.length) return;
  const blink = Math.floor(performance.now() / 110) % 2 === 0;
  for (const L of ls) {
    if (L.state === "warn") {
      // 이동 경로: 시작선·끝선 점선 + 방향 화살표
      ctx.save(); ctx.globalAlpha = 0.65; ctx.strokeStyle = C.danger; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
      for (const yy of [L.y0, L.y1]) { ctx.beginPath(); ctx.moveTo(RX0, syf(yy)); ctx.lineTo(RX1, syf(yy)); ctx.stroke(); }
      ctx.setLineDash([]); ctx.fillStyle = C.danger;
      const ay = (L.y0 + L.y1) / 2;
      for (const ax of [RX0 + 80, W / 2, RX1 - 80]) { ctx.beginPath(); ctx.moveTo(ax, syf(ay + L.dir * 12)); ctx.lineTo(ax - 9, syf(ay - L.dir * 4)); ctx.lineTo(ax + 9, syf(ay - L.dir * 4)); ctx.closePath(); ctx.fill(); }
      ctx.globalAlpha = blink ? 0.9 : 0.35; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(RX0, syf(L.y, LASER.z)); ctx.lineTo(RX1, syf(L.y, LASER.z)); ctx.stroke();
      ctx.restore();
    } else if (L.state === "on") {
      const Y = syf(L.y, LASER.z);
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
      ctx.strokeStyle = "rgba(255,60,60,0.28)"; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(RX0, Y); ctx.lineTo(RX1, Y); ctx.stroke();
      ctx.strokeStyle = "rgba(255,80,70,0.9)"; ctx.lineWidth = 4; ctx.stroke();
      ctx.strokeStyle = "rgba(255,235,225,0.95)"; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.restore();
      floorEllipse(W / 2, L.y, (RX1 - RX0) / 2, 5, "rgba(255,60,60,0.12)");
    }
    drawLaserEmitter(RX0 + 4, L.y, L.state === "on" || (L.state === "warn" && blink));
    drawLaserEmitter(RX1 - 4, L.y, L.state === "on" || (L.state === "warn" && blink));
  }
}
// ---------- 정예 ----------
function pickElite(type) {
  const allow = ELITE_ALLOW[type];
  if (!allow || curZone() < 3 || Math.random() >= ELITE.chance) return null;
  return allow[Math.floor(Math.random() * allow.length)];
}
function applyElite(e, kind) {
  e.elite = kind; e.hp = e.maxHp = Math.round(e.maxHp * ELITE.hpMul);
  if (kind === "shield") { e.sh = ELITE.shield; e.shT = 0; }
}
function updateElite(e, dt) {
  if (e.elite === "shield") {
    if (e.shT > 0) e.shT -= dt;
    else if (e.sh < ELITE.shield) e.sh = Math.min(ELITE.shield, e.sh + ELITE.shRegen * dt);
  } else if (e.elite === "haste" && Math.random() < 0.35 && e.type !== "turret") {
    particles.push({ x: e.x, y: e.y, z: 12, vz: 0, vx: 0, vy: 0, life: 0.25, max: 0.25, color: ELITE.col.haste, size: e.r * 0.5, glow: true, nograv: true });
  }
}
function eliteAbsorb(e, dmg) {
  if (!(e.sh > 0)) return dmg;
  const a = Math.min(e.sh, dmg); e.sh -= a; e.shT = ELITE.shDelay;
  burst(e.x, e.y, 5, ELITE.col.shield, 160, 0.2, 2);
  if (e.sh <= 0) { addText(e.x, e.y - e.r - 14, "보호막 파괴", ELITE.col.shield, false); burst(e.x, e.y, 14, ELITE.col.shield, 240, 0.35, 2.6); sfx("parry"); }
  return dmg - a;
}
function eliteSplit(e) {
  if (e.elite !== "split" || e.mini) return;
  for (const s of [-1, 1]) {
    const m = makeEnemyBase({ type: "spark", x: e.x + s * 10, y: e.y });
    m.mini = true; m.r = 9; m.hp = m.maxHp = Math.max(6, Math.round(e.maxHp * 0.3)); m.cd = 0.8 + Math.random() * 0.5;
    m.vx = s * 220; m.vy = rand(-80, 80);
    enemies.push(m);
  }
  burst(e.x, e.y, 14, ELITE.col.split, 220, 0.35, 2.4);
  addText(e.x, e.y - 30, "분열!", ELITE.col.split, true);
}
function drawEliteMarks(e) {
  if (!e.elite || e.drop > 0) return;
  ctx.save(); ctx.translate(e.x, syf(e.y)); ctx.scale(1, SY);
  ctx.strokeStyle = "#f2c230"; ctx.lineWidth = 2.5; ctx.setLineDash([6, 4]); ctx.lineDashOffset = -performance.now() / 60;
  ctx.beginPath(); ctx.arc(0, 0, e.r + 9, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
}
function drawEliteTop(e, topZ) {
  if (!e.elite || e.drop > 0) return;
  const x = e.x, y = syf(e.y, topZ) - 10, s = 1, col = ELITE.col[e.elite];
  ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x - 7 * s, y); ctx.lineTo(x - 7 * s, y - 6); ctx.lineTo(x - 3.5, y - 3); ctx.lineTo(x, y - 8); ctx.lineTo(x + 3.5, y - 3); ctx.lineTo(x + 7, y - 6); ctx.lineTo(x + 7, y); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1; ctx.stroke();
  if (e.sh > 0) {
    const zc = Math.max(12, topZ * 0.45);
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = 0.35 + 0.5 * (e.sh / ELITE.shield);
    ctx.strokeStyle = ELITE.col.shield; ctx.lineWidth = 2; ctx.beginPath(); ctx.ellipse(e.x, syf(e.y, zc), e.r + 8, e.r + 10, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = "rgba(90,176,255,0.08)"; ctx.fill(); ctx.restore();
  }
}
// ---------- 인스펙터 QA-3 ----------
function inspRay(e, a) {
  const cx = Math.cos(a), cy = Math.sin(a);
  let d = 0;
  for (; d < 1200; d += 6) { const x = e.x + cx * d, y = e.y + cy * d; if (x < RX0 || x > RX1 || y < RY0 || y > RY1 || room.obstacles.some((o) => inRect(x, y, o))) break; }
  return d;
}
function updateInsp(e, dt, dp, ap) {
  const p = player;
  if (e.beamT > 0) e.beamT -= dt;
  if (e.state === "move") {
    let mx = 0, my = 0, sp = INSP.sp;
    if (!p.dead && dp > INSP.far) { mx = Math.cos(ap); my = Math.sin(ap); }
    else if (!p.dead && dp < INSP.near) { mx = -Math.cos(ap); my = -Math.sin(ap); sp *= 0.8; e.folded = true; }
    else { e.folded = false; e.strafe = e.strafe || (Math.random() < 0.5 ? 1 : -1); mx = -Math.sin(ap) * 0.4 * e.strafe; my = Math.cos(ap) * 0.4 * e.strafe; }
    e.x += mx * sp * dt; e.y += my * sp * dt; e.face = ap;
    e.cd -= dt;
    if (!p.dead && e.cd <= 0 && dp < INSP.far + 60 && dp > 90 && los(e, p)) { e.state = "aim"; e.t = INSP.aimT; e.aim = ap; e.folded = false; sfx("windup"); }
  } else if (e.state === "aim") {
    e.t -= dt;
    if (e.t > INSP.lockT && !p.dead) e.aim += clamp(angDiff(e.aim, ap), -4 * dt, 4 * dt);
    e.len = inspRay(e, e.aim);
    if (e.t <= 0) {
      e.len = inspRay(e, e.aim);
      const cx = Math.cos(e.aim), cy = Math.sin(e.aim), t = clamp((p.x - e.x) * cx + (p.y - e.y) * cy, 0, e.len);
      const px = e.x + cx * t, py = e.y + cy * t;
      if (!p.dead && p.z < 40 && Math.hypot(p.x - px, p.y - py) < p.r + 6) hurtPlayer(INSP.dmg, e, "인스펙터의 검사 레이저에 맞았어요");
      e.beamT = 0.25; e.state = "cool"; e.t = 0.9; sfx("zap"); shake(4);
    }
  } else if (e.state === "cool") {
    e.t -= dt; if (e.t <= 0) { e.state = "move"; e.cd = INSP.cd + Math.random() * 0.8; }
  }
}
function inspInterrupt(e) {
  if (e.type === "insp" && e.state === "aim") { e.state = "cool"; e.t = 0.6; addText(e.x, e.y - 50, "조준 끊김", C.visor, false); }
}
function drawInsp(e) {
  const flash = e.flash > 0, z0 = dropZ(e), X = e.x, Y = syf(e.y, z0), s = 0.85;
  const fold = e.folded ? 0.55 : 1, dir = Math.cos(e.state === "aim" ? e.aim : e.face || 0) >= 0 ? 1 : -1;
  ctx.strokeStyle = "#59616b"; ctx.lineWidth = 2.5; ctx.lineCap = "round";
  for (const [dx, dy] of [[-18, 0], [18, 0], [4, 6]]) { ctx.beginPath(); ctx.moveTo(X, Y - 30 * s * fold); ctx.lineTo(X + dx * s * fold, Y + dy * s - 2); ctx.stroke(); }
  const hy = Y - 30 * s * fold - 14 * s;
  ctx.fillStyle = "#8b949e"; ctx.fillRect(X - 2, hy, 4, 14 * s);
  ctx.fillStyle = flash ? "#fff" : cLin(ctx, X - 20 * s, 0, X + 20 * s, 0, [[0, "#c9d3dc"], [0.5, "#f2f6f8"], [1, "#9aa4ad"]]);
  cRR(ctx, X - 20 * s, hy - 26 * s, 40 * s, 28 * s, 8 * s); ctx.fill();
  ctx.fillStyle = "#3ee0d0"; ctx.fillRect(X - 20 * s, hy - 6 * s, 40 * s, 3 * s);
  const lx = X + dir * 14 * s, ly = hy - 12 * s, aim = e.state === "aim";
  ctx.fillStyle = "#1a1d20"; ctx.beginPath(); ctx.arc(lx, ly, 11 * s, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = aim ? C.danger : "#5ad8ff"; ctx.beginPath(); ctx.arc(lx, ly, 6 * s, 0, Math.PI * 2); ctx.fill();
  if (aim) { const lg = ctx.createRadialGradient(lx, ly, 1, lx, ly, 16); lg.addColorStop(0, "rgba(255,75,58,0.6)"); lg.addColorStop(1, "rgba(255,75,58,0)"); ctx.fillStyle = lg; ctx.fillRect(lx - 16, ly - 16, 32, 32); }
  if (e.beamT > 0) {
    const ex = e.x + Math.cos(e.aim) * e.len, ey = syf(e.y + Math.sin(e.aim) * e.len, 24);
    ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = e.beamT / 0.25; ctx.lineCap = "round";
    ctx.strokeStyle = "rgba(255,70,60,0.35)"; ctx.lineWidth = 12; ctx.beginPath(); ctx.moveTo(lx, ly); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.strokeStyle = "rgba(255,230,220,0.95)"; ctx.lineWidth = 3; ctx.stroke(); ctx.restore();
  }
  return syf(e.y) - (hy - 26 * s) + 4;
}
function drawInspMarks(e) {
  if (e.type !== "insp" || e.state !== "aim") return;
  const locked = e.t <= INSP.lockT, k = 1 - e.t / INSP.aimT;
  ctx.save(); ctx.globalAlpha = locked ? 0.95 : 0.4 + k * 0.4; ctx.strokeStyle = C.danger; ctx.lineWidth = locked ? 3.5 : 2; ctx.setLineDash(locked ? [] : [10, 7]);
  ctx.beginPath(); ctx.moveTo(e.x, syf(e.y)); ctx.lineTo(e.x + Math.cos(e.aim) * e.len, syf(e.y + Math.sin(e.aim) * e.len)); ctx.stroke(); ctx.restore();
}
// 3구역 테스트: 무작위 모듈 5개(희귀)로 3구역 첫 방에서 시작
function startZone3Test() {
  startRun();
  run.test = "z3";
  for (const sl of SLOT_ORDER) { const ids = Object.keys(MODS).filter((id) => MODS[id].slot === sl); player.mods[sl] = { id: ids[Math.floor(Math.random() * ids.length)], r: 1 }; }
  recalcStats();
  room.n = ZONE_ROOMS * 2;
  enterDoor({ type: "exit" });
}

// ================= 최종 보스: 품질 판정기 QC-9 =================
const QC = {
  hp: 2400, r: 58, hover: 88, openT: 2, openMul: 2, closedMul: 0.5,
  scanWarn: 1.0, scanH: 130, scanV: 200, scanDmg: 15,
  aimT: 1.5, aimT2: 0.8, lockT: 0.3, beamT: 0.9, sweep: Math.PI / 3, beamDmg: 25,
  stampWarn: 1.0, stampR: 36, stampDmg: 20,
  summonT: 3, rageT: 1.6, judgeT: 3, judgeR: 48, judgeDmg: 40,
};
function makeQC9(x, y) {
  return { type: "boss", kind: "qc9", air: true, x, y, r: QC.r, hp: QC.hp, maxHp: QC.hp, vx: 0, vy: 0, flash: 0, state: "move", t: 1.8, tMax: 1, last: "", p2: false, lens: false, inv: false, beams: [], stamps: [], hpLag: QC.hp, lagT: 0, summoned: {}, bob: 0, tx: x, ty: y, aim: Math.PI / 2, shots: 0 };
}
function qcMul(e) { return e.inv ? 0 : (e.p2 || e.lens) ? QC.openMul : QC.closedMul; }
function qcOpen(e) { e.state = "open"; e.t = e.tMax = QC.openT; e.lens = true; sfx("door"); addText(e.x, e.y - 90, "렌즈 열림!", C.danger, true); }
function qcNext(e) {
  const pool = (e.p2 ? ["scan", "beam", "stamp", "judge"] : ["scan", "beam", "stamp"]).filter((k) => k !== e.last);
  const k = pool[Math.floor(Math.random() * pool.length)];
  e.last = k; e.lens = false;
  if (k === "scan") qcScan(e);
  else if (k === "beam") { e.state = "aim"; e.t = e.tMax = QC.aimT; e.shots = e.p2 ? 2 : 1; e.aim = angTo(e, player); sfx("windup"); }
  else if (k === "stamp") qcStamp(e);
  else { // 최종 판정
    const p = player; let c, tries = 0;
    do { const a = Math.random() * Math.PI * 2, d = rand(150, 250); c = { x: clamp(p.x + Math.cos(a) * d, RX0 + 70, RX1 - 70), y: clamp(p.y + Math.sin(a) * d, RY0 + 70, RY1 - 70) }; tries++; }
    while (tries < 30 && room.obstacles.some((o) => inRect(c.x, c.y, o, QC.judgeR)));
    e.judge = c; e.state = "judge"; e.t = e.tMax = QC.judgeT; sfx("windup");
    showBanner("최종 판정", "초록 PASS 원 안으로 들어가세요!"); banner.t = 1.4;
  }
}
function qcScan(e) {
  const h = (y0, y1) => ({ ax: "h", pos: y0, to: y1, sp: QC.scanH, hit: false }), v = (x0, x1) => ({ ax: "v", pos: x0, to: x1, sp: QC.scanV, hit: false });
  e.beams = [h(RY0 + 50, RY1 - 50), h(RY1 - 50, RY0 + 50), v(RX0 + 40, RX1 - 40)];
  if (e.p2) e.beams.push(v(RX1 - 40, RX0 + 40));
  e.state = "scanWarn"; e.t = e.tMax = QC.scanWarn; sfx("windup");
}
function qcStamp(e) {
  const p = player, n = e.p2 ? 6 : 4, st = [];
  if (e.p2) st.push({ x: p.x, y: p.y });
  let tries = 0;
  while (st.length < n && tries++ < 200) {
    const q = { x: RX0 + 60 + Math.random() * (RX1 - RX0 - 120), y: RY0 + 60 + Math.random() * (RY1 - RY0 - 120) };
    if (st.some((o) => dist(o, q) < QC.stampR * 2.4)) continue;
    if (st.length === 0 && dist(q, p) > 160) continue; // 하나는 B-07 가까이
    st.push(q);
  }
  e.stamps = st.map((q) => ({ ...q, t: QC.stampWarn }));
  e.state = "stamp"; e.t = QC.stampWarn + 0.35; sfx("windup");
}
function qcSummon(e) {
  e.inv = true; e.lens = false;
  const types = ["spark", "spark", "lift", "insp", "drum"];
  for (let i = 0; i < 2; i++) {
    const type = types[Math.floor(Math.random() * types.length)], allow = ELITE_ALLOW[type];
    let q, tries = 0;
    do { q = { x: RX0 + 60 + Math.random() * (RX1 - RX0 - 120), y: RY0 + 80 + Math.random() * (RY1 - RY0 - 160) }; tries++; } while (tries < 40 && (dist(q, player) < 200 || room.obstacles.some((o) => inRect(q.x, q.y, o, 26))));
    pending.push({ type, x: q.x, y: q.y, r: ENEMY_R[type], t: 0.8 + i * 0.3, elite: allow[Math.floor(Math.random() * allow.length)] });
  }
  addText(e.x, e.y - 100, "재검사!", C.visor, true); sfx("revive");
}
function qcRay(x, y, a) {
  const cx = Math.cos(a), cy = Math.sin(a);
  let d = 0;
  for (; d < 1200; d += 6) { const px = x + cx * d, py = y + cy * d; if (px < RX0 || px > RX1 || py < RY0 || py > RY1 || room.obstacles.some((o) => inRect(px, py, o))) break; }
  return d;
}
function updateQC9(e, dt) {
  const p = player, ap = angTo(e, p);
  e.bob += dt; if (e.invT > 0) e.invT -= dt;
  // 체력 구간: 75 · 50 · 25%
  for (const th of [0.75, 0.5, 0.25]) {
    if (!e.summoned[th] && e.hp <= e.maxHp * th && ["move", "open"].includes(e.state)) {
      e.summoned[th] = true; e.beams = []; e.stamps = []; e.judge = null;
      if (th === 0.5 && !e.p2) {
        e.p2 = true; e.state = "rage"; e.t = QC.rageT; e.inv = true;
        burst(e.x, e.y, 50, "#ff6a3a", 420, 0.8, 4); debris(e.x, e.y, 18, "#c9d3dc");
        waves.push({ x: e.x, y: e.y, t: 0, max: 0.6, R: 200, col: "#ff6a3a" });
        showBanner("외장 해제!", "코어가 드러났어요 · 렌즈가 계속 열려 있어요"); banner.t = 1.8;
        hitstop = Math.max(hitstop, 0.2); shake(20); sfx("roar"); buzz(80);
      } else { e.state = "summon"; e.t = QC.summonT; }
      qcSummon(e);
      return;
    }
  }
  e.t -= dt;
  // 이동: 1페이즈는 위쪽에서 B-07을 따라 좌우로, 2페이즈는 방 안을 떠다님
  if (e.p2) {
    if (dist(e, { x: e.tx, y: e.ty }) < 20) { e.tx = RX0 + 120 + Math.random() * (RX1 - RX0 - 240); e.ty = RY0 + 110 + Math.random() * (RY1 - RY0 - 260); }
    const a = Math.atan2(e.ty - e.y, e.tx - e.x); e.x += Math.cos(a) * 70 * dt; e.y += Math.sin(a) * 70 * dt;
  } else {
    const tx = clamp(p.x, RX0 + 140, RX1 - 140); e.x += clamp(tx - e.x, -45 * dt, 45 * dt); e.y += clamp(RY0 + 170 - e.y, -40 * dt, 40 * dt);
  }
  const s = e.state;
  if (s === "move") { if (e.t <= 0 && !p.dead) qcNext(e); }
  else if (s === "open") { if (e.t <= 0) { e.lens = false; e.state = "move"; e.t = e.p2 ? 0.6 : 1.0; } }
  else if (s === "rage") { if (e.t <= 0) { e.inv = false; e.state = "move"; e.t = 0.8; } }
  else if (s === "summon") { if (e.t <= 0) { e.inv = false; e.state = "move"; e.t = 0.6; } }
  else if (s === "scanWarn") { if (e.t <= 0) { e.state = "scan"; sfx("zap"); } }
  else if (s === "scan") {
    let alive = 0;
    for (const b of e.beams) {
      if (b.done) continue;
      const dir = Math.sign(b.to - b.pos); b.pos += dir * b.sp * dt;
      if ((dir > 0 && b.pos >= b.to) || (dir < 0 && b.pos <= b.to)) { b.done = true; continue; }
      alive++;
      if (p.dead || p.inv > 0 || p.dash.t > 0) continue;
      const hit = b.ax === "h" ? p.z < 14 && Math.abs(p.y - b.pos) < LASER.half + 4 : Math.abs(p.x - b.pos) < LASER.half + 6;
      if (hit) { hurtPlayer(QC.scanDmg, null, "QC-9의 다중 스캔에 걸렸어요"); p.markT = LASER.mark; }
    }
    if (!alive) { e.beams = []; qcOpen(e); }
  } else if (s === "aim") {
    if (e.t > QC.lockT && !p.dead) e.aim += clamp(angDiff(e.aim, ap), -3 * dt, 3 * dt);
    e.len = qcRay(e.x, e.y, e.aim);
    if (e.t <= 0) { e.state = "beam"; e.t = e.tMax = QC.beamT; e.sw = Math.random() < 0.5 ? -1 : 1; e.aim -= e.sw * QC.sweep / 2; sfx("zap"); shake(6); }
  } else if (s === "beam") {
    e.aim += e.sw * QC.sweep / QC.beamT * dt;
    e.len = qcRay(e.x, e.y, e.aim);
    const cx = Math.cos(e.aim), cy = Math.sin(e.aim), t = clamp((p.x - e.x) * cx + (p.y - e.y) * cy, 0, e.len);
    if (!p.dead && p.z < 50 && Math.hypot(p.x - (e.x + cx * t), p.y - (e.y + cy * t)) < p.r + 10) hurtPlayer(QC.beamDmg, null, "QC-9의 판정 레이저에 맞았어요");
    if (Math.random() < 0.6) particles.push({ x: e.x + cx * e.len, y: e.y + cy * e.len, z: 6, vz: rand(60, 160), vx: rand(-60, 60), vy: rand(-60, 60), life: 0.3, max: 0.3, color: Math.random() < 0.5 ? "#fff1a8" : "#ff6a3a", size: rand(2, 4), glow: true });
    if (e.t <= 0) { e.shots--; if (e.shots > 0) { e.state = "aim"; e.t = e.tMax = QC.aimT2; e.aim = ap; sfx("windup"); } else qcOpen(e); }
  } else if (s === "stamp") {
    for (const st of e.stamps) {
      if (st.done) continue;
      st.t -= dt;
      if (st.t <= 0) {
        st.done = true; st.boom = 0.35;
        shake(8); sfx("slam"); burst(st.x, st.y, 14, "#ff4b3a", 260, 0.35, 2.6); room.cracks.push({ x: st.x, y: st.y, seed: Math.random() * 10 });
        if (!p.dead && p.z < 30 && dist(p, st) < QC.stampR + p.r * 0.5) { hurtPlayer(QC.stampDmg, st, "QC-9에게 불량 도장이 찍혔어요"); p.markT = LASER.mark; }
      }
    }
    for (const st of e.stamps) if (st.boom > 0) st.boom -= dt;
    if (e.t <= 0) { e.stamps = []; qcOpen(e); }
  } else if (s === "judge") {
    if (e.t <= 0) {
      const ok = dist(p, e.judge) < QC.judgeR;
      if (!p.dead && !ok) { p.inv = 0; const dt0 = p.dash.t; p.dash.t = 0; hurtPlayer(QC.judgeDmg, null, "최종 판정에서 불합격 처리됐어요"); p.dash.t = dt0; showBanner("불합격", ""); }
      else if (ok) { showBanner("합격!", ""); addText(p.x, p.y - 40, "PASS", C.good, true); sfx("heal"); }
      banner.t = 0.9; e.judge = null; shake(10); qcOpen(e);
    }
  }
}
// ---------- 그리기 ----------
function drawQCBody(g, x, y, s, o) {
  const p2 = !!o.p2, dead = !!o.dead, cy = y - QC.hover - (o.bob || 0);
  // 방출 빛
  if (!dead) { g.save(); g.globalCompositeOperation = "lighter"; const bg = g.createLinearGradient(0, cy + 30 * s, 0, y); bg.addColorStop(0, p2 ? "rgba(255,80,60,0.28)" : "rgba(62,224,208,0.22)"); bg.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = bg;
    g.beginPath(); g.moveTo(x - 24 * s, cy + 40 * s); g.lineTo(x + 24 * s, cy + 40 * s); g.lineTo(x + 70 * s, y); g.lineTo(x - 70 * s, y); g.closePath(); g.fill(); g.restore(); }
  const ring = !p2 && !dead;
  if (ring) {
    // 도장 팔
    for (const sg of [-1, 1]) {
      const ax = x + sg * 70 * s, ay = cy + 10 * s, sx = x + sg * 150 * s, sy = cy + 110 * s + (o.stampDrop || 0);
      g.lineCap = "round"; g.strokeStyle = "#454c55"; g.lineWidth = 14 * s; g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo((ax + sx) / 2, Math.min(ay, sy) - 40 * s, sx, sy - 30 * s); g.stroke();
      g.strokeStyle = "#dfe5ea"; g.lineWidth = 9 * s; g.stroke();
      g.fillStyle = "#59616b"; g.fillRect(sx - 5 * s, sy - 34 * s, 10 * s, 18 * s);
      g.fillStyle = "#e9eef1"; cRR(g, sx - 26 * s, sy - 18 * s, 52 * s, 18 * s, 4 * s); g.fill();
      g.fillStyle = "#b8242a"; cRR(g, sx - 28 * s, sy, 56 * s, 9 * s, 3 * s); g.fill();
      g.fillStyle = "#ff4b3a"; g.font = `700 ${Math.max(7, 11 * s)}px "IBM Plex Sans KR", sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("불량", sx, sy - 9 * s);
    }
    g.strokeStyle = "#b8c3ca"; g.lineWidth = 20 * s; g.beginPath(); g.ellipse(x, cy, 120 * s, 46 * s, 0, Math.PI, 0); g.stroke();
  }
  const core = g.createRadialGradient(x - 20 * s, cy - 30 * s, 6 * s, x, cy, 72 * s);
  if (dead) { core.addColorStop(0, "#5a6168"); core.addColorStop(1, "#202428"); }
  else { core.addColorStop(0, p2 ? "#ffd0c8" : "#ffffff"); core.addColorStop(0.6, p2 ? "#d86a5a" : "#cfd8de"); core.addColorStop(1, p2 ? "#5a1a14" : "#7c8891"); }
  g.fillStyle = core; g.beginPath(); g.arc(x, cy, 70 * s, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(0,0,0,0.18)"; g.lineWidth = 2 * s; g.beginPath(); g.ellipse(x, cy, 70 * s, 22 * s, 0, 0, Math.PI * 2); g.stroke();
  const lr = 30 * s, ly = cy + 6 * s;
  g.fillStyle = "#1a1d20"; g.beginPath(); g.arc(x, ly, lr + 8 * s, 0, Math.PI * 2); g.fill();
  if (!dead && (o.open || p2)) {
    const lg = g.createRadialGradient(x, ly, 2, x, ly, lr); lg.addColorStop(0, "#fff6e0"); lg.addColorStop(0.4, p2 ? "#ff6a3a" : "#ff4b3a"); lg.addColorStop(1, "#5a1010"); g.fillStyle = lg; g.beginPath(); g.arc(x, ly, lr, 0, Math.PI * 2); g.fill();
    g.save(); g.globalCompositeOperation = "lighter"; const gl = g.createRadialGradient(x, ly, 2, x, ly, 80 * s); gl.addColorStop(0, "rgba(255,90,60,0.5)"); gl.addColorStop(1, "rgba(0,0,0,0)"); g.fillStyle = gl; g.fillRect(x - 90 * s, cy - 80 * s, 180 * s, 180 * s); g.restore();
  } else {
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + (o.spin || 0); g.fillStyle = dead ? "#24282c" : i % 2 ? "#3a4552" : "#4a5562"; g.beginPath(); g.moveTo(x, ly); g.arc(x, ly, lr, a, a + Math.PI / 3); g.closePath(); g.fill(); }
    if (!dead) { g.fillStyle = o.charge ? C.danger : C.visor; g.beginPath(); g.arc(x, ly, (o.charge ? 9 : 6) * s, 0, Math.PI * 2); g.fill(); }
  }
  if (ring) {
    g.strokeStyle = cLin(g, x - 120 * s, 0, x + 120 * s, 0, [[0, "#9aa4ad"], [0.5, "#f2f6f8"], [1, "#9aa4ad"]]); g.lineWidth = 20 * s; g.beginPath(); g.ellipse(x, cy, 120 * s, 46 * s, 0, 0, Math.PI); g.stroke();
    g.strokeStyle = o.warn && Math.floor(performance.now() / 90) % 2 ? C.danger : C.visor; g.lineWidth = 4 * s; g.beginPath(); g.ellipse(x, cy, 120 * s, 46 * s, 0, 0.2, Math.PI - 0.2); g.stroke();
    g.fillStyle = "#1b1d20"; cRR(g, x - 26 * s, cy + 40 * s, 52 * s, 16 * s, 3 * s); g.fill();
    g.fillStyle = C.visor; g.font = `700 ${Math.max(6, 11 * s)}px "IBM Plex Mono", monospace`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText("QC-9", x, cy + 48.5 * s);
  }
  if (o.flash) { g.save(); g.globalCompositeOperation = "lighter"; g.fillStyle = "rgba(255,255,255,0.35)"; g.beginPath(); g.arc(x, cy, 70 * s, 0, Math.PI * 2); g.fill(); g.restore(); }
  if (o.inv) { g.save(); g.globalCompositeOperation = "lighter"; g.strokeStyle = `rgba(62,224,208,${0.5 + 0.3 * Math.sin(performance.now() / 120)})`; g.lineWidth = 3; g.beginPath(); g.arc(x, cy, 92 * s, 0, Math.PI * 2); g.stroke(); g.fillStyle = "rgba(62,224,208,0.08)"; g.fill(); g.restore(); }
  if (p2 && !dead) { g.save(); g.globalCompositeOperation = "lighter"; for (let i = 0; i < 8; i++) { g.fillStyle = Math.random() < 0.5 ? "rgba(255,200,90,0.85)" : "rgba(255,90,60,0.8)"; g.beginPath(); g.arc(x + rand(-80, 80) * s, cy + rand(-80, 80) * s, rand(1, 3) * s * 1.5, 0, Math.PI * 2); g.fill(); } g.restore(); }
  return cy;
}
const QC_S = 0.55;
function drawQC9(e) {
  const X = e.x, Y = syf(e.y, dropZ(e)), bob = Math.sin(e.bob * 2) * 4;
  const drop = e.state === "stamp" ? Math.max(0, 1 - Math.max(0, e.t - 0.35) / QC.stampWarn) * 18 : 0;
  const cy = drawQCBody(ctx, X, Y, QC_S, { p2: e.p2, open: e.lens, inv: e.inv, flash: e.flash > 0, bob, charge: e.state === "aim", warn: ["scanWarn", "aim", "stamp", "judge"].includes(e.state), spin: e.bob, stampDrop: drop });
  if (e.state === "beam" || e.state === "aim") {
    const ly = cy + 6 * QC_S, ex = e.x + Math.cos(e.aim) * e.len, ey = syf(e.y + Math.sin(e.aim) * e.len, 16);
    ctx.save(); ctx.lineCap = "round";
    if (e.state === "beam") {
      ctx.globalCompositeOperation = "lighter";
      ctx.strokeStyle = "rgba(255,70,60,0.35)"; ctx.lineWidth = 22; ctx.beginPath(); ctx.moveTo(X, ly); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.strokeStyle = "rgba(255,120,90,0.9)"; ctx.lineWidth = 8; ctx.stroke();
      ctx.strokeStyle = "rgba(255,245,235,1)"; ctx.lineWidth = 3; ctx.stroke();
    } else {
      const locked = e.t <= QC.lockT; ctx.globalAlpha = locked ? 0.9 : 0.5; ctx.strokeStyle = C.danger; ctx.lineWidth = locked ? 3 : 1.5; ctx.setLineDash(locked ? [] : [8, 6]);
      ctx.beginPath(); ctx.moveTo(X, ly); ctx.lineTo(ex, ey); ctx.stroke();
    }
    ctx.restore();
  }
}
function drawQCMarks(e) {
  if (e.drop > 0) return;
  floorEllipse(e.x, e.y, 70, 50, "rgba(0,0,0,0.3)");
  // 스캔 빔
  const warn = e.state === "scanWarn", blink = Math.floor(performance.now() / 110) % 2 === 0;
  for (const b of e.beams) {
    if (b.done) continue;
    if (warn) {
      ctx.save(); ctx.globalAlpha = blink ? 0.85 : 0.35; ctx.strokeStyle = C.danger; ctx.lineWidth = 2; ctx.setLineDash([10, 8]);
      ctx.beginPath(); if (b.ax === "h") { ctx.moveTo(RX0, syf(b.pos)); ctx.lineTo(RX1, syf(b.pos)); } else { ctx.moveTo(b.pos, syf(RY0)); ctx.lineTo(b.pos, syf(RY1)); } ctx.stroke();
      ctx.fillStyle = C.danger; const d = Math.sign(b.to - b.pos);
      if (b.ax === "h") for (const ax of [RX0 + 60, W / 2, RX1 - 60]) { ctx.beginPath(); ctx.moveTo(ax, syf(b.pos + d * 22)); ctx.lineTo(ax - 8, syf(b.pos + d * 8)); ctx.lineTo(ax + 8, syf(b.pos + d * 8)); ctx.fill(); }
      else for (const ay of [RY0 + 60, (RY0 + RY1) / 2, RY1 - 60]) { ctx.beginPath(); ctx.moveTo(b.pos + d * 22, syf(ay)); ctx.lineTo(b.pos + d * 8, syf(ay) - 7); ctx.lineTo(b.pos + d * 8, syf(ay) + 7); ctx.fill(); }
      ctx.restore();
    } else {
      ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
      if (b.ax === "h") { const Y = syf(b.pos, LASER.z); ctx.strokeStyle = "rgba(255,60,60,0.28)"; ctx.lineWidth = 16; ctx.beginPath(); ctx.moveTo(RX0, Y); ctx.lineTo(RX1, Y); ctx.stroke(); ctx.strokeStyle = "rgba(255,80,70,0.9)"; ctx.lineWidth = 4; ctx.stroke(); ctx.strokeStyle = "rgba(255,235,225,0.95)"; ctx.lineWidth = 1.5; ctx.stroke(); }
      else { // 세로: 키 큰 빛의 벽 (점프로 못 넘음 → 대시로 통과)
        const x = b.pos, y0 = syf(RY0), y1 = syf(RY1);
        const gw = ctx.createLinearGradient(x - 14, 0, x + 14, 0); gw.addColorStop(0, "rgba(255,60,60,0)"); gw.addColorStop(0.5, "rgba(255,90,70,0.35)"); gw.addColorStop(1, "rgba(255,60,60,0)");
        ctx.fillStyle = gw; ctx.fillRect(x - 14, y0 - 60, 28, y1 - y0 + 60);
        ctx.strokeStyle = "rgba(255,80,70,0.9)"; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
        ctx.strokeStyle = "rgba(255,235,225,0.95)"; ctx.lineWidth = 1.5; ctx.stroke();
      }
      ctx.restore();
    }
  }
  // 도장
  for (const st of e.stamps) {
    ctx.save(); ctx.translate(st.x, syf(st.y)); ctx.scale(1, SY);
    if (!st.done) {
      const k = 1 - st.t / QC.stampWarn;
      ctx.globalAlpha = 0.2 + k * 0.35; ctx.fillStyle = C.danger; ctx.beginPath(); ctx.arc(0, 0, QC.stampR, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 0.9; ctx.strokeStyle = C.danger; ctx.lineWidth = 2.5; ctx.setLineDash([6, 5]); ctx.stroke(); ctx.setLineDash([]);
      ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(12, 12); ctx.moveTo(12, -12); ctx.lineTo(-12, 12); ctx.stroke();
    } else if (st.boom > 0) { ctx.globalAlpha = st.boom / 0.35; ctx.fillStyle = "#b8242a"; ctx.beginPath(); ctx.arc(0, 0, QC.stampR, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  // 최종 판정: 바닥 전체 빨강, PASS 원만 초록
  if (e.state === "judge" && e.judge) {
    const c = e.judge, k = 1 - e.t / QC.judgeT;
    ctx.save();
    ctx.beginPath(); ctx.rect(RX0, syf(RY0), RX1 - RX0, syf(RY1) - syf(RY0));
    ctx.ellipse(c.x, syf(c.y), QC.judgeR, QC.judgeR * SY, 0, 0, Math.PI * 2, true);
    ctx.fillStyle = `rgba(255,40,30,${0.12 + k * 0.22})`; ctx.fill("evenodd");
    ctx.translate(c.x, syf(c.y)); ctx.scale(1, SY);
    ctx.fillStyle = "rgba(89,227,154,0.3)"; ctx.beginPath(); ctx.arc(0, 0, QC.judgeR, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.good; ctx.lineWidth = 3; ctx.stroke();
    ctx.restore();
    ctx.fillStyle = C.good; ctx.font = '700 14px "IBM Plex Mono", monospace'; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("PASS", c.x, syf(c.y));
  }
}
function drawQCOverlay(e) {
  if (e.state === "judge" && e.judge) {
    const n = Math.ceil(e.t);
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = '700 64px "IBM Plex Mono", monospace';
    ctx.fillStyle = "rgba(0,0,0,0.5)"; ctx.fillText(n, W / 2 + 3, 303); ctx.fillStyle = C.danger; ctx.fillText(n, W / 2, 300); ctx.restore();
  }
}
function drawQCBar(b) {
  const w = 420, x = W / 2 - w / 2, y = 82;
  if (b.lagT > 0) b.lagT -= 1 / 60; else if (b.hpLag > b.hp) b.hpLag = Math.max(b.hp, b.hpLag - b.maxHp * 0.25 / 60);
  ctx.save();
  ctx.fillStyle = "rgba(10,12,14,0.82)"; ctx.fillRect(x - 10, y - 22, w + 20, 40);
  ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.font = '700 12px "IBM Plex Sans KR", sans-serif';
  ctx.fillStyle = C.text; ctx.fillText("품질 판정기 QC-9", x, y - 10);
  const tag = b.hp <= 0 ? ["파괴됨", C.muted] : b.inv ? ["무적 (재검사 중)", C.visor] : b.p2 ? ["외장 해제 · 피해 2배", C.danger] : b.lens ? ["렌즈 열림 · 피해 2배", C.danger] : ["렌즈 닫힘 · 피해 50%", C.muted];
  ctx.textAlign = "right"; ctx.fillStyle = tag[1]; ctx.fillText(tag[0], x + w, y - 10);
  ctx.fillStyle = "#14262a"; ctx.fillRect(x, y, w, 10);
  ctx.fillStyle = "rgba(255,255,255,0.7)"; ctx.fillRect(x, y, w * clamp(b.hpLag / b.maxHp, 0, 1), 10);
  ctx.fillStyle = b.p2 ? C.danger : C.visor; ctx.fillRect(x, y, w * clamp(b.hp / b.maxHp, 0, 1), 10);
  ctx.strokeStyle = C.hazard; ctx.lineWidth = 1.5; ctx.strokeRect(x - 0.5, y - 0.5, w + 1, 11);
  ctx.fillStyle = C.hazard; for (const f of [0.75, 0.5, 0.25]) ctx.fillRect(x + w * f - 1, y - (f === 0.5 ? 3 : 1), 2, f === 0.5 ? 16 : 12);
  ctx.restore();
}
// ---------- 엔딩 ----------
let endT = 0;
function startEnding() {
  run.won = true; run.score += 500; run.zt = run.zt || []; run.zt.push(run.time);
  state = "ending"; endT = 0; releaseAllTouches(); keys.clear(); sfx("revive");
}
function updateEnding(dt) { endT += dt; if (endT >= 5.2 && state === "ending") { state = "dead"; showResult(true); } }
function drawEnding() {
  const t = endT;
  ctx.fillStyle = "#0c0e10"; ctx.fillRect(0, 0, W, H);
  // 바깥 하늘 (셔터 뒤)
  const open = clamp((t - 0.4) / 1.6, 0, 1), sx0 = W / 2 - 200, sw = 400, gy = 470;
  const sky = ctx.createLinearGradient(0, 120, 0, gy); sky.addColorStop(0, "#7ec8f0"); sky.addColorStop(1, "#ffe9b0");
  ctx.fillStyle = sky; ctx.fillRect(sx0, 120, sw, gy - 120);
  ctx.fillStyle = "#fff6d0"; ctx.beginPath(); ctx.arc(W / 2 + 90, 230, 34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#8fbf6a"; ctx.fillRect(sx0, gy - 40, sw, 40);
  // 셔터
  const sh = (gy - 120) * (1 - open);
  ctx.fillStyle = "#3a4048"; ctx.fillRect(sx0, 120, sw, sh);
  ctx.fillStyle = "#2b3036"; for (let y = 120; y < 120 + sh; y += 14) ctx.fillRect(sx0, y, sw, 4);
  ctx.fillStyle = C.hazard; ctx.fillRect(sx0, 120 + sh - 8, sw, 8);
  // 문틀과 공장 벽
  ctx.fillStyle = "#24282d"; ctx.fillRect(0, 100, sx0, 400); ctx.fillRect(sx0 + sw, 100, W - sx0 - sw, 400); ctx.fillRect(0, 100, W, 20);
  // 빛이 바닥으로
  if (open > 0) { ctx.save(); ctx.globalAlpha = open * 0.55; const lg = ctx.createLinearGradient(0, gy, 0, H); lg.addColorStop(0, "rgba(255,236,180,0.9)"); lg.addColorStop(1, "rgba(255,236,180,0)"); ctx.fillStyle = lg; ctx.beginPath(); ctx.moveTo(sx0, gy); ctx.lineTo(sx0 + sw, gy); ctx.lineTo(sx0 + sw + 180, H); ctx.lineTo(sx0 - 180, H); ctx.closePath(); ctx.fill(); ctx.restore(); }
  ctx.fillStyle = "#1a1d21"; ctx.fillRect(0, gy, sx0, H - gy); ctx.fillRect(sx0 + sw, gy, W - sx0 - sw, H - gy);
  // B-07: 아래에서 문 쪽으로 걸어감
  const wk = clamp((t - 1.6) / 2.6, 0, 1), bx = W / 2, by = 600 - wk * 150, sc = 1.6 - wk * 0.7;
  ctx.save(); ctx.globalAlpha = 1 - clamp((t - 4.1) / 0.6, 0, 1);
  ctx.translate(bx, by); ctx.scale(sc, sc); ctx.translate(-bx, -by);
  drawChar(run.char || charId, bx, by, -Math.PI / 2, { t: performance.now() / 1000, phase: t * 10, moving: wk > 0 && wk < 1, wrench: false });
  ctx.restore();
  // 문구
  const ta = clamp((t - 2.2) / 0.6, 0, 1);
  ctx.save(); ctx.globalAlpha = ta; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = '400 52px "Black Han Sans", "IBM Plex Sans KR", sans-serif'; ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText("공장 탈출 성공", W / 2 + 3, 63); ctx.fillStyle = C.hazard; ctx.fillText("공장 탈출 성공", W / 2, 60);
  ctx.restore();
  // 하얗게 페이드
  if (t > 4.4) { ctx.fillStyle = `rgba(255,248,230,${clamp((t - 4.4) / 0.8, 0, 1)})`; ctx.fillRect(0, 0, W, H); }
}
function startBoss3Test() {
  startRun();
  run.test = "b3";
  for (const sl of SLOT_ORDER) { const ids = Object.keys(MODS).filter((id) => MODS[id].slot === sl); player.mods[sl] = { id: ids[Math.floor(Math.random() * ids.length)], r: 1 + (Math.random() < 0.4 ? 1 : 0) }; }
  recalcStats();
  room.n = ZONE_ROOMS * 3 - 1;
  enterDoor({ type: "boss" });
}

// ================= 순위표 (Supabase) =================
// 브라우저는 표에 직접 쓰지 못하고, 서버 함수 re_start_run / re_submit_run 을 거쳐서만 기록돼요.
const GAME_VER = "b1.2.0"; // 빌드할 때 자동으로 바뀌어요
const LB = { url: "https://uxjoswktbbcclhteublq.supabase.co", key: "sb_publishable_xo3vg1LR9R3ZrhWNezam3w_ssJjiYPn", top: 20 };
const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
let lbDevice = lsGet("re-device");
if (!lbDevice) { lbDevice = "d" + Math.random().toString(36).slice(2) + Date.now().toString(36); lsSet("re-device", lbDevice); }
async function lbCall(path, body) {
  const ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const tm = ctl ? setTimeout(() => ctl.abort(), 8000) : 0;
  try {
    const res = await fetch(LB.url + "/rest/v1/" + path, {
      method: body ? "POST" : "GET",
      headers: { apikey: LB.key, "Content-Type": "application/json", Accept: "application/json" },
      body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined,
    });
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error((data && (data.message || data.error)) || "http_" + res.status);
    return data;
  } finally { if (tm) clearTimeout(tm); }
}
// 판 시작: 테스트 판이 아니면 서버에서 판 토큰을 받아둬요
function lbStart(r) {
  r.lb = { token: null, err: null, sent: false };
  setTimeout(() => {
    if (r.test || run !== r) return;
    const ask = (retry) => lbCall("rpc/re_start_run", { p_device: lbDevice, p_version: GAME_VER })
      .then((t) => { if (run === r) r.lb.token = t; })
      .catch((e) => { if (run !== r) return; if (String(e.message).includes("too_fast") && retry) setTimeout(() => ask(false), 10500); else r.lb.err = String(e.message || e); });
    ask(true);
  }, 0);
}
function lbFmtTime(s) { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); }
function lbWhere(row) { return row.cleared ? "탈출" : roomLabel(row.room); }
// 결과 화면: 등록 양식
function lbShowForm(won) {
  const f = $("lbForm"), msg = $("lbMsg"), r = run;
  f.hidden = true; msg.textContent = ""; msg.className = "lb-msg";
  if (!r || r.test) { msg.textContent = r && r.test ? "테스트 판은 순위에 등록되지 않아요." : ""; return; }
  if (!r.lb || (!r.lb.token && r.lb.err)) { msg.textContent = "순위 서버에 연결하지 못해서 이번 판은 등록할 수 없어요."; msg.className = "lb-msg bad"; return; }
  if (r.lb.sent) return;
  f.hidden = false;
  $("lbName").value = lsGet("re-name") || "";
  $("lbSubmit").disabled = false;
  r.lb.final = { won };
}
async function lbSubmit() {
  const r = run, msg = $("lbMsg"), btn = $("lbSubmit");
  if (!r || !r.lb || r.lb.sent) return;
  const name = $("lbName").value.trim();
  if (name.length < 1 || name.length > 12) { msg.textContent = "닉네임은 1~12자로 적어주세요."; msg.className = "lb-msg bad"; return; }
  if (!r.lb.token) { msg.textContent = "아직 서버 응답을 기다리는 중이에요. 잠시 후 다시 눌러주세요."; msg.className = "lb-msg"; return; }
  lsSet("re-name", name);
  btn.disabled = true; msg.textContent = "등록하는 중…"; msg.className = "lb-msg";
  try {
    const res = await lbCall("rpc/re_submit_run", {
      p_token: r.lb.token, p_device: lbDevice, p_name: name, p_score: Math.round(r.score), p_time: Math.floor(r.time),
      p_room: room.n, p_cleared: !!(r.lb.final && r.lb.final.won && curZone() >= ZONES), p_kills: r.kills, p_robot: r.char, p_weapon: r.weapon,
    });
    if (res && res.ok) {
      r.lb.sent = true; $("lbForm").hidden = true;
      msg.textContent = res.improved ? `등록 완료! 전체 ${res.rank}위 (최고 기록 갱신)` : `등록됐어요. ${name}의 최고 기록은 ${res.best}점 · 전체 ${res.rank}위`;
      msg.className = "lb-msg good";
    } else {
      const why = { token: "이미 등록했거나 만료된 판이에요.", name: "닉네임을 확인해주세요.", time: "기록 검사를 통과하지 못했어요 (시간).", score: "기록 검사를 통과하지 못했어요 (점수).", range: "기록 검사를 통과하지 못했어요." }[res && res.error] || "등록하지 못했어요.";
      msg.textContent = why; msg.className = "lb-msg bad";
      if (res && res.error === "name") btn.disabled = false; else r.lb.sent = true;
    }
  } catch (e) { msg.textContent = "순위 서버에 연결하지 못했어요. 다시 눌러보세요."; msg.className = "lb-msg bad"; btn.disabled = false; }
}
// 순위표 창
let lbPrevFocus = null;
async function lbOpen() {
  lbPrevFocus = document.activeElement;
  const ov = $("ovRank"), list = $("rankList"), note = $("rankNote");
  ov.hidden = false; list.textContent = ""; note.textContent = "불러오는 중…"; note.className = "rank-note";
  $("btnRankClose").focus();
  try {
    const rows = await lbCall(`re_scores?select=name,score,time_sec,room,cleared,robot,weapon&order=score.desc,time_sec.asc&limit=${LB.top}`);
    if (ov.hidden) return;
    if (!rows || !rows.length) { note.textContent = "아직 등록된 기록이 없어요. 첫 기록의 주인공이 되어보세요!"; return; }
    note.textContent = "총점 순 · 동점이면 짧은 시간이 위 · 닉네임마다 최고 기록 1개";
    const me = lsGet("re-name");
    rows.forEach((row, i) => {
      const li = document.createElement("li");
      if (me && row.name === me) li.className = "me";
      const cells = [[String(i + 1), "rk"], [row.name, "nm"], [String(row.score), "sc"], [lbWhere(row), row.cleared ? "wh ok" : "wh"], [lbFmtTime(row.time_sec), "tm"],
        [((CHARS[row.robot] || {}).name || "") + " · " + ((WEAPONS[row.weapon] || {}).name || ""), "bd"]];
      for (const [t, c] of cells) { const s = document.createElement("span"); s.className = c; s.textContent = t; li.appendChild(s); }
      list.appendChild(li);
    });
  } catch (e) {
    note.textContent = "순위 서버에 연결하지 못했어요. (claude.ai 미리보기에서는 외부 연결이 막혀 있을 수 있어요. GitHub Pages 주소에서 열어보세요.)"; note.className = "rank-note bad";
  }
}
function lbClose() { $("ovRank").hidden = true; if (lbPrevFocus && lbPrevFocus.focus) lbPrevFocus.focus(); }

// ================= 웨이브 =================
function spawnWave(w) {
  const n = localN(room.n), z2 = curZone() === 2;
  let sparks, turrets, drums, lifts, drones = 0, medics = 0, insps = 0;
  if (curZone() === 1) {
    sparks = 1 + w + Math.floor((n - 1) * 0.8);
    turrets = Math.max(0, w - 1 + Math.floor((n - 1) / 2));
    // 방 3부터 새 적: 폭발 드럼통(웨이브 2·3), 방패 지게차(방 3 웨이브 2, 방 4~5 웨이브 2·3)
    drums = n >= 3 ? (w >= 2 ? 1 : 0) + (n >= 5 && w === 3 ? 1 : 0) : 0;
    lifts = n >= 3 ? (w === 2 ? 1 : 0) + (n >= 4 && w === 3 ? 1 : 0) : 0;
  } else if (curZone() >= 3) {
    // 3구역: 인스펙터(웨이브 2·3), 기존 적 모두 섞임. 적의 25%는 정예
    sparks = 1 + w + Math.floor((n - 1) * 0.6);
    turrets = Math.max(0, w - 1 + Math.floor((n - 1) / 2));
    drums = w >= 2 ? 1 : 0;
    lifts = w === 3 ? 1 : 0;
    drones = w === 1 && n >= 2 ? 4 : 0;
    medics = w >= 2 && n >= 3 ? 1 : 0;
    insps = (w >= 2 ? 1 : 0) + (n >= 4 && w === 3 ? 1 : 0);
  } else {
    // 2구역: 드론 떼(웨이브 1·3), 수리봇(방 2부터 웨이브 2·3)
    sparks = 1 + w + Math.floor((n - 1) * 0.6);
    turrets = Math.max(0, w - 1 + Math.floor((n - 1) / 2));
    drums = n >= 2 && w >= 2 ? 1 : 0;
    lifts = w === 3 ? 1 + (n >= 4 ? 1 : 0) : 0;
    drones = w === 1 || w === 3 ? 4 + (n >= 3 ? 1 : 0) : 0;
    medics = n >= 2 && w >= 2 ? 1 + (n >= 5 && w === 3 ? 1 : 0) : 0;
  }
  const list = [];
  for (let i = 0; i < Math.max(1, sparks - drums - lifts - medics - insps); i++) list.push("spark");
  for (let i = 0; i < insps; i++) list.push("insp");
  for (let i = 0; i < medics; i++) list.push("medic");
  for (let i = 0; i < turrets; i++) list.push("turret");
  for (let i = 0; i < drums; i++) list.push("drum");
  for (let i = 0; i < lifts; i++) list.push("lift");
  if (drones) {
    let c, tries = 0;
    do { c = { x: RX0 + 80 + mapRng() * (RX1 - RX0 - 160), y: RY0 + 60 + mapRng() * 200 }; tries++; } while (tries < 30 && dist(c, player) < 260);
    for (let i = 0; i < drones; i++) { const a = i / drones * Math.PI * 2; pending.push({ type: "drone", x: c.x + Math.cos(a) * 34, y: c.y + Math.sin(a) * 26, r: DRONE.r, t: 0.7 + i * 0.08 }); }
  }
  list.forEach((type, i) => {
    const r = ENEMY_R[type];
    let p, tries = 0;
    do {
      p = { x: RX0 + 40 + mapRng() * (RX1 - RX0 - 80), y: RY0 + 40 + mapRng() * (RY1 - RY0 - 80), r };
      tries++;
    } while (tries < 60 && (dist(p, player) < 230 || room.obstacles.some((o) => inRect(p.x, p.y, o, r + 10)) || pending.some((q) => dist(p, q) < 50)));
    pending.push({ type, x: p.x, y: p.y, r, t: 0.9 + i * 0.12, elite: pickElite(type) });
  });
  showBanner("웨이브 " + w + " / " + room.waves, "");
  banner.t = 1.3;
}
const ENEMY_R = { spark: 13, turret: 16, drum: DRUM.r, lift: LIFT.r, drone: DRONE.r, medic: MEDIC.r, insp: INSP.r };
function makeEnemy(s) {
  const e = makeEnemyBase(s);
  // 2구역: 1구역 적 체력 1.3배
  // 구역별 체력: 1구역 적은 2구역 1.3배, 3구역 1.6배 / 2구역 적(드론·수리봇)은 3구역 1.3배
  const z = curZone(), old = ["spark", "turret", "drum", "lift"].includes(e.type);
  const mul = old ? (z >= 3 ? 1.6 : z >= 2 ? 1.3 : 1) : ["drone", "medic"].includes(e.type) && z >= 3 ? 1.3 : 1;
  if (mul !== 1) e.hp = e.maxHp = Math.round(e.maxHp * mul);
  if (s.elite) applyElite(e, s.elite);
  return e;
}
function makeEnemyBase(s) {
  if (s.type === "drone") return { type: "drone", x: s.x, y: s.y, r: DRONE.r, hp: DRONE.hp, maxHp: DRONE.hp, vx: 0, vy: 0, flash: 0, state: "orbit", t: 0, cd: 1.2 + Math.random() * 2.5, ang: Math.random() * Math.PI * 2, orbitR: 95 + Math.random() * 40, spin: Math.random() < 0.5 ? -1 : 1, bob: Math.random() * 6, aim: 0, hitPlayer: false };
  if (s.type === "insp") return { type: "insp", x: s.x, y: s.y, r: INSP.r, hp: INSP.hp, maxHp: INSP.hp, vx: 0, vy: 0, flash: 0, state: "move", t: 0, cd: 1 + Math.random(), aim: 0, len: 0, face: 0, beamT: 0, folded: false };
  if (s.type === "medic") return { type: "medic", x: s.x, y: s.y, r: MEDIC.r, hp: MEDIC.hp, maxHp: MEDIC.hp, vx: 0, vy: 0, flash: 0, state: "move", t: 0, bob: 0, beam: null };
  if (s.type === "drum") return { type: "drum", x: s.x, y: s.y, r: DRUM.r, hp: DRUM.hp, maxHp: DRUM.hp, vx: 0, vy: 0, flash: 0, state: "chase", t: 0, roll: 0, fly: 0 };
  if (s.type === "lift") return { type: "lift", x: s.x, y: s.y, r: LIFT.r, hp: LIFT.hp, maxHp: LIFT.hp, vx: 0, vy: 0, flash: 0, state: "chase", t: 0, cd: 1.5, face: angTo(s, player), roll: 0, blockT: 0, hitPlayer: false };
  if (s.type === "spark") return { type: "spark", x: s.x, y: s.y, r: 13, hp: 30, maxHp: 30, vx: 0, vy: 0, flash: 0, state: "chase", t: 0, cd: 0.8 + Math.random(), aim: 0, spin: 0, hitPlayer: false };
  return { type: "turret", x: s.x, y: s.y, r: 16, hp: 46, maxHp: 46, vx: 0, vy: 0, flash: 0, state: "idle", t: 1 + Math.random(), aim: angTo(s, player), shots: 0 };
}

// ================= 효과 =================
function shake(a) { shakeAmt = Math.max(shakeAmt, a); }
function burst(x, y, n, color, speed, life, size, ang, spread) {
  for (let i = 0; i < n; i++) {
    const a = ang === undefined ? Math.random() * Math.PI * 2 : ang + rand(-spread, spread);
    const s = speed * rand(0.35, 1);
    particles.push({ x, y, z: 14, vz: rand(30, 220), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * rand(0.6, 1), max: life, color, size: size * rand(0.6, 1.2), glow: true });
  }
}
function debris(x, y, n, color) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2, s = rand(60, 260);
    particles.push({ x, y, z: 16, vz: rand(160, 380), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.7, 1.3), max: 1.3, color, size: rand(3, 6), rot: Math.random() * 6, vr: rand(-10, 10), glow: false, square: true });
  }
}
function addText(x, y, str, color, big) { texts.push({ x, y, z: 44, str: String(str), color, big, t: 0.7 }); }

// ================= 전투 =================
function hurtEnemy(e, dmg, ang, kb, heavy, src = "atk", color) {
  if (e.dead) return;
  if (liftBlocks(e, ang, src)) return;
  const proc = src === "proc" || src === "atkTick" || src === "atkSoft";
  if (e.state === "stun" || e.frozen > 0) dmg *= e.type === "boss" ? BOSS.stunMul : 1.5;
  if (e.burnS > 0 && player.st.burnBonus) dmg *= 1 + player.st.burnBonus;
  if (e.frozen > 0) { if (hasDuo("hydcool")) dmg *= 1.5; if (hasDuo("superconduct") && color === FAM.volt.color) dmg *= 3; }
  if (e.sh > 0) { dmg = eliteAbsorb(e, dmg); if (dmg <= 0) { e.flash = 0.05; if (!proc) { hitstop = Math.max(hitstop, 0.03); sfx("tick"); } return; } }
  if (e.kind === "qc9") { const m = qcMul(e); if (m === 0) { e.flash = 0.04; if (!(e.invT > 0)) { e.invT = 0.4; addText(e.x, e.y - 80, "무적", C.visor, false); } return; } dmg *= m; }
  if (e.kind === "multiarm" && e.armsAlive > 0) { dmg *= MA.shield; if (!(e.shT > 0)) { e.shT = 0.25; burst(e.x, e.y - 10, 6, "#7fb4ff", 200, 0.25, 2.2); } }
  dmg = Math.max(1, Math.round(dmg));
  e.hp -= dmg; e.flash = proc ? 0.05 : 0.1;
  if (e.type === "boss") e.lagT = 0.45;
  if (e.type !== "turret" && e.type !== "boss" && e.type !== "arm" && !(e.frozen > 0) && ang !== null) { const m = e.type === "lift" ? 0.25 : e.type === "drum" ? 1.5 : 1; e.vx += Math.cos(ang) * kb * m; e.vy += Math.sin(ang) * kb * m; }
  if (e.type === "drum" && heavy && ang !== null) e.fly = 0.5;
  if (e.type === "spark" && heavy && e.state === "windup") { e.state = "stun"; e.t = 0.9; }
  if (proc) {
    addText(e.x + rand(-8, 8), e.y - e.r, dmg, color || C.text, false);
  } else {
    burst(e.x - Math.cos(ang || 0) * e.r * 0.5, e.y - Math.sin(ang || 0) * e.r * 0.5, heavy ? 14 : 7, heavy ? "#fff3b0" : C.eye, heavy ? 320 : 220, 0.28, 2.4, ang || 0, ang === null ? Math.PI : 0.9);
    addText(e.x + rand(-6, 6), e.y - e.r - 8, dmg, heavy || e.state === "stun" || e.frozen > 0 ? C.hazard : C.text, heavy);
    hitstop = Math.max(hitstop, heavy ? 0.085 : 0.045);
    shake(heavy ? 7 : 3);
    sfx(heavy ? "heavy" : "hit");
  }
  if (!proc && e.hp > 0) inspInterrupt(e);
  if (e.hp <= 0) killEnemy(e);
  if (src === "atkSoft") onHit(e, "atk"); else if (!proc) onHit(e, src);
}
function killEnemy(e) {
  e.dead = true;
  if (e.type === "boss") { bossDown(e); return; }
  if (e.type === "arm") { armDown(e); return; }
  if (hasDuo("furnace") && e.burnS > 0) {
    for (const o of enemies) if (!o.dead && o !== e && !o.drop && dist(o, e) < 110) { applyBurn(o, Math.max(1, e.burnS), e.burnP || 3); zap(e.x, e.y, 10, o.x, o.y, 10); }
    burst(e.x, e.y, 14, FAM.heat.color, 200, 0.4, 2.4);
  }
  run.kills++;
  const pts = ({ turret: 15, lift: 25, drone: 5, medic: 20, insp: 20 }[e.type] || 10) * (e.elite ? 2 : 1);
  run.score += pts;
  gainScrap(({ turret: 3, lift: 5, drone: 1, medic: 4, insp: 4 }[e.type] || 2) + (e.elite ? 5 : 0), e.x, e.y, true);
  eliteSplit(e);
  burst(e.x, e.y, 22, "#ffb347", 300, 0.45, 3);
  debris(e.x, e.y, e.type === "drone" ? 4 : 9, e.type === "turret" ? C.turret : e.type === "lift" ? C.hazard : e.type === "drone" ? "#5a7ea8" : e.type === "medic" || e.type === "insp" ? "#e8edf2" : C.spark);
  // 드럼통: 맞은 방향으로 날아가다 0.5초(점화 중이면 0.3초) 뒤, 또는 적에 닿으면 폭발
  if (e.type === "drum") booms.push({ x: e.x, y: e.y, vx: e.vx * 2.2, vy: e.vy * 2.2, r: DRUM.r, t: e.state === "fuse" ? 0.3 : DRUM.delay });
  addText(e.x, e.y - 22, "+" + pts, C.good, false);
  if (Math.random() < 0.1) { const a = Math.random() * Math.PI * 2; healDrops.push({ x: e.x, y: e.y, z: 20, vz: 220, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, t: 8 }); }
  if (has("mag_passive")) { const h = mval("mag_passive"); player.hp = Math.min(player.maxHp, player.hp + h); addText(player.x, player.y - 20, "+" + h, C.good, false); }
  shake(6); sfx("explode");
}
function hurtPlayer(dmg, from, cause) {
  const p = player;
  if (p.dead || p.inv > 0 || p.dash.t > 0) return;
  if (p.markT > 0) dmg *= LASER.markMul; // 불량 표식: 받는 피해 +25%
  dmg = Math.max(1, Math.round(dmg * (1 - p.st.armor)));
  p.hp -= dmg; p.inv = 0.75; hurtFlash = 1; room.tookDamage = true; p.lagT = 0.4;
  if (has("volt_passive")) { const v = mval("volt_passive"); const near = enemies.filter((e) => !e.dead && !e.drop && dist(e, p) < 170).sort((a, b) => dist(a, p) - dist(b, p)).slice(0, 3); for (const e of near) { zap(p.x, p.y, 20, e.x, e.y, 16); hurtEnemy(e, v, angTo(p, e), 60, false, "proc", FAM.volt.color); } if (near.length) sfx("zap"); }
  if (from) { const a = angTo(from, p); p.kx += Math.cos(a) * 320; p.ky += Math.sin(a) * 320; }
  addText(p.x, p.y - 26, "-" + dmg, C.danger, true);
  if (hasDuo("steam")) steamBlast();
  burst(p.x, p.y, 12, C.danger, 260, 0.35, 2.6);
  hitstop = Math.max(hitstop, 0.09); shake(10); sfx("hurt");
  if (p.hp <= 0 && p.battery) {
    // 예비 배터리: 한 판에 한 번 부활
    p.battery = false; run.batteryUsed = true;
    p.hp = Math.round(p.maxHp * 0.3); p.hpLag = p.hp; p.inv = 2;
    for (const e of enemies) { if (e.dead || e.type === "turret" || e.type === "boss" || e.type === "arm") continue; const d = dist(p, e); if (d < 150) { const a = angTo(p, e); e.vx += Math.cos(a) * 650; e.vy += Math.sin(a) * 650; } }
    bolts.forEach((b) => { if (dist(p, b) < 150) b.dead = true; });
    waves.push({ x: p.x, y: p.y, t: 0, max: 0.5, R: 150, col: C.visor });
    burst(p.x, p.y, 30, C.visor, 320, 0.6, 3);
    showBanner("예비 배터리 작동", "체력 30%로 재가동 · 2초 무적"); banner.t = 1.6;
    hitstop = 0.15; shake(10); sfx("revive"); buzz(80);
    return;
  }
  if (p.hp <= 0) {
    p.hp = 0; p.dead = true; p.deathT = 1.4; run.cause = cause;
    burst(p.x, p.y, 40, "#ffb347", 380, 0.7, 3.5); debris(p.x, p.y, 16, C.body);
    shake(16); sfx("explode");
  }
}

const SWINGS = [
  { dur: 0.21, reach: 62, half: 1.15, dmg: 10, kb: 140, heavy: false, dir: 1 },
  { dur: 0.21, reach: 62, half: 1.15, dmg: 10, kb: 140, heavy: false, dir: -1 },
  { dur: 0.32, reach: 76, half: 1.75, dmg: 24, kb: 460, heavy: true, dir: 1 },
  { dur: 0.22, reach: 60, half: 1.4, dmg: 8, kb: 120, heavy: false, dir: 1, air: true }, // 공중 휘두르기
];
const SLAM_CD = 2.5, JUMP_V = 520, GRAV = 2100, MELEE_RANGE = 150;

// 자동 조준: 이동 방향(서 있으면 바라보는 방향)에 가까운 적을 우선
function pickTarget(range, mv, cone = 1.05, strict = false) {
  const p = player;
  const base = mv && mv.len > 0.2 ? Math.atan2(mv.y, mv.x) : p.face;
  let best = null, bs = Infinity;
  for (const e of enemies) {
    if (e.dead || e.drop > 0) continue;
    const d = dist(p, e) - e.r;
    if (d > range) continue;
    const ad = Math.abs(angDiff(base, angTo(p, e)));
    if (strict && ad > cone) continue;
    const score = d + ad * 140 + (ad > cone ? 220 : 0);
    if (score < bs) { bs = score; best = e; }
  }
  return best;
}
function targetValid(t, range) { return t && !t.dead && dist(player, t) - t.r <= range + 40; }

function startSwing(i, mv) {
  const p = player, a = p.atk;
  let t = (i > 0 && targetValid(a.target, MELEE_RANGE)) ? a.target : pickTarget(MELEE_RANGE, mv);
  a.target = t;
  if (t) p.face = angTo(p, t);
  const b = SWINGS[i], st = p.st;
  a.sw = { ...b, dur: b.dur / st.spd, reach: b.reach * st.reach, dmg: b.dmg * st.atkMul };
  a.i = i; a.t = 0; a.dur = a.sw.dur; a.ang = p.face; a.hit = new Set(); a.queued = false;
  if (i === 2 && has("mag_atk")) pullTo(p.x + Math.cos(a.ang) * 46, p.y + Math.sin(a.ang) * 46, mval("mag_atk"), 0.6);
  if (!SWINGS[i].air) {
    let lunge = i === 2 ? 220 : 120;
    if (t) { const gap = dist(p, t) - t.r - SWINGS[i].reach + 18; if (gap > 0) lunge += Math.min(420, gap * 7); }
    p.kx += Math.cos(a.ang) * lunge; p.ky += Math.sin(a.ang) * lunge;
  }
  sfx("swing");
}
function slamLand() {
  const p = player, sl = p.slam;
  const dmg = Math.round((14 + 8 * sl.power) * p.st.atkMul), R = p.st.slamR;
  if (has("mag_slam")) pullTo(p.x, p.y, mval("mag_slam"), 0.75);
  for (const e of enemies) {
    if (e.dead || e.drop > 0 || e.type === "drone" || e.air) continue;
    if (dist(p, e) - e.r <= R) {
      hurtEnemy(e, dmg, angTo(p, e), 380, true, "slam");
      if (!e.dead && e.type === "spark") { e.state = "stun"; e.t = Math.max(e.t, 0.6); }
      if (!e.dead && e.type === "lift") { e.state = "stun"; e.t = LIFT.stun; addText(e.x, e.y - 40, "방패 해제", C.hazard, false); }
    }
  }
  for (const b of bolts) if (!b.dead && dist(p, b) <= R) { b.dead = true; burst(b.x, b.y, 6, C.swing, 160, 0.2, 2); }
  waves.push({ x: p.x, y: p.y, t: 0, max: 0.35, R: R + 10 });
  for (let i = 0; i < 18; i++) { const a = i / 18 * Math.PI * 2; particles.push({ x: p.x, y: p.y, z: 2, vz: 30, vx: Math.cos(a) * 240, vy: Math.sin(a) * 240, life: 0.45, max: 0.45, color: "#7a7f86", size: 5, glow: false, nograv: true }); }
  debris(p.x, p.y, 6, "#6b6f74");
  room.cracks.push({ x: p.x, y: p.y, seed: Math.random() * 10 });
  hitstop = Math.max(hitstop, 0.1); shake(12); sfx("slam"); buzz(40);
  p.slam = null; p.slamCd = p.st.slamCd; p.squash = 0.14;
}

// ================= 강화 모듈 =================
const FAM = {
  volt: { name: "과전류", color: "#b18cff" },
  heat: { name: "과열", color: "#ff7a33" },
  frost: { name: "냉각", color: "#7fe0ff" },
  mag: { name: "자성", color: "#ff5fa2" },
  hyd: { name: "유압", color: "#9ad06b" },
};
const SLOTS = { atk: "공격", throw: "특수", dash: "대시", slam: "내려찍기", passive: "패시브" };
const SLOT_ORDER = ["atk", "throw", "dash", "slam", "passive"];
const RARITY = [{ name: "일반", color: "#b8c0c8" }, { name: "희귀", color: "#5aa9ff" }, { name: "에픽", color: "#f2c230" }];
const MODS = {
  volt_atk:   { fam: "volt", slot: "atk", name: "아크 렌치", v: [5, 7, 9], d: (v) => `공격이 맞으면 근처 적 2명에게 번개가 튀어 ${v} 피해` },
  heat_atk:   { fam: "heat", slot: "atk", name: "달군 렌치", v: [3, 4, 5], d: (v) => `공격이 맞으면 화상 1중첩. 중첩당 초당 ${v} 피해 (3초)` },
  frost_atk:  { fam: "frost", slot: "atk", name: "냉각 코팅", v: [1.0, 1.3, 1.6], d: (v) => `공격이 맞으면 냉기 1중첩. 5중첩이면 ${v}초 빙결` },
  mag_atk:    { fam: "mag", slot: "atk", name: "자력 헤드", v: [110, 135, 160], d: (v) => `강한 공격마다 반경 ${v} 안의 적을 앞으로 끌어모음 (렌치 3타째, 리벳 8발째, 토치 1.5초마다)` },
  hyd_atk:    { fam: "hyd", slot: "atk", name: "유압 피스톤", v: [20, 30, 40], d: (v) => `공격 피해 +${v}%` },
  volt_throw: { fam: "volt", slot: "throw", name: "번개 회전날", v: [6, 8, 10], d: (v) => `특수 공격이 맞으면 근처 적 3명에게 번개가 튀어 ${v} 피해` },
  heat_throw: { fam: "heat", slot: "throw", name: "소이 렌치", v: [2, 3, 4], d: (v) => `특수 공격이 맞으면 화상 ${v}중첩` },
  frost_throw:{ fam: "frost", slot: "throw", name: "서리 렌치", v: [2, 3, 4], d: (v) => `특수 공격이 맞으면 냉기 ${v}중첩` },
  mag_throw:  { fam: "mag", slot: "throw", name: "회수 자석", v: [10, 20, 30], d: (v) => `특수 공격에 맞은 적을 내 쪽으로 끌어옴. 특수 쿨타임 -${v}%` },
  hyd_throw:  { fam: "hyd", slot: "throw", name: "강화 렌치", v: [50, 80, 110], d: (v) => `특수 공격 피해 +${v}%` },
  volt_dash:  { fam: "volt", slot: "dash", name: "방전 대시", v: [8, 11, 14], d: (v) => `대시로 통과한 적에게 번개 ${v} 피해` },
  heat_dash:  { fam: "heat", slot: "dash", name: "화염 분사", v: [2, 3, 4], d: (v) => `대시로 통과한 적에게 화상 ${v}중첩` },
  frost_dash: { fam: "frost", slot: "dash", name: "냉기 폭발", v: [2, 3, 4], d: (v) => `대시가 끝나면 주변 적에게 냉기 ${v}중첩` },
  mag_dash:   { fam: "mag", slot: "dash", name: "자기장 대시", v: [100, 125, 150], d: (v) => `대시가 끝나면 반경 ${v} 안의 적을 끌어모음` },
  hyd_dash:   { fam: "hyd", slot: "dash", name: "보조 배터리", v: [0, 15, 30], d: (v) => `대시 충전 +1회` + (v ? `, 재충전 ${v}% 빠름` : "") },
  volt_slam:  { fam: "volt", slot: "slam", name: "낙뢰", v: [10, 14, 18], d: (v) => `충격파에 맞은 적에게 번개 ${v} 추가 피해` },
  heat_slam:  { fam: "heat", slot: "slam", name: "용광로 착지", v: [3, 4, 5], d: (v) => `충격파에 맞은 적에게 화상 ${v}중첩` },
  frost_slam: { fam: "frost", slot: "slam", name: "동결 충격", v: [0.8, 1.1, 1.4], d: (v) => `충격파에 맞은 적을 ${v}초 빙결` },
  mag_slam:   { fam: "mag", slot: "slam", name: "중력 내려찍기", v: [130, 150, 170], d: (v) => `착지 순간 반경 ${v} 안의 적을 끌어모은 뒤 내려찍음` },
  hyd_slam:   { fam: "hyd", slot: "slam", name: "대형 피스톤", v: [25, 35, 45], d: (v) => `충격파 반경 +${v}%` },
  volt_passive:  { fam: "volt", slot: "passive", name: "정전기 장갑", v: [10, 14, 18], d: (v) => `피격당하면 근처 적 3명에게 번개 ${v} 반격` },
  heat_passive:  { fam: "heat", slot: "passive", name: "과열 코어", v: [15, 22, 30], d: (v) => `화상 중인 적에게 주는 피해 +${v}%` },
  frost_passive: { fam: "frost", slot: "passive", name: "냉각 장갑", v: [10, 15, 20], d: (v) => `받는 피해 -${v}%` },
  mag_passive:   { fam: "mag", slot: "passive", name: "고철 자석", v: [1, 2, 3], d: (v) => `적을 처치하면 체력 ${v} 회복` },
  hyd_passive:   { fam: "hyd", slot: "passive", name: "강화 프레임", v: [20, 30, 40], d: (v) => `최대 체력 +${v}` },
};
const WUPS = {
  dmg:   { name: "강화 헤드", d: "기본 공격 피해 +15%" },
  spd:   { name: "경량 손잡이", d: "공격 속도 +12% (연사·분사 속도 포함)" },
  reach: { name: "연장 손잡이", d: "기본 공격 범위·사거리 +12%" },
  throw: { name: "회전 베어링", d: "특수 공격 쿨타임 -20%" },
  slam:  { name: "충격 흡수기", d: "내려찍기 쿨타임 -20%" },
  hp:    { name: "보강 장갑판", d: "최대 체력 +15, 체력 15 회복" },
};
const REWARD = {
  module: { name: "모듈", color: "#3ee0d0" },
  heal:   { name: "수리 키트", color: "#59e39a" },
  weapon: { name: "무기 개조", color: "#f2c230" },
  chip:   { name: "강화 칩", color: "#5aa9ff" },
  station:{ name: "충전소", color: "#59e39a" },
  shop:   { name: "부품 상점", color: "#f2c230" },
  scrap:  { name: "고철 더미", color: "#c9a26a" },
  challenge: { name: "긴급 생산 라인", color: "#ff4b3a" },
  boss:   { name: "보스", color: "#ff4b3a" },
  exit:   { name: "탈출", color: "#59e39a" },
};
function rewardRng(kind) { return mulberry32(hashStr(runSeed + "#" + kind + "#" + room.n)); }

function mval(id) {
  const m = player.mods[MODS[id].slot];
  return m && m.id === id ? MODS[id].v[m.r] : 0;
}
function has(id) { const m = player.mods[MODS[id].slot]; return !!(m && m.id === id); }
function recalcStats() {
  const p = player, w = p.wups;
  const st = {
    atkMul: Math.pow(1.15, w.dmg || 0) * (1 + mval("hyd_atk") / 100),
    spd: 1 + 0.12 * (w.spd || 0),
    reach: 1 + 0.12 * (w.reach || 0),
    throwCd: WEAPONS[p.weapon || "wrench"].spCd * Math.pow(0.8, w.throw || 0) * (1 - mval("mag_throw") / 100),
    throwMul: 1 + mval("hyd_throw") / 100,
    slamCd: SLAM_CD * Math.pow(0.8, w.slam || 0),
    slamR: 72 * (1 + mval("hyd_slam") / 100),
    dashMax: 2 + (has("hyd_dash") ? 1 : 0),
    dashRegen: 0.9 * (1 - mval("hyd_dash") / 100),
    armor: mval("frost_passive") / 100,
    burnBonus: mval("heat_passive") / 100,
    maxHp: 100 + 15 * (w.hp || 0) + mval("hyd_passive"),
  };
  const oldMax = p.maxHp;
  p.st = st;
  p.maxHp = st.maxHp;
  if (st.maxHp > oldMax) p.hp += st.maxHp - oldMax;
  p.hp = Math.min(p.hp, p.maxHp);
  p.dash.max = st.dashMax;
  p.dash.charges = Math.min(p.dash.charges, p.dash.max);
}

// --- 상태 이상 ---
function applyBurn(e, stacks, perStack, cap = 6) {
  if (e.dead) return;
  e.burnS = Math.max(e.burnS || 0, Math.min(cap, (e.burnS || 0) + stacks));
  e.burnP = Math.max(e.burnP || 0, perStack || 3);
  e.burnT = 3; e.burnTick = e.burnTick || 0.5;
}
function applyChill(e, stacks) {
  if (e.dead) return;
  e.chillS = (e.chillS || 0) + stacks; e.chillT = 3;
  if (e.chillS >= 5) { e.chillS = 0; freeze(e, Math.max(1.2, mval("frost_atk"))); }
}
function freeze(e, t) {
  if (e.dead) return;
  if (hasDuo("thermal") && e.burnS > 0) thermalBlast(e);
  if (e.kind === "qc9") { t *= 0.3; }
  else if (e.kind === "multiarm") { t *= 0.35; if (e.grab) { maRelease(e); e.state = "clawBack"; e.t = 0.35; } }
  else if (e.type === "arm") { t *= 0.5; }
  else if (e.type === "boss") { t *= 0.35; if (["windup", "charge", "brake", "suck", "spitWind"].includes(e.state)) { e.state = "recover"; e.t = 0.3; } }
  e.frozen = Math.max(e.frozen || 0, t);
  if (e.type === "spark" && (e.state === "charge" || e.state === "windup")) { e.state = "recover"; e.t = 0.2; }
  if (e.type === "lift" && (e.state === "tele" || e.state === "ram")) { e.state = "after"; e.t = 0.3; }
  burst(e.x, e.y, 10, FAM.frost.color, 160, 0.35, 2.2);
}
function zap(x1, y1, z1, x2, y2, z2) { zaps.push({ x1, y1, z1, x2, y2, z2, t: 0.2 }); }
function chain(from, n, dmg) {
  const hit = new Set([from]);
  let cur = from;
  for (let i = 0; i < n; i++) {
    let best = null, bd = 160;
    for (const e of enemies) { if (e.dead || e.drop > 0 || hit.has(e)) continue; const d = dist(cur, e); if (d < bd) { bd = d; best = e; } }
    if (!best) break;
    zap(cur.x, cur.y, 16, best.x, best.y, 16);
    hit.add(best);
    hurtEnemy(best, dmg, angTo(cur, best), 30, false, "proc", FAM.volt.color);
    cur = best;
  }
  if (hit.size > 1) sfx("zap");
}
function skyBolt(e, dmg) { zap(e.x + rand(-10, 10), e.y, 220, e.x, e.y, 10); hurtEnemy(e, dmg, -Math.PI / 2, 0, false, "proc", FAM.volt.color); }
function pullTo(cx, cy, R, k) {
  let any = false;
  for (const e of enemies) {
    if (e.dead || e.drop > 0 || e.type === "turret" || e.type === "boss" || e.type === "arm") continue;
    const d = Math.hypot(e.x - cx, e.y - cy);
    if (d > R || d < 20) continue;
    e.x += (cx - e.x) * k; e.y += (cy - e.y) * k;
    collideWorld(e, false);
    if (hasDuo("emfield")) e.shockT = 2;
    if (hasDuo("magcool")) applyChill(e, 2);
    any = true;
  }
  if (any) { sfx("pull"); waves.push({ x: cx, y: cy, t: 0, max: 0.3, R: -R, col: FAM.mag.color }); }
}
// 주 공격이 적중했을 때 장착 모듈 효과
function onHit(e, src) {
  if (player.overloadT > 0 && hasDuo("overload") && src !== "dash" && !e.dead) { player.overloadT = 0; skyBolt(e, 20); }
  if (src === "atk" && player.weapon === "rivet" && Math.random() > 0.35) return;
  if (src === "atk") {
    if (has("volt_atk")) chain(e, 2, mval("volt_atk"));
    if (has("heat_atk")) applyBurn(e, 1, mval("heat_atk"));
    if (has("frost_atk")) applyChill(e, 1);
  } else if (src === "throw") {
    if (has("mag_throw") && e.type !== "turret" && e.type !== "boss" && e.type !== "arm" && !e.dead) { const ag = angTo(e, player); e.vx += Math.cos(ag) * 420; e.vy += Math.sin(ag) * 420; }
    if (has("volt_throw")) chain(e, 3, mval("volt_throw"));
    if (has("heat_throw")) applyBurn(e, mval("heat_throw"), Math.max(3, mval("heat_atk")));
    if (has("frost_throw")) applyChill(e, mval("frost_throw"));
  } else if (src === "dash") {
    if (has("volt_dash")) skyBolt(e, mval("volt_dash"));
    if (has("heat_dash")) applyBurn(e, mval("heat_dash"), Math.max(3, mval("heat_atk")));
  } else if (src === "slam") {
    if (has("volt_slam")) skyBolt(e, mval("volt_slam"));
    if (has("heat_slam")) applyBurn(e, mval("heat_slam"), Math.max(3, mval("heat_atk")));
    if (has("frost_slam")) freeze(e, mval("frost_slam"));
  }
}
function updateStatus(e, dt) {
  if (e.burnT > 0) {
    e.burnT -= dt; e.burnTick -= dt;
    if (Math.random() < 0.3) particles.push({ x: e.x + rand(-8, 8), y: e.y, z: 14 + rand(0, 10), vz: 60, vx: 0, vy: 0, life: 0.35, max: 0.35, color: FAM.heat.color, size: 2.5, glow: true, nograv: true });
    if (e.burnTick <= 0) { e.burnTick = 0.5; hurtEnemy(e, Math.max(1, Math.round(e.burnS * e.burnP * 0.5)), 0, 0, false, "proc", FAM.heat.color); }
    if (e.burnT <= 0) e.burnS = 0;
  }
  if (e.chillT > 0) { e.chillT -= dt; if (e.chillT <= 0) e.chillS = 0; }
  if (e.frozen > 0) e.frozen -= dt;
  if (e.torchT > 0) e.torchT -= dt;
  if (e.shockT > 0) {
    e.shockT -= dt; e.shockTick = (e.shockTick || 0) - dt;
    if (e.shockTick <= 0) { e.shockTick = 0.5; zap(e.x + rand(-12, 12), e.y, 30, e.x, e.y, 14); hurtEnemy(e, 4, 0, 0, false, "proc", FAM.volt.color); }
  }
}

// ================= 무기 3종 =================
const WEAPONS = {
  wrench: { name: "강철 렌치", tag: "근접 · 보통", atkLabel: "공격", spLabel: "투척", spName: "투척", spCd: 2.2, gauge: null,
            desc: "가장 센 근접 3연타. 탄을 쳐내고 3타째로 돌진을 끊어요." },
  rivet:  { name: "리벳건", tag: "원거리 · 쉬움", atkLabel: "사격", spLabel: "산탄", spName: "산탄", spCd: 1.6, gauge: "heat",
            desc: "가장 가까운 적을 고정해 연사. 멈춰서 쏘면 정확하고, 움직이며 쏘면 탄이 퍼져요. 과열 주의." },
  torch:  { name: "용접 토치", tag: "범위 · 어려움", atkLabel: "분사", spLabel: "불길", spName: "불길", spCd: 4.5, gauge: "fuel",
            desc: "짧은 원뿔 화염으로 여럿을 태워요. 연료를 관리해야 해요." },
};
const WEAPON_ORDER = ["wrench", "rivet", "torch"];
let weaponId = "wrench";
try { const w = localStorage.getItem("b07-weapon"); if (WEAPONS[w]) weaponId = w; } catch (e) {}
const WPN = () => (player && player.weapon) || weaponId;
let shots = [], fires = [];
const RIVET = { rate: 6, speed: 640, range: 300, dmg: 5, heat: 8, lock: 1.4, cool: 50, coolDelay: 0.4, spDmg: 6, spHeat: 40, spread: 10 * Math.PI / 180, moveMul: 0.5 };
const TORCH = { range: 125, half: 0.45, tick: 0.12, dmg: 3.24, burn: 0.5, use: 34, regen: 25, burnCap: 3 };
// 원거리 표적 고정: 가장 가까운 적 (거리가 비슷하면 이동 방향 쪽)
function pickNearest(range, mv) {
  const p = player, base = mv && mv.len > 0.2 ? Math.atan2(mv.y, mv.x) : p.face;
  let best = null, bs = Infinity;
  for (const e of enemies) {
    if (e.dead || e.drop > 0) continue;
    const d = dist(p, e) - e.r; if (d > range) continue;
    const sc = d + Math.abs(angDiff(base, angTo(p, e))) * 25;
    if (sc < bs) { bs = sc; best = e; }
  }
  return best;
}
function lockValid(e, range) { return e && !e.dead && !(e.drop > 0) && dist(player, e) - e.r <= range + 20; }

// 원거리 무기 매 프레임 처리. want = 공격 버튼을 누르고 있음
function rangedUpdate(dt, mv, want) {
  const p = player, st = p.st, w = p.weapon;
  p.fireT += dt;
  if (w === "rivet") {
    if (p.overheat > 0) { p.overheat -= dt; p.heat = 100 * Math.max(0, p.overheat / RIVET.lock); if (p.overheat <= 0) { p.heat = 0; } }
    else if (p.fireT > RIVET.coolDelay) p.heat = Math.max(0, p.heat - RIVET.cool * dt);
    p.shotT -= dt;
    // 이동 중에는 탄이 퍼짐 (멈추면 서서히 정확해짐)
    const moving = mv.len > 0.2;
    p.bloom += ((moving ? 1 : 0) - p.bloom) * Math.min(1, dt * (moving ? 10 : 6));
    if (want && p.shotT <= 0 && p.overheat <= 0) {
      const range = RIVET.range * st.reach;
      if (!lockValid(p.lock, range)) p.lock = pickNearest(range, mv);
      const t = p.lock;
      const aim = t ? angTo(p, t) : p.face;
      p.face = aim;
      const ang = aim + rand(-1, 1) * RIVET.spread * p.bloom;
      const sx = p.x + Math.cos(ang) * 16, sy = p.y + Math.sin(ang) * 16;
      shots.push({ x: sx, y: sy, vx: Math.cos(ang) * RIVET.speed, vy: Math.sin(ang) * RIVET.speed, life: range / RIVET.speed, dmg: RIVET.dmg * st.atkMul, kb: 30, src: "atkSoft", ang, kind: "rivet" });
      p.shotT = 1 / (RIVET.rate * st.spd); p.fireT = 0; p.flashT = 0.06;
      particles.push({ x: sx, y: sy, z: 18, vz: 0, vx: Math.cos(ang) * 60, vy: Math.sin(ang) * 60, life: 0.08, max: 0.08, color: "#fff3b0", size: 5, glow: true, nograv: true });
      sfx("rivet");
      p.heat += RIVET.heat;
      p.atkCount++;
      if (has("mag_atk") && p.atkCount % 8 === 0) pullTo(p.x + Math.cos(ang) * 70, p.y + Math.sin(ang) * 70, mval("mag_atk"), 0.6);
      if (p.heat >= 100) overheat();
    }
    if (!want) p.lock = null;
    p.firing = p.fireT < 0.18;
  } else if (w === "torch") {
    if (p.fuelLock && p.fuel >= 25) p.fuelLock = false;
    const can = want && !p.fuelLock && p.fuel > 0;
    p.flaming = can;
    if (can) {
      const range = TORCH.range * st.reach;
      if (!lockValid(p.lock, range + 30)) p.lock = pickNearest(range + 30, mv);
      const t = p.lock;
      const goal = t ? angTo(p, t) : p.face;
      p.aimAng += clamp(angDiff(p.aimAng, goal), -10 * dt, 10 * dt);
      p.face = p.aimAng;
      p.fuel -= TORCH.use * dt; p.fireT = 0;
      if (p.fuel <= 0) { p.fuel = 0; p.fuelLock = true; addText(p.x, p.y - 30, "연료 부족", C.muted, false); }
      // 불꽃 입자
      for (let i = 0; i < (touchMode ? 3 : 5); i++) {
        const a = p.aimAng + rand(-TORCH.half, TORCH.half) * 0.8, sp = rand(340, 560) * st.reach;
        particles.push({ x: p.x + Math.cos(p.aimAng) * 14, y: p.y + Math.sin(p.aimAng) * 14, z: 16, vz: rand(-10, 30), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: rand(0.16, 0.26), max: 0.26, color: Math.random() < 0.4 ? "#fff1a8" : Math.random() < 0.5 ? "#ffb347" : "#ff6a2b", size: rand(3, 6), glow: true, nograv: true });
      }
      p.tickT -= dt;
      if (p.tickT <= 0) {
        p.tickT = TORCH.tick / st.spd;
        for (const e of enemies) {
          if (e.dead || e.drop > 0) continue;
          const d = dist(p, e);
          if (d - e.r > range) continue;
          if (Math.abs(angDiff(p.aimAng, angTo(p, e))) > TORCH.half + Math.atan2(e.r, Math.max(d, 1))) continue;
          const soft = !(e.torchT > 0);
          if (soft) { e.torchT = TORCH.burn; applyBurn(e, 1, 3, TORCH.burnCap); }
          hurtEnemy(e, TORCH.dmg * st.atkMul, angTo(p, e), 10, false, soft ? "atkSoft" : "atkTick", "#ffb347");
        }
      }
      p.flameSnd -= dt; if (p.flameSnd <= 0) { p.flameSnd = 0.11; sfx("flame"); }
      p.pullT += dt;
      if (has("mag_atk") && p.pullT >= 1.5) { p.pullT = 0; pullTo(p.x + Math.cos(p.aimAng) * 60, p.y + Math.sin(p.aimAng) * 60, mval("mag_atk"), 0.6); }
    } else {
      p.lock = null;
      p.aimAng = p.face;
      if (p.fireT > 0.5) p.fuel = Math.min(100, p.fuel + TORCH.regen * dt);
    }
    p.firing = p.flaming;
  }
}
function overheat() {
  const p = player;
  p.heat = 100; p.overheat = RIVET.lock;
  addText(p.x, p.y - 30, "과열!", C.danger, true);
  burst(p.x, p.y, 10, "#ff6a2b", 160, 0.4, 2.4);
  sfx("overheat");
}
// 특수 공격 (지상에서만)
function useSpecial(mv) {
  const p = player, st = p.st, w = p.weapon;
  if (w === "wrench") {
    const t = pickTarget(320, mv);
    if (t) p.face = angTo(p, t);
    p.wrench = { x: p.x + Math.cos(p.face) * 18, y: p.y + Math.sin(p.face) * 18, r: 12, ang: p.face, t: 0, out: true, spin: 0, hit: new Set() };
    sfx("throw");
    return true;
  }
  if (w === "rivet") {
    if (p.overheat > 0) return false;
    const t = lockValid(p.lock, 240) ? p.lock : pickNearest(220 * st.reach, mv), base = t ? angTo(p, t) : p.face;
    p.face = base;
    for (let i = -2; i <= 2; i++) {
      const ang = base + i * 0.17 + rand(-0.03, 0.03);
      shots.push({ x: p.x + Math.cos(ang) * 16, y: p.y + Math.sin(ang) * 16, vx: Math.cos(ang) * 560, vy: Math.sin(ang) * 560, life: 220 * st.reach / 560, dmg: RIVET.spDmg * st.throwMul, kb: 130, src: "throw", ang, kind: "pellet" });
    }
    p.kx -= Math.cos(base) * 160; p.ky -= Math.sin(base) * 160;
    p.flashT = 0.1; p.fireT = 0;
    shake(4); sfx("shotgun");
    p.heat += RIVET.spHeat; if (p.heat >= 100) overheat();
    p.specCd = st.throwCd;
    return true;
  }
  if (w === "torch") {
    if (p.fuel < 20) { addText(p.x, p.y - 30, "연료 부족", C.muted, false); return false; }
    const t = lockValid(p.lock, 160) ? p.lock : pickNearest(160, mv), ang = t ? angTo(p, t) : p.face;
    const d = t ? Math.min(120, dist(p, t)) : 70;
    const fx = clamp(p.x + Math.cos(ang) * d, RX0 + 20, RX1 - 20), fy = clamp(p.y + Math.sin(ang) * d, RY0 + 20, RY1 - 20);
    fires.push({ x: fx, y: fy, r: 45 * st.reach, t: 2.5, max: 2.5, tick: 0, hit: new Set() });
    p.fuel -= 20; p.face = ang;
    burst(fx, fy, 18, "#ff6a2b", 200, 0.5, 3);
    sfx("ignite");
    p.specCd = st.throwCd;
    return true;
  }
  return false;
}
function updateShots(dt) {
  for (const s of shots) {
    if (s.dead) continue;
    s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
    if (s.life <= 0) { s.dead = true; continue; }
    if (s.x < RX0 || s.x > RX1 || s.y < RY0 || s.y > RY1 || room.obstacles.some((o) => inRect(s.x, s.y, o))) { s.dead = true; burst(s.x, s.y, 4, "#fff1a8", 140, 0.18, 1.6); continue; }
    for (const e of enemies) {
      if (e.dead || e.drop > 0) continue;
      if (dist(s, e) < e.r + 4) {
        s.dead = true;
        hurtEnemy(e, s.dmg, s.ang, s.kb, false, s.src, s.kind === "rivet" ? "#fff1a8" : undefined);
        if (s.kind === "rivet") { burst(s.x, s.y, 3, "#fff1a8", 120, 0.15, 1.6); sfx("tick"); }
        break;
      }
    }
  }
  shots = shots.filter((s) => !s.dead);
  for (const f of fires) {
    f.t -= dt; f.tick -= dt;
    if (Math.random() < (touchMode ? 0.5 : 0.9)) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * f.r; particles.push({ x: f.x + Math.cos(a) * r, y: f.y + Math.sin(a) * r * 0.9, z: 2, vz: rand(40, 90), vx: 0, vy: 0, life: 0.4, max: 0.4, color: Math.random() < 0.5 ? "#ffb347" : "#ff6a2b", size: rand(2.5, 4.5), glow: true, nograv: true }); }
    if (f.tick <= 0) {
      f.tick = 0.5;
      for (const e of enemies) {
        if (e.dead || e.drop > 0 || e.type === "drone" || e.air || dist(f, e) > f.r + e.r * 0.5) continue;
        const first = !f.hit.has(e); f.hit.add(e);
        applyBurn(e, 1, 3, TORCH.burnCap);
        hurtEnemy(e, 3 * player.st.throwMul, null, 0, false, first ? "throw" : "proc", "#ff7a33");
      }
    }
  }
  fires = fires.filter((f) => f.t > 0);
}
function drawShot(s) {
  const X = s.x, Y = syf(s.y, 18), a = Math.atan2(Math.sin(s.ang) * SY, Math.cos(s.ang));
  ctx.save(); ctx.translate(X, Y); ctx.rotate(a);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = s.kind === "rivet" ? "rgba(255,241,168,0.35)" : "rgba(255,180,90,0.35)";
  ctx.beginPath(); ctx.ellipse(-6, 0, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = s.kind === "rivet" ? "#e8edf2" : "#ffcf8a";
  ctx.beginPath(); ctx.ellipse(0, 0, 5, 2.4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawFires() {
  for (const f of fires) {
    const k = Math.min(1, f.t / 0.4), fl = 0.85 + Math.sin(performance.now() / 70 + f.x) * 0.15;
    ctx.save(); ctx.translate(f.x, syf(f.y)); ctx.scale(1, SY);
    const g = ctx.createRadialGradient(0, 0, 4, 0, 0, f.r);
    g.addColorStop(0, `rgba(255,190,90,${0.55 * k * fl})`); g.addColorStop(0.6, `rgba(255,106,43,${0.35 * k * fl})`); g.addColorStop(1, "rgba(255,106,43,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, f.r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = `rgba(255,140,60,${0.6 * k})`; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(0, 0, f.r, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
}
// 무기 그림 (캐릭터 손, 시작 화면 카드)
function cWeapon(g, x, y, s, ang, w) {
  if (!w || w === "wrench") { cWrench(g, x, y, s, ang); return; }
  g.save(); g.translate(x, y); g.rotate(ang - 0.4);
  if (w === "rivet") {
    g.fillStyle = "#59616b"; g.fillRect(-6 * s, -30 * s, 12 * s, 30 * s);
    g.fillStyle = "#3a4047"; g.fillRect(-4 * s, -40 * s, 8 * s, 12 * s);
    g.fillStyle = "#f2c230"; g.fillRect(-6 * s, -18 * s, 12 * s, 4 * s);
    g.fillStyle = "#30353b"; g.fillRect(-10 * s, -8 * s, 8 * s, 12 * s);
  } else {
    g.fillStyle = "#e0662a"; g.beginPath(); g.ellipse(0, -8 * s, 8 * s, 11 * s, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = "#9c3d14"; g.fillRect(-8 * s, -10 * s, 16 * s, 3 * s);
    g.strokeStyle = "#aeb7bf"; g.lineWidth = 4 * s; g.lineCap = "round"; g.beginPath(); g.moveTo(0, -18 * s); g.lineTo(0, -38 * s); g.stroke();
    g.fillStyle = "#7fe0ff"; g.beginPath(); g.arc(0, -40 * s, 3.5 * s, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}
function setWeapon(id) {
  if (!WEAPONS[id]) return;
  weaponId = id;
  try { localStorage.setItem("b07-weapon", id); } catch (e) {}
  document.querySelectorAll(".wpick").forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === id ? "true" : "false"));
  $("wpName").textContent = WEAPONS[id].name + " · " + WEAPONS[id].tag;
  $("wpDesc").textContent = WEAPONS[id].desc;
}
function initWeaponPicker() {
  const box = $("wpicker");
  WEAPON_ORDER.forEach((id) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "wpick"; b.dataset.id = id; b.setAttribute("aria-label", WEAPONS[id].name);
    const cvs = document.createElement("canvas"); cvs.width = 72; cvs.height = 72;
    const g = cvs.getContext("2d"); cWeapon(g, 30, 62, 1.2, 0.4, id);
    const tx = document.createElement("span"); tx.innerHTML = "";
    const nm = document.createElement("b"); nm.textContent = WEAPONS[id].name;
    const tg = document.createElement("small"); tg.textContent = WEAPONS[id].tag;
    tx.append(nm, tg);
    b.append(cvs, tx);
    b.addEventListener("click", () => { setWeapon(id); sfx("choose"); });
    box.append(b);
  });
  setWeapon(weaponId);
}

// ================= 듀오 모듈 =================
// 서로 다른 두 계열 모듈을 모두 장착하고 있을 때만 후보에 나옴. 별도의 듀오 슬롯 1칸
const DUOS = {
  superconduct: { fams: ["volt", "frost"], name: "초전도", d: "빙결된 적에게 주는 번개 피해 3배" },
  thermal:      { fams: ["heat", "frost"], name: "열충격", d: "화상 중인 적이 얼면 폭발해 주변에 20 피해 (화상은 사라짐)" },
  emfield:      { fams: ["mag", "volt"], name: "전자기장", d: "끌어모은 적이 2초 동안 감전 (초당 8 피해)" },
  steam:        { fams: ["hyd", "heat"], name: "증기 압력", d: "피격당하면 주변에 증기 폭발 (25 피해, 밀쳐냄)" },
  magcool:      { fams: ["mag", "frost"], name: "자기 냉각", d: "끌어모은 적에게 냉기 2중첩" },
  overload:     { fams: ["hyd", "volt"], name: "과부하 엔진", d: "대시 후 2초 안에 처음 맞힌 공격에 번개 강타 +20" },
  furnace:      { fams: ["mag", "heat"], name: "용광로 자석", d: "화상 걸린 적이 쓰러지면 주변 적에게 화상이 옮겨붙음" },
  hydcool:      { fams: ["hyd", "frost"], name: "유압 냉각기", d: "빙결된 적에게 주는 피해 +50%" },
};
function hasDuo(id) { return player && player.duo === id; }
function famOwned(f) { return SLOT_ORDER.some((sl) => player.mods[sl] && MODS[player.mods[sl].id].fam === f); }
function eligibleDuos() { return Object.keys(DUOS).filter((id) => id !== player.duo && DUOS[id].fams.every(famOwned)); }
function duoOption(id) {
  const d = DUOS[id], cur = player.duo;
  return {
    title: d.name, tag: "듀오", tagColor: "#f2c230", color: FAM[d.fams[0]].color, color2: FAM[d.fams[1]].color,
    line: "듀오 · " + FAM[d.fams[0]].name + " + " + FAM[d.fams[1]].name,
    desc: d.d,
    note: cur ? "교체: 지금 " + DUOS[cur].name : "듀오 슬롯에 장착",
    apply: () => { player.duo = id; addText(player.x, player.y - 30, d.name, "#f2c230", true); sfx("revive"); },
  };
}
function thermalBlast(e) {
  e.burnS = 0; e.burnT = 0;
  waves.push({ x: e.x, y: e.y, t: 0, max: 0.3, R: 70, col: "#ffb0f0" });
  burst(e.x, e.y, 16, "#ffd0f0", 260, 0.4, 2.6);
  sfx("explode");
  for (const o of enemies) if (!o.dead && !o.drop && dist(o, e) < 70 + o.r) hurtEnemy(o, 20, angTo(e, o), 160, false, "proc", "#ff9ad8");
}
function steamBlast() {
  const p = player;
  waves.push({ x: p.x, y: p.y, t: 0, max: 0.35, R: 90, col: "#e8f0f0" });
  burst(p.x, p.y, 20, "#e8f0f0", 240, 0.5, 3);
  for (const e of enemies) if (!e.dead && !e.drop && dist(p, e) < 90 + e.r) hurtEnemy(e, 25, angTo(p, e), 400, false, "proc", "#e8f0f0");
}

// ================= 긴급 생산 라인 (챌린지 방) =================
const CHALLENGE_T = 30;
function spawnChallenge(elapsed) {
  const n = localN(room.n), group = 2 + Math.floor(elapsed / 10);
  const turrets = enemies.filter((e) => e.type === "turret" && !e.dead).length + pending.filter((s) => s.type === "turret").length;
  for (let i = 0; i < group; i++) {
    let type = turrets + (i === 0 ? 0 : 1) < 3 && Math.random() < 0.25 + n * 0.03 ? "turret" : "spark";
    if (type === "spark" && n >= 3 && elapsed > 8 && Math.random() < 0.18) type = "drum";
    const r = ENEMY_R[type];
    let q, tries = 0;
    do { q = { x: RX0 + 40 + Math.random() * (RX1 - RX0 - 80), y: RY0 + 40 + Math.random() * (RY1 - RY0 - 80), r }; tries++; }
    while (tries < 60 && (dist(q, player) < 200 || room.obstacles.some((o) => inRect(q.x, q.y, o, r + 10)) || pending.some((s) => dist(q, s) < 50)));
    pending.push({ type, x: q.x, y: q.y, r, t: 0.8 + i * 0.1 });
  }
}
function updateChallenge(dt) {
  const p = player;
  if (room.cleared || p.dead) return;
  if (!room.chStarted) {
    room.delay -= dt;
    if (room.delay <= 0) { room.chStarted = true; room.chT = CHALLENGE_T; room.chSpawn = 0; showBanner("긴급 생산 라인 가동", "30초 동안 버티세요"); banner.t = 1.6; sfx("door"); }
    return;
  }
  room.chT -= dt; room.chSpawn -= dt;
  const elapsed = CHALLENGE_T - room.chT;
  if (room.chSpawn <= 0 && room.chT > 2) { spawnChallenge(elapsed); room.chSpawn = Math.max(1.1, 2.5 - elapsed * 0.05); }
  if (room.chT <= 0) {
    room.cleared = true; room.chT = 0;
    pending = [];
    for (const e of enemies) if (!e.dead) { e.dead = true; burst(e.x, e.y, 18, "#ffb347", 260, 0.45, 3); debris(e.x, e.y, 6, e.type === "turret" ? C.turret : C.spark); }
    shake(14); sfx("explode");
    run.score += 300;
    gainScrap(60, p.x, p.y);
    showBanner("생산 라인 정지 +300", "보상 2개를 받으세요");
    room.reward = "challenge";
    spawnPickup();
  }
}

// ================= 수리 부품 드롭 =================
let healDrops = [];
const DROP_HEAL = 5;
function updateDrops(dt) {
  const p = player;
  for (const d of healDrops) {
    d.t -= dt;
    d.x += d.vx * dt; d.y += d.vy * dt; d.vx *= 1 - Math.min(1, dt * 3); d.vy *= 1 - Math.min(1, dt * 3);
    d.vz -= 900 * dt; d.z += d.vz * dt;
    if (d.z < 6) { d.z = 6; d.vz = Math.abs(d.vz) > 60 ? -d.vz * 0.4 : 0; }
    d.x = clamp(d.x, RX0 + 10, RX1 - 10); d.y = clamp(d.y, RY0 + 10, RY1 - 10);
    if (p.dead || p.hp >= p.maxHp) continue;
    const dd = dist(p, d);
    if (dd < 80) { const a = angTo(d, p), sp = 340 * (1 - dd / 100) + 120; d.x += Math.cos(a) * sp * dt; d.y += Math.sin(a) * sp * dt; }
    if (dd < 18) {
      d.t = 0;
      p.hp = Math.min(p.maxHp, p.hp + DROP_HEAL);
      addText(p.x, p.y - 30, "+" + DROP_HEAL, C.good, false);
      burst(p.x, p.y, 6, C.good, 120, 0.3, 2);
      sfx("heal");
    }
  }
  healDrops = healDrops.filter((d) => d.t > 0);
}
function drawDrop(d) {
  if (d.t < 2 && Math.floor(d.t * 8) % 2 === 0) return;
  const bob = Math.sin(performance.now() / 200 + d.x) * 2;
  floorEllipse(d.x, d.y, 6, 4, "rgba(0,0,0,0.35)");
  const X = d.x, Y = syf(d.y, d.z + bob);
  const g = ctx.createRadialGradient(X, Y, 1, X, Y, 14); g.addColorStop(0, "rgba(89,227,154,0.55)"); g.addColorStop(1, "rgba(89,227,154,0)");
  ctx.fillStyle = g; ctx.fillRect(X - 14, Y - 14, 28, 28);
  ctx.fillStyle = "#e8fff2"; ctx.fillRect(X - 5, Y - 5, 10, 10);
  ctx.fillStyle = C.good; ctx.fillRect(X - 1.5, Y - 4, 3, 8); ctx.fillRect(X - 4, Y - 1.5, 8, 3);
}

// ================= 업데이트 =================
function update(dt) {
  const p = player;
  run.time += p.dead ? 0 : dt;

  // --- 플레이어 ---
  if (!p.dead) {
    const mv = moveVec();
    const a = p.atk;
    if (mv.len > 0.2 && a.i < 0 && !p.slam && !p.firing) p.face = Math.atan2(mv.y, mv.x);
    p.moving = mv.len > 0.2 && !p.air && p.dash.t <= 0;
    if (p.slamCd > 0) p.slamCd -= dt;
    if (p.overloadT > 0) p.overloadT -= dt;
    if (p.squash > 0) p.squash -= dt;

    // 대시 (지상에서만)
    const d = p.dash;
    if (d.charges < d.max) { d.regen += dt; if (d.regen >= p.st.dashRegen) { d.regen = 0; d.charges++; } }
    if (input.dashP && !p.air && d.charges > 0 && d.t <= 0) {
      d.charges--; d.t = 0.16; d.hit = new Set();
      if (hasDuo("overload")) p.overloadT = 2;
      if (mv.len > 0.2) { const l = Math.hypot(mv.x, mv.y); d.dx = mv.x / l; d.dy = mv.y / l; } else { d.dx = Math.cos(p.face); d.dy = Math.sin(p.face); }
      if (a.i >= 0) a.i = -1;
      sfx("dash");
    }

    // 점프 (지상에서만 시작, 공중 연속 점프 없음)
    if (input.jumpP && !p.air && d.t <= 0) {
      p.air = true; p.vz = JUMP_V; p.z = 0.1;
      if (a.i >= 0) a.i = -1;
      sfx("jump");
    }

    // 이동
    if (d.t > 0) {
      d.t -= dt;
      p.x += d.dx * 760 * dt; p.y += d.dy * 760 * dt;
      afterimages.push({ x: p.x, y: p.y, z: 0, t: 0.22 });
      for (const e of enemies) if (!e.dead && !e.drop && !d.hit.has(e) && dist(p, e) < p.r + e.r + 6) { d.hit.add(e); onHit(e, "dash"); }
      if (d.t <= 0) {
        if (has("frost_dash")) { for (const e of enemies) if (!e.dead && !e.drop && dist(p, e) < 80) applyChill(e, mval("frost_dash")); waves.push({ x: p.x, y: p.y, t: 0, max: 0.3, R: 80, col: FAM.frost.color }); }
        if (has("mag_dash")) pullTo(p.x, p.y, mval("mag_dash"), 0.6);
      }
    } else if (p.slam) {
      const sl = p.slam;
      if (sl.phase === "wind") { sl.t -= dt; if (sl.t <= 0) { sl.phase = "dive"; sl.time = Math.max(0.06, p.z / 1500); sl.vx = (sl.tx - p.x) / sl.time; sl.vy = (sl.ty - p.y) / sl.time; } }
      else { p.x += sl.vx * dt; p.y += sl.vy * dt; p.z -= 1500 * dt; afterimages.push({ x: p.x, y: p.y, z: p.z, t: 0.15 }); }
    } else {
      const sp = (p.air ? 185 : (a.i >= 0 ? 0.45 : 1) * 215) * (p.firing ? (p.weapon === "rivet" ? RIVET.moveMul : 0.75) : 1);
      p.x += mv.x * sp * dt; p.y += mv.y * sp * dt;
      p.walk += mv.len * sp * dt * 0.06;
    }
    p.x += p.kx * dt; p.y += p.ky * dt;
    p.kx -= p.kx * Math.min(1, dt * 10); p.ky -= p.ky * Math.min(1, dt * 10);

    // 높이
    if (p.air) {
      if (!p.slam) { p.z += p.vz * dt; p.vz -= GRAV * dt; }
      if (p.z <= 0) {
        p.z = 0; p.air = false; p.vz = 0;
        if (p.slam && p.slam.phase === "dive") slamLand();
        else { p.slam = null; p.squash = 0.1; sfx("step"); for (let i = 0; i < 8; i++) { const an = i / 8 * Math.PI * 2; particles.push({ x: p.x, y: p.y, z: 1, vz: 10, vx: Math.cos(an) * 90, vy: Math.sin(an) * 90, life: 0.3, max: 0.3, color: "#5d6268", size: 3.5, glow: false, nograv: true }); } }
      }
    }
    if (!p.air && d.t <= 0 && !p.slam && !p.grabbed) beltPush(p, dt);
    const pHit = collideWorld(p, room.doorOpen);
    if (p.thrownT > 0) {
      p.thrownT -= dt;
      if (pHit) { p.thrownT = 0; p.inv = 0; hurtPlayer(MA.wallDmg, null, "멀티암에게 벽으로 내던져졌어요"); p.kx = p.ky = 0; shake(12); sfx("slam"); burst(p.x, p.y, 14, "#9aa4ad", 240, 0.35, 2.6); }
    }
    if (d.t <= 0 && p.z < 20) for (const e of enemies) {
      if (e.drop > 0 || e.type === "drone" || e.type === "arm" || e.air) continue;
      const dd = dist(p, e), min = p.r + e.r;
      if (dd < min && dd > 0) { const an = angTo(e, p); p.x = e.x + Math.cos(an) * min; p.y = e.y + Math.sin(an) * min; }
    }
    if (p.inv > 0) p.inv -= dt;
    if (p.markT > 0) p.markT -= dt;
    if (p.hpLag > p.hp) { if (p.lagT > 0) p.lagT -= dt; else p.hpLag = Math.max(p.hp, p.hpLag - p.maxHp * 0.9 * dt); }
    else { if (p.hp > p.hpLag + 0.5) p.healGlow = 0.6; p.hpLag = p.hp; }
    if (p.healGlow > 0) p.healGlow -= dt;

    // 공격 입력
    if (a.cd > 0) a.cd -= dt;
    if (a.comboT > 0) { a.comboT -= dt; if (a.comboT <= 0) a.next = 0; }
    if (p.air) {
      // 공중: 내려찍기 (쿨타임 중이면 공중 휘두르기)
      if (input.atkP && !p.slam && !p.wrench) {
        if (p.slamCd <= 0) {
          const t = pickTarget(130 + 20, mv);
          let tx = p.x, ty = p.y;
          if (t) { const dd = Math.min(120, dist(p, t)), an = angTo(p, t); tx = p.x + Math.cos(an) * dd; ty = p.y + Math.sin(an) * dd; p.face = an; }
          p.slam = { phase: "wind", t: 0.08, power: clamp(p.z / (JUMP_V * JUMP_V / (2 * GRAV)), 0, 1), tx, ty };
          if (a.i >= 0) a.i = -1;
          sfx("swing");
        } else if (a.i < 0 && p.weapon === "wrench") startSwing(3, mv);
      }
    } else if (p.weapon === "wrench" && !p.wrench) {
      if (a.i < 0 && a.cd <= 0 && (input.atkP || atkHeld())) startSwing(a.comboT > 0 ? a.next : 0, mv);
      else if (a.i >= 0 && input.atkP) a.queued = true;
    }
    if (a.i >= 0) {
      const s = a.sw;
      a.t += dt;
      if (a.t >= 0.03 && a.t <= s.dur * 0.65) {
        for (const e of enemies) {
          if (e.dead || e.drop > 0 || a.hit.has(e)) continue;
          const dd = dist(p, e);
          if (dd <= s.reach + e.r && Math.abs(angDiff(a.ang, angTo(p, e))) <= s.half) { a.hit.add(e); hurtEnemy(e, s.dmg, angTo(p, e), s.kb, s.heavy); }
        }
        for (const b of bolts) {
          if (b.dead) continue;
          if (dist(p, b) <= s.reach + 6 && Math.abs(angDiff(a.ang, angTo(p, b))) <= s.half) {
            b.dead = true; burst(b.x, b.y, 8, C.swing, 200, 0.25, 2); sfx("parry"); addText(b.x, b.y - 10, "튕겨냄", C.visor, false);
          }
        }
      }
      if (a.t >= s.dur) {
        if (s.air) { a.i = -1; }
        else if ((a.queued || atkHeld()) && a.i < 2 && !p.wrench && !p.air) startSwing(a.i + 1, mv);
        else {
          if (a.i === 2) { a.cd = 0.28; a.next = 0; a.comboT = 0; } else { a.next = a.i + 1; a.comboT = 0.38; }
          a.i = -1;
        }
      }
    }
    if (p.weapon !== "wrench") rangedUpdate(dt, mv, !p.slam && d.t <= 0 && (atkHeld() || input.atkP));
    // 대상 표시용
    if (p.weapon === "rivet") p.mark = p.lock || pickNearest(RIVET.range * p.st.reach, mv);
    else if (p.weapon === "torch") p.mark = p.lock || pickNearest(TORCH.range * p.st.reach + 30, mv);
    else p.mark = a.i >= 0 && targetValid(a.target, MELEE_RANGE) ? a.target : pickTarget(MELEE_RANGE, mv);

    // 특수 공격 (지상에서만)
    if (p.specCd > 0 && !p.wrench) p.specCd -= dt;
    if (input.throwP && !p.air && !p.wrench && p.specCd <= 0 && a.i < 0) useSpecial(mv);
    if (p.flashT > 0) p.flashT -= dt;
  } else {
    p.deathT -= dt;
    if (p.deathT <= 0 && state === "play") die();
  }
  const wr = p.wrench;
  if (wr) {
    wr.spin += dt * 22; wr.t += dt;
    if (wr.out) {
      wr.x += Math.cos(wr.ang) * 820 * dt; wr.y += Math.sin(wr.ang) * 820 * dt;
      const hitWall = wr.x < RX0 || wr.x > RX1 || wr.y < RY0 || wr.y > RY1 || room.obstacles.some((o) => inRect(wr.x, wr.y, o));
      if (wr.t > 0.32 || hitWall) { wr.out = false; wr.hit = new Set(); if (hitWall) { burst(wr.x, wr.y, 8, C.eye, 200, 0.25, 2); sfx("clank"); } }
    } else {
      const a2 = angTo(wr, p);
      wr.x += Math.cos(a2) * 900 * dt; wr.y += Math.sin(a2) * 900 * dt;
      if (dist(wr, p) < p.r + 12 || p.dead) { p.wrench = null; p.specCd = p.st.throwCd; if (!p.dead) sfx("catch"); }
    }
    if (p.wrench) {
      for (const e of enemies) {
        if (e.dead || e.drop > 0 || wr.hit.has(e)) continue;
        if (dist(wr, e) < wr.r + e.r) {
          wr.hit.add(e); hurtEnemy(e, 14 * p.st.throwMul, wr.out ? wr.ang : angTo(wr, p), 160, false, "throw");
        }
      }
      for (const b of bolts) if (!b.dead && dist(wr, b) < wr.r + 6) { b.dead = true; burst(b.x, b.y, 6, C.swing, 180, 0.2, 2); sfx("parry"); }
    }
  }
  updateShots(dt);
  updateDrops(dt);
  input.atkP = input.jumpP = input.throwP = input.dashP = false;

  // --- 대기 중 스폰 ---
  for (const s of pending) {
    s.t -= dt;
    if (s.t <= 0) { s.done = true; const ne = makeEnemy(s); ne.drop = 0.34; enemies.push(ne); sfx("spawn"); }
  }
  pending = pending.filter((s) => !s.done);

  // --- 적 ---
  const DT = dt;
  for (const e of enemies) {
    const dt = e.elite === "haste" ? DT * ELITE.haste : DT; // 정예 '가속'은 모든 행동이 1.4배
    if (e.dead) continue;
    if (e.drop > 0) {
      e.drop -= dt;
      if (e.drop <= 0) {
        e.drop = 0;
        for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; particles.push({ x: e.x, y: e.y, z: 2, vz: 20, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, life: 0.4, max: 0.4, color: "#6b6f74", size: 4, glow: false, nograv: true }); }
        shake(3); sfx("land");
        if (e.kind === "multiarm") spawnArms(e);
        if (e.type === "boss") { shake(20); sfx("slam"); debris(e.x, e.y, 14, "#6b6f74"); waves.push({ x: e.x, y: e.y, t: 0, max: 0.5, R: 160 }); room.cracks.push({ x: e.x, y: e.y + 20, seed: 3 }); hitstop = Math.max(hitstop, 0.12); }
      }
      continue;
    }
    if (e.flash > 0) e.flash -= dt;
    if (e.elite) updateElite(e, dt);
    updateStatus(e, dt);
    if (e.dead) continue;
    const dp = dist(e, p), ap = angTo(e, p);
    if (e.frozen > 0) {
      // 빙결: 행동 정지
    } else if (e.type === "boss") {
      updateBoss(e, dt);
    } else if (e.type === "arm") {
      if (e.state === "stun" && e.owner && e.owner.state !== "clawStuck") e.state = "idle";
    } else if (e.type === "insp") {
      updateInsp(e, dt, dp, ap);
    } else if (e.type === "drone") {
      updateDrone(e, dt, dp, ap);
    } else if (e.type === "medic") {
      updateMedic(e, dt, dp, ap);
    } else if (e.type === "drum") {
      updateDrum(e, dt, dp, ap);
    } else if (e.type === "lift") {
      updateLift(e, dt, dp, ap);
    } else if (e.type === "spark") {
      e.spin += dt * (e.state === "charge" ? 18 : e.state === "windup" ? 10 : 3);
      if (e.state === "chase") {
        e.cd -= dt;
        if (!p.dead) { const sp = 95 * (1 - 0.1 * (e.chillS || 0)); e.x += Math.cos(ap) * sp * dt; e.y += Math.sin(ap) * sp * dt; }
        if (!p.dead && e.cd <= 0 && dp < 270 && los(e, p)) { e.state = "windup"; e.t = 0.55; e.aim = ap; sfx("windup"); }
      } else if (e.state === "windup") {
        e.t -= dt;
        if (e.t > 0.18) e.aim = ap;
        if (e.t <= 0) { e.state = "charge"; e.t = 0.55; e.hitPlayer = false; }
      } else if (e.state === "charge") {
        e.t -= dt;
        e.x += Math.cos(e.aim) * 540 * dt; e.y += Math.sin(e.aim) * 540 * dt;
        if (Math.random() < 0.6) particles.push({ x: e.x, y: e.y, z: 14, vz: 0, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.25, max: 0.25, color: C.eye, size: 2, glow: true, nograv: true });
        if (!e.hitPlayer && p.z < 22 && dist(e, p) < e.r + p.r) { e.hitPlayer = true; hurtPlayer(15, e, "스파크봇의 돌진에 부딪혔어요"); }
        if (e.t <= 0) { e.state = "recover"; e.t = 0.5; }
      } else if (e.state === "recover") {
        e.t -= dt; if (e.t <= 0) { e.state = "chase"; e.cd = 1.1 + Math.random() * 0.8; }
      } else if (e.state === "stun") {
        e.t -= dt; if (e.t <= 0) { e.state = "chase"; e.cd = 0.9; }
      }
    } else {
      // 터렛
      const turn = e.state === "tele" ? 1.2 : 2.6;
      e.aim += clamp(angDiff(e.aim, ap), -turn * dt, turn * dt);
      e.t -= dt;
      if (e.state === "idle") {
        if (e.t <= 0) { if (!p.dead && los(e, p)) { e.state = "tele"; e.t = 0.5; } else e.t = 0.3; }
      } else if (e.state === "tele") {
        if (e.t <= 0) { e.state = "fire"; e.shots = 3; e.t = 0; }
      } else if (e.state === "fire") {
        if (e.t <= 0) {
          const ba = e.aim + rand(-0.05, 0.05);
          bolts.push({ x: e.x + Math.cos(ba) * 24, y: e.y + Math.sin(ba) * 24, vx: Math.cos(ba) * 300, vy: Math.sin(ba) * 300, r: 5, ang: ba });
          sfx("shoot"); e.shots--; e.t = 0.13;
          if (e.shots <= 0) { e.state = "idle"; e.t = 1.8 + Math.random() * 0.6; }
        }
      }
    }
    e.x += e.vx * dt; e.y += e.vy * dt;
    e.vx -= e.vx * Math.min(1, dt * 7); e.vy -= e.vy * Math.min(1, dt * 7);
    if (e.type !== "turret" && e.type !== "boss" && e.type !== "drone" && e.type !== "arm") beltPush(e, dt);
    let hit;
    if (e.type === "arm") hit = false;
    else if (e.type === "drone") { e.x = clamp(e.x, RX0 + e.r, RX1 - e.r); e.y = clamp(e.y, RY0 + e.r, RY1 - e.r); hit = false; }
    else hit = collideWorld(e, false);
    if (hit && e.type === "boss" && e.state === "charge") bossCrash(e);
    if (hit && e.type === "lift" && e.state === "ram") { e.state = "after"; e.t = LIFT.after; shake(4); sfx("clank"); burst(e.x + Math.cos(e.face) * e.r, e.y + Math.sin(e.face) * e.r, 8, C.eye, 200, 0.25, 2.2); }
    if (hit && e.type === "spark" && e.state === "charge") {
      e.state = "stun"; e.t = 1.1; shake(5); sfx("clank");
      burst(e.x, e.y, 12, C.eye, 240, 0.3, 2.2);
      e.vx -= Math.cos(e.aim) * 90; e.vy -= Math.sin(e.aim) * 90; // 튕겨나기만, 피해 없음
    }
  }
  // 적끼리 겹침 해소
  for (let i = 0; i < enemies.length; i++) for (let j = i + 1; j < enemies.length; j++) {
    const a = enemies[i], b = enemies[j]; if (a.dead || b.dead || (a.type === "drone") !== (b.type === "drone") || a.air || b.air) continue;
    const d = dist(a, b), min = a.r + b.r;
    if (d < min && d > 0.01) {
      const ang = angTo(a, b), push = (min - d);
      if (b.type === "arm" || b.type === "boss") { if (a.type !== "arm" && a.type !== "boss" && a.type !== "turret") { a.x -= Math.cos(ang) * push; a.y -= Math.sin(ang) * push; } }
      else if (a.type === "turret" || a.type === "boss" || a.type === "arm" || (a.type === "lift" && b.type !== "lift")) { b.x += Math.cos(ang) * push; b.y += Math.sin(ang) * push; }
      else if (b.type === "turret" || b.type === "boss" || b.type === "lift") { a.x -= Math.cos(ang) * push; a.y -= Math.sin(ang) * push; }
      else { a.x -= Math.cos(ang) * push / 2; a.y -= Math.sin(ang) * push / 2; b.x += Math.cos(ang) * push / 2; b.y += Math.sin(ang) * push / 2; }
    }
  }
  enemies = enemies.filter((e) => !e.dead);

  // --- 탄환 ---
  for (const b of bolts) {
    if (b.dead) continue;
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.spin !== undefined) b.spin += dt * 9;
    if (b.x < RX0 || b.x > RX1 || b.y < RY0 || b.y > RY1 || room.obstacles.some((o) => inRect(b.x, b.y, o))) { b.dead = true; burst(b.x, b.y, 5, b.col || C.bolt, 140, 0.2, 1.8); if (b.kind === "scrap") sfx("clank"); continue; }
    if (!p.dead && p.z < 26 && dist(b, p) < b.r + p.r) {
      if (p.inv <= 0 && p.dash.t <= 0) { b.dead = true; hurtPlayer(b.dmg || 10, b, b.cause || "볼트 터렛의 탄환에 맞았어요"); }
    }
  }
  bolts = bolts.filter((b) => !b.dead);

  updateOils(dt);
  updatePresses(dt);
  updateLasers(dt);
  updateBooms(dt);
  // --- 웨이브 진행 ---
  if (room.kind === "boss") updateBossRoom(dt);
  else if (room.challenge) updateChallenge(dt);
  else if (room.kind === "combat" && !room.cleared && !p.dead && enemies.length === 0 && pending.length === 0) {
    room.delay -= dt;
    if (room.delay <= 0) {
      if (room.wave < room.waves) { room.wave++; spawnWave(room.wave); room.delay = 1.0; }
      else {
        room.cleared = true;
        let bonus = 100; run.score += 100;
        gainScrap(room.tookDamage ? 10 : 15, p.x, p.y);
        if (!room.tookDamage) { run.score += 50; bonus += 50; }
        showBanner("방 클리어 +" + bonus, (room.tookDamage ? "" : "무피격 보너스 +50 · ") + "보상을 획득하세요");
        spawnPickup();
      }
    }
  }
  // --- 보상 획득 ---
  const pk = room.pickup;
  if (pk) {
    pk.t += dt;
    if (state === "play" && !p.dead && p.z < 24 && pk.t > 0.4 && dist(p, pk) < 34) { room.pickup = null; takePickup(pk.type); }
  }
  if (room.doorOpen) {
    room.doorPulse += dt;
    if (state === "play" && !p.dead && p.y < RY0 - 6) { const d = room.doors.find((d) => Math.abs(p.x - d.x) < DOOR_W / 2); if (d) enterDoor(d); }
  }

  // --- 효과 ---
  for (const q of particles) { q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt; q.vx *= 1 - Math.min(1, dt * 4); q.vy *= 1 - Math.min(1, dt * 4); if (q.rot !== undefined) q.rot += q.vr * dt;
    if (!q.nograv) { q.vz -= (q.square ? 1100 : 650) * dt; }
    q.z += q.vz * dt;
    if (q.z < 0) { q.z = 0; q.vz = -q.vz * 0.35; q.vx *= 0.55; q.vy *= 0.55; }
  }
  particles = particles.filter((q) => q.life > 0);
  const cap = touchMode ? 280 : 600;
  if (particles.length > cap) particles.splice(0, particles.length - cap);
  for (const w of waves) w.t += dt;
  for (const z of zaps) z.t -= dt;
  zaps = zaps.filter((z) => z.t > 0);
  waves = waves.filter((w) => w.t < w.max);
  for (const t of texts) { t.t -= dt; t.z += 40 * dt; }
  texts = texts.filter((t) => t.t > 0);
  for (const g of afterimages) g.t -= dt;
  afterimages = afterimages.filter((g) => g.t > 0);
  if (banner) { banner.t -= dt; if (banner.t <= 0) banner = null; }
  shakeAmt = Math.max(0, shakeAmt - dt * 40);
  hurtFlash = Math.max(0, hurtFlash - dt * 2.5);
}


// ================= 보상 선택 =================
let choiceOpts = [];
function shuffleWith(r, arr) { const a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
function openChoice(title, sub, opts) {
  choiceOpts = opts;
  $("chTitle").textContent = title;
  $("chSub").textContent = sub;
  const box = $("chCards");
  box.textContent = "";
  opts.forEach((o, i) => {
    const b = document.createElement("button");
    b.className = "opt"; b.type = "button"; b.disabled = !!o.disabled;
    b.style.setProperty("--fam", o.color || "#3ee0d0");
    if (o.color2) { b.classList.add("duo"); b.style.setProperty("--fam2", o.color2); }
    const top = document.createElement("span"); top.className = "opt-top";
    const nm = document.createElement("b"); nm.textContent = o.title;
    top.append(nm);
    if (o.tag) { const t = document.createElement("em"); t.textContent = o.tag; t.style.color = o.tagColor || "inherit"; top.append(t); }
    b.append(top);
    if (o.line) { const l = document.createElement("span"); l.className = "opt-line"; l.textContent = o.line; b.append(l); }
    const d = document.createElement("span"); d.className = "opt-desc"; d.textContent = o.desc; b.append(d);
    if (o.note) { const n = document.createElement("span"); n.className = "opt-note"; n.textContent = o.note; b.append(n); }
    if (o.price !== undefined) { const pr = document.createElement("span"); pr.className = "opt-price"; pr.textContent = o.sold ? "판매됨" : "고철 " + o.price; b.append(pr); }
    const k = document.createElement("kbd"); k.textContent = i + 1; b.append(k);
    b.addEventListener("click", () => choose(i));
    box.append(b);
  });
  state = "choice";
  $("ovChoice").hidden = false;
  $("chFoot").hidden = true;
  releaseAllTouches(); keys.clear(); input.mouseL = false;
  const first = box.querySelector("button:not([disabled])"); if (first) first.focus({ preventScroll: true });
}
function choose(i) {
  const o = choiceOpts[i];
  if (!o || o.disabled || state !== "choice") return;
  if (o.keep) { sfx("choose"); o.apply(); openShop(); return; }
  $("ovChoice").hidden = true;
  state = "play";
  sfx("choose");
  o.apply();
  if (state !== "choice") {
    if (room.shopActive) openShop();
    else if (room.extraReward) { const x = room.extraReward; room.extraReward = null; takePickup(x); }
    else openDoors();
  }
}
function modOption(id, r, extra) {
  const m = MODS[id], cur = player.mods[m.slot];
  return {
    title: m.name, tag: RARITY[r].name, tagColor: RARITY[r].color, color: FAM[m.fam].color,
    line: SLOTS[m.slot] + " · " + FAM[m.fam].name,
    desc: m.d(m.v[r]),
    note: extra || (cur ? "교체: 지금 " + MODS[cur.id].name : "빈 슬롯에 장착"),
    apply: () => { player.mods[m.slot] = { id, r }; recalcStats(); addText(player.x, player.y - 30, m.name, FAM[m.fam].color, true); },
  };
}
function offerModules() {
  const r = rewardRng("mod"), p = player, n = room.n;
  const cands = shuffleWith(r, Object.keys(MODS).filter((id) => !(p.mods[MODS[id].slot] && p.mods[MODS[id].slot].id === id)));
  const picks = [];
  for (const id of cands) if (picks.length < 3 && !picks.some((q) => MODS[q].fam === MODS[id].fam)) picks.push(id);
  for (const id of cands) if (picks.length < 3 && !picks.includes(id)) picks.push(id);
  const opts = picks.map((id) => { const x = r(); const rar = x < 0.05 + 0.02 * n ? 2 : x < 0.28 + 0.04 * n ? 1 : 0; return modOption(id, rar); });
  const duos = eligibleDuos();
  if (duos.length && r() < 0.25) opts[2] = duoOption(duos[Math.floor(r() * duos.length)]);
  openChoice("강화 모듈", "하나를 골라 장착하세요. 같은 슬롯의 모듈은 교체돼요.", opts);
}
function offerWeapon() {
  const r = rewardRng("wup");
  const keysW = shuffleWith(r, Object.keys(WUPS)).slice(0, 3);
  openChoice("무기 개조", "렌치를 개조하세요. 같은 개조를 여러 번 받으면 효과가 쌓여요.", keysW.map((k) => ({
    title: WUPS[k].name, tag: player.wups[k] ? "×" + (player.wups[k] + 1) : "", color: C.hazard, desc: WUPS[k].d,
    apply: () => { player.wups[k] = (player.wups[k] || 0) + 1; recalcStats(); addText(player.x, player.y - 30, WUPS[k].name, C.hazard, true); },
  })));
}
function upgradable() { return SLOT_ORDER.map((sl) => player.mods[sl]).filter((m) => m && m.r < 2); }
function offerChip() {
  const ups = upgradable(), p = player;
  if (!ups.length) {
    if (!SLOT_ORDER.some((sl) => p.mods[sl])) { offerModules(); return; }
    p.hp = Math.min(p.maxHp, p.hp + 25); addText(p.x, p.y - 30, "+25", C.good, true);
    showBanner("모든 모듈이 최고 등급", "대신 체력을 25 회복했어요");
    return;
  }
  openChoice("강화 칩", "모듈 하나의 등급을 올리세요.", ups.map((m) => {
    const d = MODS[m.id];
    return {
      title: d.name, tag: RARITY[m.r].name + " → " + RARITY[m.r + 1].name, tagColor: RARITY[m.r + 1].color, color: FAM[d.fam].color,
      line: SLOTS[d.slot] + " · " + FAM[d.fam].name, desc: d.d(d.v[m.r + 1]),
      apply: () => { m.r++; recalcStats(); addText(p.x, p.y - 30, d.name + " 강화", RARITY[m.r].color, true); },
    };
  }));
}
function offerStation() {
  const p = player, ups = upgradable();
  const heal = Math.ceil(p.maxHp * 0.5);
  openChoice("충전소", "하나만 사용할 수 있어요.", [
    { title: "수리", color: C.good, desc: `체력 ${heal} 회복`, note: `지금 ${Math.ceil(p.hp)} / ${p.maxHp}`, apply: () => { p.hp = Math.min(p.maxHp, p.hp + heal); addText(p.x, p.y - 30, "+" + heal, C.good, true); } },
    { title: "모듈 강화", color: "#5aa9ff", desc: "장착한 모듈 하나의 등급을 올려요", note: ups.length ? "" : "강화할 모듈이 없어요", disabled: !ups.length, apply: () => offerChip() },
    { title: "무기 개조", color: C.hazard, desc: "렌치 개조 하나를 골라요", apply: () => offerWeapon() },
  ]);
}

// ================= 부품 상점 =================
const PRICE = { mod: [70, 110, 160], weapon: 80, chip: 90, heal: 40, reroll: 30 };
let shopItems = [], shopRerolls = 0;
function buildShop() {
  const r = rewardRng("shop" + shopRerolls), p = player, items = [];
  const ids = shuffleWith(r, Object.keys(MODS).filter((id) => !(p.mods[MODS[id].slot] && p.mods[MODS[id].slot].id === id)));
  for (const id of ids.slice(0, 2)) { const x = r(); const rar = x < 0.15 ? 2 : x < 0.5 ? 1 : 0; items.push({ kind: "mod", id, r: rar, price: PRICE.mod[rar] }); }
  items.push({ kind: "weapon", key: shuffleWith(r, Object.keys(WUPS))[0], price: PRICE.weapon });
  items.push({ kind: "chip", price: PRICE.chip });
  items.push({ kind: "heal", price: PRICE.heal });
  shopItems = items;
}
function openShop() {
  const p = player;
  const opts = shopItems.map((it) => {
    let o;
    if (it.kind === "mod") o = modOption(it.id, it.r);
    else if (it.kind === "weapon") o = { title: WUPS[it.key].name, tag: p.wups[it.key] ? "×" + (p.wups[it.key] + 1) : "", color: C.hazard, line: "무기 개조", desc: WUPS[it.key].d, apply: () => { p.wups[it.key] = (p.wups[it.key] || 0) + 1; recalcStats(); addText(p.x, p.y - 30, WUPS[it.key].name, C.hazard, true); } };
    else if (it.kind === "chip") o = { title: "강화 칩", color: "#5aa9ff", line: "모듈 등급업", desc: "장착한 모듈 하나의 등급을 올려요", apply: () => offerChip() };
    else o = { title: "수리 키트", color: C.good, line: "회복", desc: "체력 30 회복", apply: () => { p.hp = Math.min(p.maxHp, p.hp + 30); addText(p.x, p.y - 30, "+30", C.good, true); } };
    const noUse = it.kind === "chip" && !upgradable().length;
    const full = it.kind === "heal" && p.hp >= p.maxHp;
    o.price = it.price; o.sold = it.sold;
    o.disabled = it.sold || run.scrap < it.price || noUse || full;
    o.note = it.sold ? "구매 완료" : noUse ? "강화할 모듈이 없어요" : full ? "체력이 가득 차 있어요" : o.note;
    const buy = o.apply;
    o.apply = () => { run.scrap -= it.price; it.sold = true; sfx("pickup"); buy(); };
    o.keep = it.kind !== "chip";
    return o;
  });
  openChoice("부품 상점", "고철 " + run.scrap + "개 보유 · 여러 개 살 수 있어요", opts);
  const foot = $("chFoot"); foot.hidden = false;
  $("btnReroll").textContent = "진열 바꾸기 (고철 " + PRICE.reroll + ")";
  $("btnReroll").disabled = run.scrap < PRICE.reroll;
}
function closeShop() {
  room.shopActive = false;
  $("chFoot").hidden = true;
  $("ovChoice").hidden = true;
  state = "play";
  openDoors();
}
function gainScrap(n, x, y, quiet) {
  run.scrap += n;
  if (!quiet) addText(x, y - 34, "고철 +" + n, "#e0bf86", true);
  else if (Math.random() < 0.6) particles.push({ x, y, z: 20, vz: 160, vx: rand(-40, 40), vy: rand(-40, 40), life: 0.6, max: 0.6, color: "#c9a26a", size: 3.5, rot: 0, vr: 8, glow: false, square: true });
}
function takePickup(type) {
  const p = player;
  sfx("pickup"); burst(p.x, p.y, 16, REWARD[type].color, 200, 0.45, 2.4);
  if (type === "challenge") { room.extraReward = "chip"; offerModules(); return; }
  if (type === "scrap") { gainScrap(40 + Math.floor(rewardRng("scrap")() * 21), p.x, p.y); openDoors(); return; }
  if (type === "shop") { room.shopActive = true; shopRerolls = 0; buildShop(); openShop(); return; }
  if (type === "heal") { const h = 30; p.hp = Math.min(p.maxHp, p.hp + h); addText(p.x, p.y - 30, "+" + h, C.good, true); openDoors(); }
  else if (type === "module") offerModules();
  else if (type === "weapon") offerWeapon();
  else if (type === "chip") offerChip();
  else if (type === "station") offerStation();
  if (state !== "choice" && !room.doorOpen) openDoors();
}

function die() { state = "dead"; sfx("lose"); showResult(false); }
function buildText() {
  const p = player;
  const mods = SLOT_ORDER.map((sl) => p.mods[sl]).filter(Boolean).map((m) => MODS[m.id].name + (m.r ? "(" + RARITY[m.r].name + ")" : ""));
  if (p.duo) mods.push(DUOS[p.duo].name + "(듀오)");
  return CHARS[run.char || charId].name + " · " + WEAPONS[run.weapon || weaponId].name + " · 고철 " + run.scrap + " · 예비 배터리 " + (run.batteryUsed ? "사용" : "미사용") + " · " + (mods.length ? "장착 모듈: " + mods.join(", ") : "장착 모듈 없음");
}
function showResult(won) {
  const fin = won && curZone() >= ZONES;
  $("stRoom").textContent = room.n + " / " + ZONE_ROOMS * ZONES;
  $("stScore").textContent = run.score;
  $("stKills").textContent = run.kills;
  const s = Math.floor(run.time); $("stTime").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  $("deadTag").textContent = (run.test ? ({ z2: "2구역 테스트 · ", b2: "2구역 보스 테스트 · ", z3: "3구역 테스트 · ", b3: "최종 보스 테스트 · " }[run.test] || "1구역 보스 테스트 · ") : "") + (fin ? "공장 탈출 성공" : won ? curZone() + "구역 돌파" : "B-07 파괴됨");
  const wz = curZone();
  $("deadTitle").textContent = fin ? "B-07이 공장을 빠져나왔어요!" : won ? "구역 돌파" : roomLabel(room.n) + "에서 작동 정지";
  $("deadCause").textContent = fin ? "QC-9 처치 +1000 · 탈출 보너스 +500 · 남은 체력 " + Math.max(0, Math.ceil(player.hp)) + "/" + player.maxHp : won ? "" : run.cause;
  const fmt = (t) => Math.floor(t / 60) + ":" + String(Math.floor(t % 60)).padStart(2, "0");
  const zt = (run.zt || []).map((t, i, a) => (i + 1) + "구역 " + fmt(t - (i ? a[i - 1] : 0)));
  $("deadBuild").textContent = buildText() + (fin && zt.length ? " · 구역 기록: " + zt.join(", ") : "");
  $("ovDead").hidden = false;
  lbShowForm(won);
  if ($("lbForm").hidden) $("btnRetry").focus(); else $("lbName").focus();
}

// ================= 캐릭터 (외형만 다름, 판정·능력 동일) =================
// draw(g, x, y, s, o): (x, y) = 발 위치. o = { t, phase, moving, back, hurt, wrench, shadow }
function cRR(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function cLin(g, x0, y0, x1, y1, stops) { const gr = g.createLinearGradient(x0, y0, x1, y1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }
function cRad(g, x0, y0, r0, x1, y1, r1, stops) { const gr = g.createRadialGradient(x0, y0, r0, x1, y1, r1); stops.forEach(([o, c]) => gr.addColorStop(o, c)); return gr; }
function cEye(g, x, y, r, o) {
  if (o.hurt) { g.strokeStyle = "#141619"; g.lineWidth = r * 0.45; g.lineCap = "round"; g.beginPath(); g.moveTo(x - r * 0.7, y - r * 0.6); g.lineTo(x + r * 0.5, y); g.lineTo(x - r * 0.7, y + r * 0.6); g.stroke(); return; }
  if (o.blink) { g.strokeStyle = "#141619"; g.lineWidth = r * 0.4; g.lineCap = "round"; g.beginPath(); g.moveTo(x - r * 0.75, y); g.lineTo(x + r * 0.75, y); g.stroke(); return; }
  g.fillStyle = "#141619"; g.beginPath(); g.ellipse(x, y, r * 0.85, r, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#fff"; g.beginPath(); g.arc(x - r * 0.3, y - r * 0.38, r * 0.34, 0, Math.PI * 2); g.fill();
}
function cEyes(g, x, y, gap, r, o) { cEye(g, x - gap, y, r, o); if (o.hurt) { g.save(); g.translate(x + gap, y); g.scale(-1, 1); cEye(g, 0, 0, r, o); g.restore(); } else cEye(g, x + gap, y, r, o); }
function cBlush(g, x, y, r) { g.fillStyle = "rgba(255,120,140,0.55)"; g.beginPath(); g.ellipse(x, y, r, r * 0.55, 0, 0, Math.PI * 2); g.fill(); }
function cMouth(g, x, y, w, o, col) {
  g.strokeStyle = col || "#141619"; g.lineWidth = w * 0.24; g.lineCap = "round"; g.beginPath();
  if (o.hurt) { g.moveTo(x - w * 0.5, y); g.lineTo(x - w * 0.15, y - w * 0.25); g.lineTo(x + w * 0.15, y); g.lineTo(x + w * 0.5, y - w * 0.25); }
  else g.arc(x, y - w * 0.3, w * 0.6, 0.35, Math.PI - 0.35);
  g.stroke();
}
function cWrench(g, x, y, s, ang) {
  g.save(); g.translate(x, y); g.rotate(ang);
  g.strokeStyle = "#aeb7bf"; g.lineWidth = 6 * s; g.lineCap = "round";
  g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -26 * s); g.stroke();
  g.lineWidth = 5 * s; g.beginPath(); g.arc(0, -31 * s, 6 * s, 0.9, Math.PI * 2 - 0.9 + Math.PI); g.stroke();
  g.restore();
}
function cArm(g, x0, y0, x1, y1, w, col, o, wAng) {
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = "round"; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  if (o.wrench) cWeapon(g, x1 + (x1 - x0) * 0.15, y1 + (y1 - y0) * 0.15, w / 7, wAng, o.weapon);
}
function cShadow(g, x, y, w) { g.fillStyle = "rgba(0,0,0,0.45)"; g.beginPath(); g.ellipse(x, y, w, w * 0.32, 0, 0, Math.PI * 2); g.fill(); }

function drawMoni(g, x, y, s, o) {
  if (o.shadow) cShadow(g, x, y, 46 * s);
  const st = o.moving ? Math.sin(o.phase) : 0, bob = o.moving ? Math.abs(Math.cos(o.phase)) * 4 * s : Math.sin(o.t * 2.4) * 1.2 * s;
  g.fillStyle = "#30353b";
  cRR(g, x - 26 * s, y - 20 * s - Math.max(0, st) * 7 * s, 18 * s, 20 * s, 6 * s); g.fill();
  cRR(g, x + 8 * s, y - 20 * s - Math.max(0, -st) * 7 * s, 18 * s, 20 * s, 6 * s); g.fill();
  const Y = y - bob;
  g.fillStyle = cLin(g, x - 34 * s, 0, x + 34 * s, 0, [[0, "#ffd54f"], [1, "#d9a51c"]]); cRR(g, x - 34 * s, Y - 62 * s, 68 * s, 46 * s, 16 * s); g.fill();
  g.fillStyle = "#1b1d20"; for (let i = -30; i < 30; i += 12) g.fillRect(x + i * s, Y - 26 * s, 6 * s, 6 * s);
  cArm(g, x + 30 * s, Y - 46 * s, x + 40 * s, Y - 34 * s, 7 * s, "#9aa4ad", o, 0.5);
  g.fillStyle = "#59616b"; g.fillRect(x - 8 * s, Y - 72 * s, 16 * s, 12 * s);
  g.fillStyle = cLin(g, x, Y - 150 * s, x, Y - 70 * s, [[0, "#f4f7fa"], [1, "#c3cdd6"]]); cRR(g, x - 60 * s, Y - 150 * s, 120 * s, 82 * s, 24 * s); g.fill();
  if (o.back) {
    g.fillStyle = "#aab4be"; cRR(g, x - 44 * s, Y - 136 * s, 88 * s, 54 * s, 14 * s); g.fill();
    g.fillStyle = "#7d8893"; for (let i = 0; i < 4; i++) cRR(g, x - 30 * s, Y - 126 * s + i * 11 * s, 60 * s, 5 * s, 2.5 * s), g.fill();
  } else {
    g.fillStyle = "#132a2e"; cRR(g, x - 48 * s, Y - 139 * s, 96 * s, 60 * s, 16 * s); g.fill();
    g.fillStyle = "#3ee0d0"; g.strokeStyle = "#3ee0d0"; g.lineCap = "round";
    if (o.hurt) {
      g.lineWidth = 6 * s;
      for (const sx of [-1, 1]) { g.beginPath(); g.moveTo(x + sx * 30 * s, Y - 124 * s); g.lineTo(x + sx * 16 * s, Y - 114 * s); g.lineTo(x + sx * 30 * s, Y - 104 * s); g.stroke(); }
    } else if (o.blink) { g.fillRect(x - 30 * s, Y - 114 * s, 14 * s, 4 * s); g.fillRect(x + 16 * s, Y - 114 * s, 14 * s, 4 * s); }
    else { cRR(g, x - 30 * s, Y - 124 * s, 14 * s, 22 * s, 5 * s); g.fill(); cRR(g, x + 16 * s, Y - 124 * s, 14 * s, 22 * s, 5 * s); g.fill(); }
    g.lineWidth = 4 * s; g.beginPath();
    if (o.hurt) { g.moveTo(x - 9 * s, Y - 92 * s); g.lineTo(x + 9 * s, Y - 92 * s); } else g.arc(x, Y - 100 * s, 9 * s, 0.4, Math.PI - 0.4);
    g.stroke();
    g.fillStyle = "rgba(255,120,140,0.5)"; g.beginPath(); g.ellipse(x - 34 * s, Y - 94 * s, 7 * s, 4 * s, 0, 0, Math.PI * 2); g.ellipse(x + 34 * s, Y - 94 * s, 7 * s, 4 * s, 0, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = "#f2c230"; g.beginPath(); g.arc(x - 62 * s, Y - 110 * s, 7 * s, 0, Math.PI * 2); g.arc(x + 62 * s, Y - 110 * s, 7 * s, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#7d8893"; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(x + 20 * s, Y - 150 * s); g.lineTo(x + 28 * s, Y - 172 * s); g.stroke();
  g.fillStyle = "#3ee0d0"; g.beginPath(); g.arc(x + 29 * s, Y - 175 * s, 6 * s, 0, Math.PI * 2); g.fill();
}

function drawHelmet(g, x, y, s, o) {
  if (o.shadow) cShadow(g, x, y, 50 * s);
  const bob = o.moving ? Math.sin(o.phase * 2) * 1.5 * s : 0;
  g.fillStyle = "#2b3036"; cRR(g, x - 48 * s, y - 18 * s, 34 * s, 18 * s, 8 * s); g.fill(); cRR(g, x + 14 * s, y - 18 * s, 34 * s, 18 * s, 8 * s); g.fill();
  g.fillStyle = "#4a525b";
  const off = ((o.phase * 6) % 7 + 7) % 7;
  for (const bx of [-48, 14]) for (let i = 0; i < 5; i++) { const tx = bx + 3 + ((i * 7 + off) % 30); g.fillRect(x + tx * s, y - 14 * s, 3 * s, 10 * s); }
  const Y = y - bob;
  g.fillStyle = cRad(g, x - 18 * s, Y - 92 * s, 6 * s, x, Y - 70 * s, 64 * s, [[0, "#9fd3d6"], [1, "#4f878c"]]);
  g.beginPath(); g.ellipse(x, Y - 68 * s, 58 * s, 56 * s, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#4f878c"; g.lineWidth = 9 * s; g.lineCap = "round"; g.beginPath(); g.moveTo(x - 50 * s, Y - 60 * s); g.lineTo(x - 64 * s, Y - 40 * s); g.stroke();
  cArm(g, x + 50 * s, Y - 60 * s, x + 62 * s, Y - 44 * s, 9 * s, "#4f878c", o, 0.35);
  if (o.back) {
    g.fillStyle = "#3f6f73"; cRR(g, x - 20 * s, Y - 90 * s, 40 * s, 34 * s, 8 * s); g.fill();
    g.fillStyle = "#f2c230"; g.beginPath(); g.arc(x - 10 * s, Y - 80 * s, 3 * s, 0, Math.PI * 2); g.arc(x + 10 * s, Y - 80 * s, 3 * s, 0, Math.PI * 2); g.fill();
  } else {
    cEyes(g, x, Y - 72 * s, 20 * s, 11 * s, o);
    cBlush(g, x - 36 * s, Y - 56 * s, 8 * s); cBlush(g, x + 36 * s, Y - 56 * s, 8 * s);
    cMouth(g, x, Y - 50 * s, 10 * s, o);
  }
  const hy = o.hurt ? -8 * s : 0;
  g.fillStyle = cLin(g, x, Y - 140 * s, x, Y - 104 * s, [[0, "#ffe07a"], [1, "#e8b21f"]]);
  g.beginPath(); g.ellipse(x, Y - 108 * s + hy, 50 * s, 34 * s, 0, Math.PI, 0); g.fill();
  g.fillStyle = "#e8b21f"; cRR(g, x - 62 * s, Y - 112 * s + hy, 124 * s, 10 * s, 5 * s); g.fill();
  g.fillStyle = "#d39e12"; g.fillRect(x - 5 * s, Y - 141 * s + hy, 10 * s, 30 * s);
  if (!o.back) { g.fillStyle = "#fff6c9"; g.beginPath(); g.arc(x, Y - 128 * s + hy, 7 * s, 0, Math.PI * 2); g.fill(); }
}

function drawSpringy(g, x, y, s, o) {
  if (o.shadow) cShadow(g, x, y, 34 * s);
  const k = o.moving ? Math.abs(Math.sin(o.phase)) : 0.35 + 0.15 * Math.sin(o.t * 3);
  const len = (26 + 30 * k) * s, top = y - 10 * s - len;
  g.fillStyle = "#3a4047"; g.beginPath(); g.ellipse(x, y - 6 * s, 26 * s, 9 * s, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "#b6bec6"; g.lineWidth = 5 * s; g.lineJoin = "round"; g.beginPath();
  for (let i = 0; i <= 8; i++) g.lineTo(x + (i % 2 ? 16 : -16) * s, y - 10 * s - len * i / 8);
  g.stroke();
  const cy = top - 42 * s;
  g.fillStyle = cRad(g, x - 22 * s, cy - 24 * s, 6 * s, x, cy, 66 * s, [[0, "#c8f5e4"], [1, "#5fbf9c"]]);
  g.beginPath(); g.ellipse(x, cy, 60 * s, 52 * s, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#4aa584"; cRR(g, x - 60 * s, cy + 12 * s, 120 * s, 10 * s, 5 * s); g.fill();
  g.fillStyle = "#f2c230"; for (let i = -48; i <= 48; i += 24) { g.beginPath(); g.arc(x + i * s, cy + 17 * s, 3 * s, 0, Math.PI * 2); g.fill(); }
  if (!o.back) {
    cEyes(g, x, cy - 8 * s, 21 * s, 12 * s, o);
    cBlush(g, x - 38 * s, cy + 6 * s, 8 * s); cBlush(g, x + 38 * s, cy + 6 * s, 8 * s);
    if (o.hurt) cMouth(g, x, cy + 8 * s, 10 * s, o);
    else { g.strokeStyle = "#141619"; g.lineWidth = 2.6 * s; g.lineCap = "round"; g.beginPath(); g.arc(x - 5 * s, cy + 4 * s, 5 * s, 0.2, Math.PI - 0.2); g.moveTo(x + 10 * s, cy + 4 * s + 0.1); g.arc(x + 5 * s, cy + 4 * s, 5 * s, 0.2, Math.PI - 0.2); g.stroke(); }
  }
  cArm(g, x + 52 * s, cy + 12 * s, x + 66 * s, cy + 28 * s, 7 * s, "#5fbf9c", o, 0.4);
  g.strokeStyle = "#7d8893"; g.lineWidth = 3 * s; g.beginPath(); g.moveTo(x - 10 * s, cy - 50 * s); g.quadraticCurveTo(x - 24 * s, cy - 68 * s, x - 10 * s, cy - 78 * s); g.stroke();
  g.fillStyle = "#ff8fa3"; g.beginPath(); g.arc(x - 9 * s, cy - 80 * s, 6 * s, 0, Math.PI * 2); g.fill();
}

function drawProp(g, x, y, s, o) {
  if (o.shadow) cShadow(g, x, y, 36 * s);
  const fl = Math.sin(o.t * 3) * 5 * s;
  g.fillStyle = cRad(g, x, y - 30 * s, 2, x, y - 30 * s, 40 * s, [[0, "rgba(62,224,208,0.45)"], [1, "rgba(62,224,208,0)"]]);
  g.fillRect(x - 40 * s, y - 70 * s, 80 * s, 80 * s);
  g.save(); g.translate(x, y - 98 * s - fl); g.rotate(o.moving ? 0.14 : 0); g.translate(-x, -(y - 98 * s - fl));
  const Y = y - fl;
  g.fillStyle = "#59616b"; g.beginPath(); g.ellipse(x, Y - 52 * s, 20 * s, 8 * s, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#3ee0d0"; g.beginPath(); g.ellipse(x, Y - 50 * s, 12 * s, 4 * s, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = cRad(g, x - 20 * s, Y - 120 * s, 6 * s, x, Y - 98 * s, 64 * s, [[0, "#e4dbff"], [1, "#8f78e6"]]);
  g.beginPath(); g.arc(x, Y - 98 * s, 54 * s, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#2a2440"; cRR(g, x - 44 * s, Y - 116 * s, 88 * s, 34 * s, 17 * s); g.fill();
  if (!o.back) {
    if (o.hurt || o.blink) { cEyes(g, x, Y - 99 * s, 18 * s, 9 * s, { hurt: o.hurt, blink: o.blink }); g.strokeStyle = "#f6f2ff"; }
    else {
      g.fillStyle = "#f6f2ff"; g.beginPath(); g.ellipse(x - 18 * s, Y - 99 * s, 8 * s, 10 * s, 0, 0, Math.PI * 2); g.ellipse(x + 18 * s, Y - 99 * s, 8 * s, 10 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#2a2440"; g.beginPath(); g.arc(x - 16 * s, Y - 97 * s, 4 * s, 0, Math.PI * 2); g.arc(x + 20 * s, Y - 97 * s, 4 * s, 0, Math.PI * 2); g.fill();
    }
    cBlush(g, x - 34 * s, Y - 72 * s, 7 * s); cBlush(g, x + 34 * s, Y - 72 * s, 7 * s);
    cMouth(g, x, Y - 66 * s, 8 * s, o, "#2a2440");
  } else { g.fillStyle = "#463d6b"; g.beginPath(); g.arc(x, Y - 99 * s, 6 * s, 0, Math.PI * 2); g.fill(); }
  cArm(g, x + 48 * s, Y - 84 * s, x + 64 * s, Y - 70 * s, 7 * s, "#8f78e6", o, 0.4);
  g.fillStyle = "#59616b"; g.fillRect(x - 4 * s, Y - 168 * s, 8 * s, 18 * s);
  const spin = o.t * (o.moving ? 30 : 18), bl = 30 * s * Math.max(0.2, Math.abs(Math.cos(spin)));
  g.fillStyle = "#f2c230";
  g.beginPath(); g.ellipse(x - bl, Y - 168 * s, bl, 7 * s, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(x + bl, Y - 168 * s, bl, 7 * s, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = "rgba(242,194,48,0.35)"; g.lineWidth = 2 * s; g.beginPath(); g.ellipse(x, Y - 168 * s, 62 * s, 12 * s, 0, 0, Math.PI * 2); g.stroke();
  g.fillStyle = "#d39e12"; g.beginPath(); g.arc(x, Y - 168 * s, 7 * s, 0, Math.PI * 2); g.fill();
  g.restore();
}

function drawDrum(g, x, y, s, o) {
  if (o.shadow) cShadow(g, x, y, 46 * s);
  const w = o.moving ? Math.sin(o.phase) : 0;
  g.fillStyle = "#30353b"; g.beginPath();
  g.ellipse(x - 20 * s, y - 6 * s - Math.max(0, w) * 5 * s, 15 * s, 8 * s, 0, 0, Math.PI * 2);
  g.ellipse(x + 20 * s, y - 6 * s - Math.max(0, -w) * 5 * s, 15 * s, 8 * s, 0, 0, Math.PI * 2); g.fill();
  g.save(); g.translate(x, y); g.rotate(w * 0.12); g.translate(-x, -y);
  const bw = 46 * s, top = y - 118 * s, bot = y - 14 * s;
  g.fillStyle = cLin(g, x - bw, 0, x + bw, 0, [[0, "#ff9a5c"], [0.5, "#e0662a"], [1, "#9c3d14"]]);
  g.beginPath(); g.ellipse(x, bot, bw, 14 * s, 0, 0, Math.PI); g.lineTo(x - bw, top); g.ellipse(x, top, bw, 14 * s, 0, Math.PI, 0, true); g.closePath(); g.fill();
  g.strokeStyle = "rgba(0,0,0,0.25)"; g.lineWidth = 4 * s;
  for (const yy of [y - 46 * s, y - 86 * s]) { g.beginPath(); g.ellipse(x, yy, bw, 14 * s, 0, 0.1, Math.PI - 0.1); g.stroke(); }
  if (!o.back) { g.fillStyle = "#1b1d20"; cRR(g, x - 24 * s, y - 72 * s, 48 * s, 16 * s, 3 * s); g.fill(); g.fillStyle = "#f2c230"; g.fillRect(x - 16 * s, y - 66 * s, 32 * s, 4 * s); }
  const lift = o.back ? 0 : o.hurt ? 1.8 : 1;
  if (lift) {
    g.fillStyle = "#16181b"; g.beginPath(); g.ellipse(x, top, bw - 4 * s, 12 * s, 0, 0, Math.PI * 2); g.fill();
    if (o.hurt || o.blink) cEyes(g, x, top - 2 * s, 16 * s, 8 * s, { hurt: o.hurt, blink: o.blink });
    else {
      g.fillStyle = "#fff"; g.beginPath(); g.ellipse(x - 16 * s, top - 2 * s, 10 * s, 9 * s, 0, 0, Math.PI * 2); g.ellipse(x + 16 * s, top - 2 * s, 10 * s, 9 * s, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = "#16181b"; g.beginPath(); g.arc(x - 13 * s, top - 1 * s, 5 * s, 0, Math.PI * 2); g.arc(x + 19 * s, top - 1 * s, 5 * s, 0, Math.PI * 2); g.fill();
    }
  }
  g.save(); g.translate(x - 10 * s * lift, top - 14 * s * lift); g.rotate(-0.22 * lift);
  g.fillStyle = cLin(g, 0, -10 * s, 0, 10 * s, [[0, "#ffb07a"], [1, "#c4501d"]]); g.beginPath(); g.ellipse(10 * s * lift, 0, bw + 4 * s, 14 * s, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = "#9c3d14"; g.beginPath(); g.ellipse(10 * s * lift, 3 * s, bw + 4 * s, 11 * s, 0, 0, Math.PI); g.fill();
  g.fillStyle = "#59616b"; cRR(g, (2 + 10 * (lift - 1)) * s, -16 * s, 16 * s, 8 * s, 3 * s); g.fill();
  g.restore();
  cArm(g, x + bw - 2 * s, y - 70 * s, x + bw + 14 * s, y - 54 * s, 7 * s, "#9c3d14", o, 0.4);
  g.restore();
}

const CHARS = {
  moni:    { name: "모니", kind: "화면 얼굴", draw: drawMoni, s: 0.29, h: 52, bar: 58 },
  helmet:  { name: "안전모", kind: "공장 작업반장", draw: drawHelmet, s: 0.32, h: 46, bar: 52 },
  springy: { name: "통통이", kind: "스프링 다리", draw: drawSpringy, s: 0.29, h: 54, bar: 60 },
  prop:    { name: "팽이", kind: "프로펠러 비행", draw: drawProp, s: 0.29, h: 52, bar: 60 },
  drum:    { name: "깡통이", kind: "드럼통 몸", draw: drawDrum, s: 0.33, h: 44, bar: 54 },
};
const CHAR_ORDER = ["moni", "helmet", "springy", "prop", "drum"];
let charId = "moni";
try { const c = localStorage.getItem("b07-char"); if (CHARS[c]) charId = c; } catch (e) {}
function setChar(id) {
  if (!CHARS[id]) return;
  charId = id;
  try { localStorage.setItem("b07-char", id); } catch (e) {}
  document.querySelectorAll(".pick").forEach((b) => b.setAttribute("aria-pressed", b.dataset.id === id ? "true" : "false"));
  $("pickName").textContent = CHARS[id].name + " · " + CHARS[id].kind;
}
// 게임 속 캐릭터 그리기 (판정은 모두 같은 원)
function drawChar(id, x, y, face, opts) {
  const c = CHARS[id], fx = Math.cos(face), fy = Math.sin(face);
  const o = { ...opts, back: fy < -0.45 };
  ctx.save();
  if (fx < -0.1) { ctx.translate(x, 0); ctx.scale(-1, 1); ctx.translate(-x, 0); }
  c.draw(ctx, x, y, c.s, o);
  ctx.restore();
}
// 시작 화면 미리보기
function initPicker() {
  const box = $("picker");
  CHAR_ORDER.forEach((id) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "pick"; b.dataset.id = id; b.setAttribute("aria-label", CHARS[id].name);
    const cvs = document.createElement("canvas"); cvs.width = 140; cvs.height = 150;
    const nm = document.createElement("span"); nm.textContent = CHARS[id].name;
    b.append(cvs, nm);
    b.addEventListener("click", () => { setChar(id); sfx("choose"); });
    box.append(b);
  });
  setChar(charId);
  const loop = (now) => {
    if (!$("ovTitle").hidden) {
      document.querySelectorAll(".pick canvas").forEach((cvs) => {
        const g = cvs.getContext("2d"), id = cvs.parentElement.dataset.id, sel = id === charId;
        g.clearRect(0, 0, cvs.width, cvs.height);
        const t = now / 1000;
        CHARS[id].draw(g, 70, 140, 0.68, { t, phase: t * 9, moving: sel, shadow: true, wrench: true, weapon: weaponId, blink: (t % 3.1) < 0.12 });
      });
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// ================= 그리기 (3/4 시점) =================
const BACK_TOP = syf(RY0) - WALL_H;
const GR = {}; // 재사용하는 그라데이션
function floorEllipse(x, y, rx, ry, color) { ctx.fillStyle = color; ctx.beginPath(); ctx.ellipse(x, syf(y), rx, ry * SY, 0, 0, Math.PI * 2); ctx.fill(); }
function shadow(x, y, r, a = 0.42) { floorEllipse(x + 2, y + 3, r + 2, r * 0.75, `rgba(0,0,0,${a})`); }

function drawFloor() {
  ctx.fillStyle = "#0c0e10"; ctx.fillRect(-20, -20, W + 40, H + 40);
  const fy0 = syf(RY0), fy1 = syf(RY1);
  const z2 = curZone() === 2, z3 = curZone() >= 3;
  if (!GR.floor3) { GR.floor3 = ctx.createLinearGradient(0, fy0, 0, fy1); GR.floor3.addColorStop(0, "#9aa6ae"); GR.floor3.addColorStop(1, "#b4bec5"); }
  if (!GR.floor) { GR.floor = ctx.createLinearGradient(0, fy0, 0, fy1); GR.floor.addColorStop(0, "#15181b"); GR.floor.addColorStop(1, "#1f2327"); }
  if (!GR.floor2) { GR.floor2 = ctx.createLinearGradient(0, fy0, 0, fy1); GR.floor2.addColorStop(0, "#131a21"); GR.floor2.addColorStop(1, "#1b242d"); }
  ctx.fillStyle = z3 ? GR.floor3 : z2 ? GR.floor2 : GR.floor; ctx.fillRect(RX0, fy0, RX1 - RX0, fy1 - fy0);
  ctx.strokeStyle = z3 ? "#8b979f" : z2 ? "#1e2933" : C.tile; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = RX0; x <= RX1; x += 40) { ctx.moveTo(x + 0.5, fy0); ctx.lineTo(x + 0.5, fy1); }
  for (let y = RY0; y <= RY1; y += 40) { const sy = Math.round(syf(y)) + 0.5; ctx.moveTo(RX0, sy); ctx.lineTo(RX1, sy); }
  ctx.stroke();
  for (const d of room.decals) floorEllipse(d.x, d.y, d.r, d.r * 0.6, `rgba(0,0,0,${d.a * 1.6})`);
  drawBelts();
  ctx.strokeStyle = "rgba(0,0,0,0.55)"; ctx.lineWidth = 2;
  for (const c of room.cracks) {
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2 + c.seed, l1 = 18 + ((c.seed * 7 + i * 13) % 14), l2 = l1 + 10 + ((c.seed * 3 + i * 5) % 12);
      ctx.moveTo(c.x + Math.cos(a) * 6, syf(c.y + Math.sin(a) * 6));
      ctx.lineTo(c.x + Math.cos(a + 0.2) * l1, syf(c.y + Math.sin(a + 0.2) * l1));
      ctx.lineTo(c.x + Math.cos(a - 0.1) * l2, syf(c.y + Math.sin(a - 0.1) * l2));
    }
    ctx.stroke();
  }
  // 앞쪽 경고선
  ctx.save(); const hy0 = syf(RY1 - 10), hy1 = syf(RY1);
  ctx.beginPath(); ctx.rect(RX0, hy0, RX1 - RX0, hy1 - hy0); ctx.clip();
  ctx.fillStyle = C.hazard;
  for (let x = RX0 - 20; x < RX1 + 20; x += 20) { ctx.beginPath(); ctx.moveTo(x, hy1); ctx.lineTo(x + 10, hy1); ctx.lineTo(x + 18, hy0); ctx.lineTo(x + 8, hy0); ctx.fill(); }
  ctx.restore();
  // 벽 아래 그늘 (뒷벽이 바닥에 드리우는 그림자)
  if (!GR.wallShade) { GR.wallShade = ctx.createLinearGradient(0, fy0, 0, fy0 + 40); GR.wallShade.addColorStop(0, "rgba(0,0,0,0.55)"); GR.wallShade.addColorStop(1, "rgba(0,0,0,0)"); }
  ctx.fillStyle = GR.wallShade; ctx.fillRect(RX0, fy0, RX1 - RX0, 40);
  // 열린 출구 앞 바닥 표시
  if (room.doorOpen) {
    const pulse = (Math.sin(room.doorPulse * 6) + 1) / 2;
    for (const d of room.doors) {
      const col = d.type === "boss" || d.type === "challenge" ? "255,75,58" : "89,227,154";
      const lg = ctx.createRadialGradient(d.x, fy0, 4, d.x, fy0, 110);
      lg.addColorStop(0, `rgba(${col},${0.22 + pulse * 0.12})`); lg.addColorStop(1, `rgba(${col},0)`);
      ctx.fillStyle = lg; ctx.fillRect(d.x - 120, fy0, 240, 100);
      ctx.strokeStyle = `rgba(${col},${0.5 + pulse * 0.5})`; ctx.lineWidth = 3;
      for (let i = 0; i < 2; i++) {
        const wy = RY0 + 34 - i * 14 - (room.doorPulse * 30) % 14;
        ctx.beginPath(); ctx.moveTo(d.x - 12, syf(wy + 6)); ctx.lineTo(d.x, syf(wy - 2)); ctx.lineTo(d.x + 12, syf(wy + 6)); ctx.stroke();
      }
    }
  }
}

function drawBackWall() {
  const top = BACK_TOP, bot = syf(RY0);
  const z2 = curZone() === 2, z3 = curZone() >= 3;
  if (!GR.back3) { GR.back3 = ctx.createLinearGradient(0, top, 0, bot); GR.back3.addColorStop(0, "#c9d2d8"); GR.back3.addColorStop(1, "#8e9aa3"); }
  if (!GR.back) { GR.back = ctx.createLinearGradient(0, top, 0, bot); GR.back.addColorStop(0, "#353b42"); GR.back.addColorStop(1, "#24282d"); }
  if (!GR.back2) { GR.back2 = ctx.createLinearGradient(0, top, 0, bot); GR.back2.addColorStop(0, "#2f3c4a"); GR.back2.addColorStop(1, "#1d2630"); }
  ctx.fillStyle = z3 ? GR.back3 : z2 ? GR.back2 : GR.back; ctx.fillRect(0, top, W, bot - top);
  if (z3) { // 청록 표시선 + 검사 표시판
    ctx.fillStyle = C.visor; ctx.fillRect(RX0, top + 27, RX1 - RX0, 4);
    ctx.font = '700 10px "IBM Plex Mono", monospace'; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    for (let x = RX0 + 30; x < RX1 - 80; x += 190) { ctx.fillStyle = "#1f2a30"; ctx.fillRect(x, top + 6, 64, 16); ctx.fillStyle = room.doorOpen ? C.good : Math.floor(performance.now() / 600 + x) % 3 === 0 ? C.danger : C.good; ctx.fillText(room.doorOpen ? "PASS" : "SCAN", x + 6, top + 14.5); }
  }
  if (z2) { // 파란 작업등 띠
    ctx.fillStyle = "rgba(90,160,255,0.75)"; ctx.fillRect(RX0, top + 27, RX1 - RX0, 3);
    if (!GR.lamp2) { GR.lamp2 = ctx.createLinearGradient(0, top + 28, 0, top + 70); GR.lamp2.addColorStop(0, "rgba(90,160,255,0.18)"); GR.lamp2.addColorStop(1, "rgba(90,160,255,0)"); }
    ctx.fillStyle = GR.lamp2; ctx.fillRect(RX0, top + 28, RX1 - RX0, 42);
  }
  // 패널 이음새, 배관
  ctx.strokeStyle = "rgba(0,0,0,0.35)"; ctx.lineWidth = 2;
  ctx.beginPath(); for (let x = RX0; x < RX1; x += 80) { ctx.moveTo(x, top + 4); ctx.lineTo(x, bot - 10); } ctx.stroke();
  ctx.fillStyle = "#454c55"; ctx.fillRect(0, top + 12, W, 7);
  ctx.fillStyle = "#59616b"; ctx.fillRect(0, top + 12, W, 2);
  for (let x = RX0 + 40; x < RX1; x += 160) { ctx.fillStyle = "#2b3036"; ctx.fillRect(x - 5, top + 9, 10, 13); }
  // 경고등
  for (const lx of [RX0 + 120, RX1 - 120]) {
    const on = room.doorOpen ? true : Math.floor(performance.now() / 500) % 2 === 0;
    ctx.fillStyle = room.doorOpen ? C.good : on ? C.danger : "#4a1f1a";
    ctx.beginPath(); ctx.arc(lx, top + 34, 5, 0, Math.PI * 2); ctx.fill();
    if (on) { const lg = ctx.createRadialGradient(lx, top + 34, 2, lx, top + 34, 34); lg.addColorStop(0, room.doorOpen ? "rgba(89,227,154,0.35)" : "rgba(255,75,58,0.35)"); lg.addColorStop(1, "rgba(0,0,0,0)"); ctx.fillStyle = lg; ctx.fillRect(lx - 34, top, 68, 68); }
  }
  // 벽 아래 경고 띠
  ctx.save(); ctx.beginPath(); ctx.rect(RX0, bot - 9, RX1 - RX0, 9); ctx.clip();
  ctx.fillStyle = C.hazardDark; ctx.fillRect(RX0, bot - 9, RX1 - RX0, 9);
  ctx.fillStyle = "#b8921f";
  for (let x = RX0 - 20; x < RX1 + 20; x += 20) { ctx.beginPath(); ctx.moveTo(x, bot); ctx.lineTo(x + 10, bot); ctx.lineTo(x + 19, bot - 9); ctx.lineTo(x + 9, bot - 9); ctx.fill(); }
  ctx.restore();
  // 윗면 테두리
  ctx.fillStyle = "#40464e"; ctx.fillRect(0, top - 12, W, 12);
  ctx.fillStyle = "#4d545d"; ctx.fillRect(0, top - 12, W, 3);
  // 출구들
  for (const d of room.doors) {
    const dx = d.x - DOOR_W / 2;
    ctx.fillStyle = C.hazard; ctx.fillRect(dx - 12, top - 12, 12, bot - top + 12); ctx.fillRect(dx + DOOR_W, top - 12, 12, bot - top + 12);
    ctx.fillStyle = C.hazardDark;
    for (let y = top - 12; y < bot; y += 14) { ctx.fillRect(dx - 12, y, 12, 7); ctx.fillRect(dx + DOOR_W, y + 7, 12, 7); }
    if (room.doorOpen) {
      const dg = ctx.createLinearGradient(0, top, 0, bot);
      dg.addColorStop(0, "#020303"); dg.addColorStop(1, d.type === "boss" ? "#1d0b09" : "#0f1a14");
      ctx.fillStyle = dg; ctx.fillRect(dx, top - 12, DOOR_W, bot - top + 12);
    } else {
      ctx.fillStyle = "#3a1714"; ctx.fillRect(dx, top - 12, DOOR_W, bot - top + 12);
      ctx.fillStyle = "#57221c";
      for (let y = top - 6; y < bot - 4; y += 9) ctx.fillRect(dx + 2, y, DOOR_W - 4, 5);
      ctx.fillStyle = C.danger; ctx.fillRect(dx + DOOR_W / 2 - 10, top + 18, 20, 4);
    }
  }
}

// 보상 아이콘
function drawIcon(type, x, y, s) {
  const col = REWARD[type].color;
  ctx.save(); ctx.translate(x, y);
  ctx.fillStyle = "rgba(10,12,14,0.85)"; ctx.strokeStyle = col; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = col; ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.lineCap = "round"; ctx.lineJoin = "round";
  const k = s / 16;
  if (type === "exit") {
    ctx.beginPath(); ctx.moveTo(0, -9 * k); ctx.lineTo(8 * k, 0); ctx.lineTo(3 * k, 0); ctx.lineTo(3 * k, 8 * k); ctx.lineTo(-3 * k, 8 * k); ctx.lineTo(-3 * k, 0); ctx.lineTo(-8 * k, 0); ctx.closePath(); ctx.fill();
  } else if (type === "module") {
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; ctx.lineTo(Math.cos(a) * 9 * k, Math.sin(a) * 9 * k); } ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, 3.5 * k, 0, Math.PI * 2); ctx.fill();
  } else if (type === "challenge") {
    ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(0, 0, 8.5 * k, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -6 * k); ctx.moveTo(0, 0); ctx.lineTo(4.5 * k, 2.5 * k); ctx.stroke();
  } else if (type === "shop" || type === "scrap") {
    ctx.beginPath(); for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2, rr = (i % 2 ? 6 : 9) * k; ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); } ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(10,12,14,0.85)"; ctx.beginPath(); ctx.arc(0, 0, 3 * k, 0, Math.PI * 2); ctx.fill();
    if (type === "shop") { ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-11 * k, 12 * k); ctx.lineTo(11 * k, 12 * k); ctx.stroke(); }
  } else if (type === "heal" || type === "station") {
    ctx.fillRect(-2.5 * k, -8 * k, 5 * k, 16 * k); ctx.fillRect(-8 * k, -2.5 * k, 16 * k, 5 * k);
  } else if (type === "weapon") {
    ctx.beginPath(); ctx.moveTo(-7 * k, 7 * k); ctx.lineTo(4 * k, -4 * k); ctx.stroke();
    ctx.beginPath(); ctx.arc(6 * k, -6 * k, 4 * k, 2.4, 2.4 + Math.PI * 1.5); ctx.stroke();
  } else if (type === "chip") {
    ctx.beginPath(); ctx.moveTo(0, -8 * k); ctx.lineTo(7 * k, 0); ctx.lineTo(2.5 * k, 0); ctx.lineTo(2.5 * k, 8 * k); ctx.lineTo(-2.5 * k, 8 * k); ctx.lineTo(-2.5 * k, 0); ctx.lineTo(-7 * k, 0); ctx.closePath(); ctx.fill();
  } else if (type === "boss") {
    ctx.beginPath(); ctx.moveTo(0, -9 * k); ctx.lineTo(9 * k, 7 * k); ctx.lineTo(-9 * k, 7 * k); ctx.closePath(); ctx.stroke();
    ctx.fillRect(-1.2 * k, -3 * k, 2.4 * k, 6 * k); ctx.fillRect(-1.2 * k, 4.5 * k, 2.4 * k, 2 * k);
  }
  ctx.restore();
}
function drawDoorSigns() {
  if (!room.doorOpen) return;
  const bob = Math.sin(performance.now() / 300) * 3;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const d of room.doors) {
    const y = syf(RY0 + 26, 34) + bob;
    drawIcon(d.type, d.x, y, 16);
    ctx.font = '700 12px "IBM Plex Sans KR", sans-serif';
    ctx.fillStyle = "rgba(0,0,0,0.7)"; ctx.fillText(REWARD[d.type].name, d.x + 1, y + 27);
    ctx.fillStyle = REWARD[d.type].color; ctx.fillText(REWARD[d.type].name, d.x, y + 26);
  }
}
function drawPickup(pk) {
  const t = performance.now() / 1000, col = REWARD[pk.type].color, X = pk.x, Y = syf(pk.y);
  // 받침대
  ctx.fillStyle = "#2b3036"; ctx.beginPath(); ctx.ellipse(X, Y, 20, 9, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#3a4048"; ctx.fillRect(X - 20, Y - 8, 40, 8);
  ctx.fillStyle = "#4a515a"; ctx.beginPath(); ctx.ellipse(X, Y - 8, 20, 9, 0, 0, Math.PI * 2); ctx.fill();
  const lg = ctx.createRadialGradient(X, Y - 30, 2, X, Y - 30, 46);
  lg.addColorStop(0, col + "66"); lg.addColorStop(1, col + "00");
  ctx.fillStyle = lg; ctx.fillRect(X - 46, Y - 76, 92, 92);
  ctx.strokeStyle = col; ctx.globalAlpha = 0.5; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.ellipse(X, Y - 8, 14 + Math.sin(t * 4) * 3, 6, 0, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
  drawIcon(pk.type, X, Y - 38 + Math.sin(t * 3) * 4, 15);
}
function drawZaps() {
  ctx.save(); ctx.globalCompositeOperation = "lighter"; ctx.lineCap = "round";
  for (const z of zaps) {
    const a = z.t / 0.2;
    const x1 = z.x1, y1 = syf(z.y1, z.z1), x2 = z.x2, y2 = syf(z.y2, z.z2);
    for (const [w, c] of [[5, "rgba(177,140,255,0.5)"], [2, "#f1e9ff"]]) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.globalAlpha = a;
      ctx.beginPath(); ctx.moveTo(x1, y1);
      const n = 6;
      for (let i = 1; i < n; i++) { const k = i / n; ctx.lineTo(x1 + (x2 - x1) * k + rand(-7, 7), y1 + (y2 - y1) * k + rand(-7, 7)); }
      ctx.lineTo(x2, y2); ctx.stroke();
    }
  }
  ctx.restore();
}

function drawSideWalls() {
  const top = BACK_TOP - 12, bot = syf(RY1) + 26;
  for (const [x0, x1, edge] of [[0, RX0, RX0], [RX1, W, RX1]]) {
    ctx.fillStyle = "#2d3239"; ctx.fillRect(x0, top, x1 - x0, bot - top);
    ctx.fillStyle = "#40464e"; ctx.fillRect(edge === RX0 ? edge - 4 : edge, top, 4, bot - top);
  }
}

function drawFrontWall() {
  const y = syf(RY1);
  ctx.fillStyle = "#3a4048"; ctx.fillRect(0, y, W, 4);
  ctx.fillStyle = "#2d3239"; ctx.fillRect(0, y + 4, W, 22);
  ctx.fillStyle = "#0c0e10"; ctx.fillRect(0, y + 26, W, H - y);
}

function drawCrate(o) {
  const top = syf(o.y) - BOX_H, depth = o.h * SY, front = top + depth;
  if (room && curZone() >= 3) { // 3구역: 검사대
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.fillRect(o.x + 8, syf(o.y) + 4, o.w, depth);
    ctx.fillStyle = cLin(ctx, 0, front, 0, front + BOX_H, [[0, "#8e9aa3"], [1, "#6b7780"]]); ctx.fillRect(o.x, front, o.w, BOX_H);
    ctx.fillStyle = "#4a555e"; ctx.fillRect(o.x + 6, front + BOX_H - 6, o.w - 12, 3);
    ctx.fillStyle = "#eef2f4"; ctx.fillRect(o.x, top, o.w, depth);
    ctx.fillStyle = C.visor; ctx.fillRect(o.x + 6, top + depth / 2 - 2, o.w - 12, 4);
    ctx.strokeStyle = "#b8c3ca"; ctx.lineWidth = 2; ctx.strokeRect(o.x + 1, top + 1, o.w - 2, depth - 2);
    return;
  }
  ctx.fillStyle = "rgba(0,0,0,0.38)"; ctx.fillRect(o.x + 8, syf(o.y) + 4, o.w, depth);
  // 앞면
  const fg = ctx.createLinearGradient(0, front, 0, front + BOX_H);
  fg.addColorStop(0, "#5a4636"); fg.addColorStop(1, "#3c2e23");
  ctx.fillStyle = fg; ctx.fillRect(o.x, front, o.w, BOX_H);
  ctx.strokeStyle = C.crateLine; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(o.x, front + BOX_H / 2); ctx.lineTo(o.x + o.w, front + BOX_H / 2); ctx.stroke();
  ctx.fillStyle = "#2a2018"; ctx.fillRect(o.x + 4, front + 4, 4, 4); ctx.fillRect(o.x + o.w - 8, front + 4, 4, 4);
  // 윗면
  ctx.fillStyle = C.crateHi; ctx.fillRect(o.x, top, o.w, depth);
  ctx.strokeStyle = "#5e4835"; ctx.lineWidth = 2; ctx.strokeRect(o.x + 1, top + 1, o.w - 2, depth - 2);
  ctx.beginPath(); ctx.moveTo(o.x + 6, top + 5); ctx.lineTo(o.x + o.w - 6, top + depth - 5); ctx.moveTo(o.x + o.w - 6, top + 5); ctx.lineTo(o.x + 6, top + depth - 5); ctx.stroke();
  ctx.fillStyle = "#93735a"; ctx.fillRect(o.x, top, o.w, 2);
}

function drawRobot(x, y, face, alpha, z = 0) {
  const X = x, Y = syf(y) - z;
  ctx.globalAlpha = alpha;
  // 궤도 바퀴
  ctx.fillStyle = "#24292e"; ctx.fillRect(X - 14, Y - 9, 28, 10);
  ctx.fillStyle = "#3a4047"; for (let i = -12; i < 14; i += 6) ctx.fillRect(X + i, Y - 8, 3, 8);
  // 몸통 원통
  const bg = ctx.createLinearGradient(X - 12, 0, X + 12, 0);
  bg.addColorStop(0, "#e3eaf0"); bg.addColorStop(0.55, C.body); bg.addColorStop(1, "#7d8893");
  ctx.fillStyle = bg;
  ctx.beginPath(); ctx.ellipse(X, Y - 9, 12, 5, 0, 0, Math.PI); ctx.lineTo(X - 12, Y - 25); ctx.ellipse(X, Y - 25, 12, 5, 0, Math.PI, 0, true); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#eef3f7"; ctx.beginPath(); ctx.ellipse(X, Y - 25, 12, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.hazard; ctx.fillRect(X - 12, Y - 17, 24, 3);
  // 머리
  const fx = Math.cos(face), fy = Math.sin(face);
  const hx = X, hy = Y - 34;
  const visor = () => { ctx.fillStyle = C.visor; ctx.beginPath(); ctx.ellipse(hx + fx * 6, hy + fy * 3 + 1, 4.5 - Math.abs(fy) * 1.2, 3, 0, 0, Math.PI * 2); ctx.fill(); };
  if (fy < -0.25) visor();
  const hg = ctx.createRadialGradient(hx - 3, hy - 3, 1, hx, hy, 10);
  hg.addColorStop(0, "#ffffff"); hg.addColorStop(1, "#9aa6b1");
  ctx.fillStyle = hg; ctx.beginPath(); ctx.arc(hx, hy, 9, 0, Math.PI * 2); ctx.fill();
  if (fy >= -0.25) visor();
  // 안테나
  ctx.strokeStyle = "#7d8893"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(hx - fx * 3, hy - 8); ctx.lineTo(hx - fx * 5, hy - 16); ctx.stroke();
  ctx.fillStyle = Math.floor(performance.now() / 400) % 2 ? C.visor : "#1d6f68"; ctx.beginPath(); ctx.arc(hx - fx * 5, hy - 17, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
}

// 머리 위 체력바 (항상 표시, 가려지지 않게 맨 위에)
function drawPlayerBar() {
  const p = player;
  if (!p || p.dead || !p.st) return;
  const w = 38, h = 5, x = p.x - w / 2, y = syf(p.y) - p.z - CHARS[charId].bar - 6;
  if (p.markT > 0 && Math.floor(performance.now() / 150) % 4 !== 0) { // 불량 표식
    ctx.save(); ctx.strokeStyle = C.danger; ctx.lineWidth = 4; ctx.lineCap = "round"; const mx = p.x, my = y - 14;
    ctx.beginPath(); ctx.moveTo(mx - 7, my - 7); ctx.lineTo(mx + 7, my + 7); ctx.moveTo(mx + 7, my - 7); ctx.lineTo(mx - 7, my + 7); ctx.stroke(); ctx.restore();
  }
  const f = clamp(p.hp / p.maxHp, 0, 1), lag = clamp(p.hpLag / p.maxHp, 0, 1);
  const blink = f <= 0.3 ? 0.55 + 0.45 * Math.sin(performance.now() / 140) : 1;
  ctx.save();
  ctx.fillStyle = "rgba(8,10,12,0.8)"; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.strokeStyle = C.visor; ctx.lineWidth = 1; ctx.strokeRect(x - 1.5, y - 1.5, w + 3, h + 3);
  ctx.fillStyle = "#3a1d1a"; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "rgba(255,255,255,0.85)"; ctx.fillRect(x, y, w * lag, h);
  ctx.globalAlpha = blink; ctx.fillStyle = hpColor(f); ctx.fillRect(x, y, w * f, h);
  if (p.healGlow > 0) { ctx.globalAlpha = p.healGlow / 0.6; ctx.fillStyle = "#c9ffe0"; ctx.fillRect(x, y, w * f, h); }
  ctx.globalAlpha = 1;
  for (let i = 1; i < 4; i++) { ctx.fillStyle = "rgba(8,10,12,0.6)"; ctx.fillRect(x + (w * i) / 4, y, 1, h); }
  if (p.weapon !== "wrench") {
    const gy = y + h + 3, gf = p.weapon === "rivet" ? clamp(p.heat / 100, 0, 1) : clamp(p.fuel / 100, 0, 1);
    const hot = p.weapon === "rivet" && p.overheat > 0, dry = p.weapon === "torch" && p.fuelLock;
    ctx.fillStyle = "rgba(8,10,12,0.8)"; ctx.fillRect(x - 2, gy - 1, w + 4, 5);
    ctx.globalAlpha = hot ? 0.5 + 0.5 * Math.sin(performance.now() / 60) : 1;
    ctx.fillStyle = p.weapon === "rivet" ? (hot ? C.danger : gf > 0.7 ? "#ff6a2b" : "#ffb347") : (dry ? "#59616b" : "#7fe0ff");
    ctx.fillRect(x, gy, w * gf, 3);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawPlayer() {
  const p = player;
  for (const g of afterimages) {
    ctx.globalAlpha = g.t / 0.22 * 0.3; ctx.fillStyle = C.visor;
    ctx.beginPath(); ctx.ellipse(g.x, syf(g.y) - (g.z || 0) - 20, 12, 16, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (p.dead) return;
  const a = p.atk, Z = p.z;
  const behind = Math.sin(a.i >= 0 ? a.ang : p.face) < 0;
  const drawSwing = () => {
    if (a.i < 0) return;
    const s = a.sw;
    const prog = clamp(a.t / (s.dur * 0.65), 0, 1);
    const start = a.ang - s.half * s.dir, cur = start + 2 * s.half * s.dir * prog;
    const alpha = 1 - clamp((a.t - s.dur * 0.5) / (s.dur * 0.5), 0, 1);
    ctx.save();
    ctx.translate(p.x, syf(p.y) - 14 - Z); ctx.scale(1, SY);
    ctx.globalAlpha = 0.45 * alpha; ctx.fillStyle = s.heavy ? "#fff1a8" : s.air ? "#c9e8ff" : C.swing;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.arc(0, 0, s.reach, Math.min(start, cur), Math.max(start, cur)); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = alpha; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = s.heavy ? 6 : 4;
    ctx.beginPath(); ctx.arc(0, 0, s.reach, Math.min(start, cur), Math.max(start, cur)); ctx.stroke();
    ctx.strokeStyle = "#cfd6dc"; ctx.lineWidth = 6; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(Math.cos(cur) * 12, Math.sin(cur) * 12); ctx.lineTo(Math.cos(cur) * (s.reach - 6), Math.sin(cur) * (s.reach - 6)); ctx.stroke();
    ctx.restore();
  };
  const alpha = p.inv > 0 && Math.floor(p.inv * 20) % 2 === 0 ? 0.45 : 1;
  // 늘어남/눌림
  let sx = 1, sy = 1;
  if (p.squash > 0) { const k = p.squash / 0.14; sx = 1 + 0.25 * k; sy = 1 - 0.22 * k; }
  else if (p.air && !p.slam) { sx = 0.92; sy = 1.1; }
  if (p.slam && p.slam.phase === "dive") { sx = 0.85; sy = 1.18; }
  const X = p.x, Y = syf(p.y) - Z;
  if (behind) drawSwing();
  ctx.save(); ctx.translate(X, Y); ctx.scale(sx, sy); ctx.translate(-X, -Y);
  ctx.globalAlpha = alpha;
  drawChar(charId, X, Y, p.face, { t: performance.now() / 1000, phase: p.walk, moving: p.moving, hurt: p.inv > 0.3, weapon: p.weapon, wrench: p.weapon === "wrench" ? !p.wrench && a.i < 0 && !p.slam : !p.slam, blink: (performance.now() / 1000 % 3.4) < 0.12 });
  ctx.globalAlpha = 1;
  ctx.restore();
  ctx.strokeStyle = "#cfd6dc"; ctx.lineCap = "round";
  if (p.weapon !== "wrench" && !p.slam && (p.flashT > 0 || p.flaming)) {
    const hx = X + Math.cos(p.face) * 16, hy = Y - 16 + Math.sin(p.face) * 16 * SY;
    ctx.save(); ctx.globalCompositeOperation = "lighter";
    const rr = p.flaming ? 12 : 10 + p.flashT * 60;
    const fg = ctx.createRadialGradient(hx, hy, 1, hx, hy, rr);
    fg.addColorStop(0, p.flaming ? "rgba(190,240,255,0.9)" : "rgba(255,250,210,0.95)"); fg.addColorStop(1, "rgba(255,160,60,0)");
    ctx.fillStyle = fg; ctx.fillRect(hx - rr, hy - rr, rr * 2, rr * 2);
    ctx.restore();
  }
  if (p.slam) {
    // 내려찍기: 예비 동작은 머리 위로, 낙하 중에는 아래로
    const up = p.slam.phase === "wind";
    ctx.lineWidth = 6;
    ctx.beginPath();
    if (up) { ctx.moveTo(X + 6, Y - 40); ctx.lineTo(X + 10, Y - 68); }
    else { ctx.moveTo(X + 10, Y - 12); ctx.lineTo(X + 14, Y + 16); }
    ctx.stroke();
    ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(up ? X + 10 : X + 14, up ? Y - 70 : Y + 18, 5, 0, Math.PI * 2); ctx.fill();
  }
  if (!behind) drawSwing();
}

function drawWrench(w) {
  shadow(w.x, w.y, 8, 0.3);
  ctx.save(); ctx.translate(w.x, syf(w.y, 18)); ctx.rotate(w.spin);
  ctx.strokeStyle = "#dfe5ea"; ctx.lineWidth = 5; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(12, 0); ctx.stroke();
  ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(13, 0, 5, -2.2, 2.2); ctx.stroke();
  ctx.restore();
}

function dropZ(e) { return e.drop > 0 ? Math.pow(e.drop / 0.34, 2) * 280 : 0; }

function drawSpark(e) {
  const flash = e.flash > 0;
  const bob = e.state === "stun" ? 0 : Math.sin(performance.now() / 160 + e.x) * 2;
  const z = 14 + bob + dropZ(e);
  const jitter = e.state === "windup" ? rand(-1.5, 1.5) : 0;
  const X = e.x + jitter, Y = syf(e.y, z) + jitter;
  ctx.save(); ctx.translate(X, Y); ctx.scale(1, 0.92); ctx.rotate(e.spin);
  ctx.fillStyle = flash ? "#ffffff" : C.sparkDark;
  ctx.beginPath();
  for (let i = 0; i < 12; i++) { const r = i % 2 ? e.r - 1 : e.r + 5, a = i / 12 * Math.PI * 2; ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  ctx.closePath(); ctx.fill();
  ctx.restore();
  const bg = ctx.createRadialGradient(X - 4, Y - 4, 1, X, Y, e.r);
  bg.addColorStop(0, flash ? "#ffffff" : "#ff9a5c"); bg.addColorStop(1, flash ? "#ffffff" : C.spark);
  ctx.fillStyle = bg; ctx.beginPath(); ctx.arc(X, Y, e.r - 3, 0, Math.PI * 2); ctx.fill();
  const ea = e.state === "windup" || e.state === "charge" ? e.aim : angTo(e, player);
  ctx.fillStyle = e.state === "stun" ? "#777" : C.eye;
  ctx.beginPath(); ctx.arc(X + Math.cos(ea) * 5, Y + Math.sin(ea) * 3 + 1, 3.5, 0, Math.PI * 2); ctx.fill();
  if (e.state === "stun") {
    ctx.fillStyle = C.hazard;
    for (let i = 0; i < 3; i++) { const a = performance.now() / 200 + i * 2.1; ctx.beginPath(); ctx.arc(X + Math.cos(a) * 15, Y - 20 + Math.sin(a) * 4, 2.5, 0, Math.PI * 2); ctx.fill(); }
  }
  return z;
}

function drawTurret(e) {
  const flash = e.flash > 0, z0 = dropZ(e);
  const X = e.x, Y = syf(e.y, z0), half = 17, d = half * 2 * SY, h = 18;
  const top = Y - d / 2 - h;
  ctx.fillStyle = flash ? "#ffffff" : C.turretDark; ctx.fillRect(X - half, top + d, half * 2, h);
  ctx.fillStyle = flash ? "#ffffff" : C.turret; ctx.fillRect(X - half, top, half * 2, d);
  ctx.fillStyle = C.hazardDark;
  ctx.fillRect(X - half, top, 6, 5); ctx.fillRect(X + half - 6, top, 6, 5); ctx.fillRect(X - half, top + d - 5, 6, 5); ctx.fillRect(X + half - 6, top + d - 5, 6, 5);
  const cx = X, cy = top + d / 2 - 6;
  const ax = Math.cos(e.aim), ay = Math.sin(e.aim) * SY;
  const barrel = () => { ctx.strokeStyle = flash ? "#ffffff" : "#2e2922"; ctx.lineWidth = 8; ctx.lineCap = "butt"; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(cx + ax * 26, cy + ay * 26); ctx.stroke(); };
  if (ay < 0) barrel();
  ctx.fillStyle = flash ? "#ffffff" : "#6d604e"; ctx.beginPath(); ctx.ellipse(cx, cy + 3, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = flash ? "#ffffff" : "#9a8a70"; ctx.beginPath(); ctx.ellipse(cx, cy - 1, 11, 6, 0, 0, Math.PI * 2); ctx.fill();
  if (ay >= 0) barrel();
  const hot = e.state === "tele" || e.state === "fire";
  ctx.fillStyle = hot ? C.danger : C.eye; ctx.beginPath(); ctx.arc(cx, cy - 1, 4, 0, Math.PI * 2); ctx.fill();
  if (hot) { const lg = ctx.createRadialGradient(cx, cy, 1, cx, cy, 22); lg.addColorStop(0, "rgba(255,75,58,0.45)"); lg.addColorStop(1, "rgba(255,75,58,0)"); ctx.fillStyle = lg; ctx.fillRect(cx - 22, cy - 22, 44, 44); }
  return 36 + z0;
}

function drawEnemy(e) {
  if (e.type === "boss") { drawBoss(e); return; }
  const top = e.type === "spark" ? drawSpark(e) + 22 : e.type === "drum" ? drawBarrel(e) : e.type === "lift" ? drawLift(e) : e.type === "drone" ? drawDrone(e) : e.type === "medic" ? drawMedic(e) : e.type === "arm" ? drawArm(e) : e.type === "insp" ? drawInsp(e) : drawTurret(e) + 6;
  drawEliteTop(e, top);
  if (e.frozen > 0) {
    const X = e.x, Y = syf(e.y, e.type === "spark" ? 14 : 16);
    ctx.save(); ctx.globalAlpha = 0.55; ctx.fillStyle = "#bff3ff";
    ctx.beginPath(); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; ctx.lineTo(X + Math.cos(a) * (e.r + 6), Y + Math.sin(a) * (e.r + 4)); } ctx.closePath(); ctx.fill();
    ctx.globalAlpha = 0.9; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 1.5; ctx.stroke(); ctx.restore();
  } else if (e.chillS > 0) {
    ctx.save(); ctx.translate(e.x, syf(e.y)); ctx.scale(1, SY); ctx.strokeStyle = FAM.frost.color; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, e.r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (e.chillS / 5)); ctx.stroke(); ctx.restore();
  }
  if (e.hp < e.maxHp && e.drop <= 0) {
    const w = 30, x = e.x - w / 2, y = syf(e.y, top);
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillRect(x - 1, y - 1, w + 2, 5);
    ctx.fillStyle = C.danger; ctx.fillRect(x, y, w * Math.max(0, e.hp / e.maxHp), 3);
  }
}

function drawBolt(b) {
  if (b.kind === "scrap") {
    ctx.save(); ctx.translate(b.x, syf(b.y, 20)); ctx.rotate(b.spin);
    ctx.fillStyle = "rgba(0,0,0,0.4)"; ctx.fillRect(-8, -3, 16, 8);
    ctx.fillStyle = b.col; ctx.fillRect(-8, -4, 16, 8); ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.fillRect(-8, -4, 16, 2);
    ctx.restore(); return;
  }
  const X = b.x, Y = syf(b.y, 20), ax = Math.cos(b.ang), ay = Math.sin(b.ang) * SY;
  const ang = Math.atan2(ay, ax);
  ctx.save(); ctx.translate(X, Y); ctx.rotate(ang);
  ctx.fillStyle = "rgba(255,210,63,0.3)"; ctx.beginPath(); ctx.ellipse(0, 0, 12, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = C.bolt; ctx.beginPath(); ctx.ellipse(0, 0, 8, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// 바닥에 깔리는 예고 표시 (가독성 우선: 항상 바닥에 평평하게)
function drawFloorMarks() {
  drawPressMarks();
  drawLasers();
  drawFires();
  drawOils();
  drawBooms();
  for (const s of pending) {
    const k = (performance.now() / 120) % 1, col = s.type === "turret" || s.type === "lift" ? C.hazard : C.spark;
    ctx.save(); ctx.translate(s.x, syf(s.y)); ctx.scale(1, SY);
    ctx.strokeStyle = col; ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85; ctx.beginPath(); ctx.arc(0, 0, s.r + 6, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1 - k; ctx.beginPath(); ctx.arc(0, 0, s.r + 6 + k * 18, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  for (const e of enemies) {
    if (e.drop > 0) { const k = 1 - e.drop / 0.34; floorEllipse(e.x, e.y, e.r * (0.4 + k * 0.8), e.r * (0.4 + k * 0.8) * 0.75, `rgba(0,0,0,${0.2 + k * 0.3})`); continue; }
    if (e.type === "spark" && e.state === "windup") {
      const k = 1 - e.t / 0.55;
      ctx.save(); ctx.globalAlpha = 0.3 + k * 0.55; ctx.strokeStyle = C.danger; ctx.lineWidth = 3 + k * 7; ctx.setLineDash([12, 9]);
      ctx.beginPath(); ctx.moveTo(e.x, syf(e.y)); ctx.lineTo(e.x + Math.cos(e.aim) * 300, syf(e.y + Math.sin(e.aim) * 300)); ctx.stroke(); ctx.restore();
    }
    if (e.type === "turret" && e.state === "tele") {
      ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = C.danger; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(e.x, syf(e.y)); ctx.lineTo(e.x + Math.cos(e.aim) * 420, syf(e.y + Math.sin(e.aim) * 420)); ctx.stroke(); ctx.restore();
    }
    drawNewEnemyMarks(e);
    drawEliteMarks(e); drawInspMarks(e);
    if (drawDroneMarks(e)) continue;
    if (e.type === "boss") { drawBossMarks(e); floorEllipse(e.x + 4, e.y + 8, e.r + 14, e.r * 0.8, "rgba(0,0,0,0.5)"); continue; }
    shadow(e.x, e.y, e.r);
  }
  const p = player;
  if (!p.dead) {
    const k = clamp(1 - p.z / 140, 0.45, 1);
    shadow(p.x, p.y, p.r * k, 0.42 * k + 0.1);
    // 자동 조준 대상 표시
    const t = p.mark;
    if (t && !t.dead && !p.slam) {
      const rot = performance.now() / 300;
      const locked = p.lock && t === p.lock;
      ctx.save(); ctx.translate(t.x, syf(t.y)); ctx.scale(1, SY);
      ctx.strokeStyle = locked ? C.danger : C.visor; ctx.lineWidth = locked ? 3 : 2.5; ctx.globalAlpha = 0.9;
      const rr = t.r + (locked ? 7 : 9) + (p.weapon === "rivet" ? p.bloom * 10 : 0);
      for (let i = 0; i < 4; i++) { const a0 = (locked ? 0.4 : rot) + i * Math.PI / 2; ctx.beginPath(); ctx.arc(0, 0, rr, a0, a0 + 0.8); ctx.stroke(); }
      if (locked) { ctx.beginPath(); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2; ctx.moveTo(Math.cos(a) * (rr + 8), Math.sin(a) * (rr + 8)); ctx.lineTo(Math.cos(a) * (rr - 2), Math.sin(a) * (rr - 2)); } ctx.stroke(); }
      ctx.restore();
    }
    // 내려찍기 착지 지점
    if (p.slam) {
      const sl = p.slam, pulse = (performance.now() / 90) % 1;
      ctx.save(); ctx.translate(sl.tx, syf(sl.ty)); ctx.scale(1, SY);
      ctx.fillStyle = "rgba(242,194,48,0.14)"; ctx.beginPath(); ctx.arc(0, 0, 72, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = C.hazard; ctx.lineWidth = 2.5; ctx.setLineDash([10, 7]);
      ctx.beginPath(); ctx.arc(0, 0, 72, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1 - pulse; ctx.beginPath(); ctx.arc(0, 0, 20 + pulse * 50, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  // 충격파
  for (const w of waves) {
    const k = w.t / w.max;
    ctx.save(); ctx.translate(w.x, syf(w.y)); ctx.scale(1, SY);
    ctx.globalAlpha = 1 - k; ctx.strokeStyle = w.col || "#fff1a8"; ctx.lineWidth = 10 * (1 - k) + 2;
    const rr = w.R < 0 ? -w.R * (1 - k) + 10 : 18 + k * w.R;
    ctx.beginPath(); ctx.arc(0, 0, rr, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  for (const b of bolts) floorEllipse(b.x, b.y, 4, 3, "rgba(0,0,0,0.35)");
  for (const sh of shots) floorEllipse(sh.x, sh.y, 3, 2, "rgba(0,0,0,0.3)");
}

function playerHidden() {
  const p = player;
  if (p.dead) return false;
  const b = room.boss;
  if (b && !b.dead && !(b.drop > 0) && p.y < b.y && Math.abs(p.x - b.x) < 72 && b.y - p.y < 170) return true;
  return room.obstacles.some((o) => p.x > o.x - 12 && p.x < o.x + o.w + 12 && p.y < o.y + 2 && syf(p.y) > syf(o.y) - BOX_H - 6);
}

function cooldowns() {
  const p = player;
  return {
    dash: p.dash.charges / p.dash.max + (p.dash.charges < p.dash.max ? p.dash.regen / p.st.dashRegen / p.dash.max : 0),
    dashN: p.dash.charges,
    throw: p.wrench || (p.weapon === "rivet" && p.overheat > 0) || (p.weapon === "torch" && p.fuel < 20) ? 0 : p.specCd <= 0 ? 1 : 1 - p.specCd / p.st.throwCd,
    slam: p.slamCd <= 0 ? 1 : 1 - p.slamCd / p.st.slamCd,
  };
}
function drawDuoChip(g, x, y, w, h, duo) {
  g.fillStyle = "#101215"; g.fillRect(x, y, w, h);
  if (duo) {
    const d = DUOS[duo];
    g.fillStyle = FAM[d.fams[0]].color; g.fillRect(x + 2, y + 2, (w - 4) / 2, h - 4);
    g.fillStyle = FAM[d.fams[1]].color; g.fillRect(x + 2 + (w - 4) / 2, y + 2, (w - 4) / 2, h - 4);
    g.strokeStyle = "#f2c230"; g.lineWidth = 2; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
  }
  g.save(); g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = duo ? "#101214" : "#4a525b"; g.font = '700 11px "IBM Plex Sans KR", sans-serif';
  g.fillText("듀", x + w / 2, y + h / 2 + 0.5); g.restore();
}
function drawBattery(g, x, y, on) {
  g.save();
  g.strokeStyle = on ? C.visor : "#4a525b"; g.lineWidth = 1.5;
  g.strokeRect(x + 0.5, y + 0.5, 18, 11); g.fillStyle = on ? C.visor : "#4a525b"; g.fillRect(x + 19, y + 3.5, 2, 5);
  if (on) { g.fillRect(x + 3, y + 3, 13, 6); } else { g.beginPath(); g.moveTo(x + 4, y + 2); g.lineTo(x + 15, y + 10); g.stroke(); }
  g.restore();
}
function drawHud() {
  if (UI.mode === "panel") return;
  const p = player;
  ctx.font = '700 12px "IBM Plex Mono", "IBM Plex Sans KR", monospace'; ctx.textBaseline = "middle"; ctx.textAlign = "left";
  // 체력
  ctx.fillStyle = "rgba(10,12,14,0.75)"; ctx.fillRect(12, 8, 300, 26);
  ctx.fillStyle = C.visor; ctx.fillText("B-07", 20, 21);
  ctx.fillStyle = "#2b1a18"; ctx.fillRect(60, 14, 150, 14);
  ctx.fillStyle = "rgba(255,255,255,0.75)"; ctx.fillRect(60, 14, 150 * clamp(p.hpLag / p.maxHp, 0, 1), 14);
  ctx.fillStyle = hpColor(p.hp / p.maxHp); ctx.fillRect(60, 14, 150 * clamp(p.hp / p.maxHp, 0, 1), 14);
  ctx.fillStyle = C.text; ctx.fillText(Math.ceil(p.hp) + "/" + p.maxHp, 216, 21);
  drawBattery(ctx, 290, 14, p.battery);
  drawDuoChip(ctx, 182, 38, 30, 22, p.duo);
  ctx.textAlign = "left"; ctx.fillStyle = "rgba(10,12,14,0.75)"; ctx.fillRect(218, 38, 94, 22);
  ctx.fillStyle = "#e0bf86"; ctx.font = '700 12px "IBM Plex Sans KR", monospace'; ctx.fillText("고철 " + run.scrap, 226, 49.5);
  ctx.font = '700 12px "IBM Plex Mono", "IBM Plex Sans KR", monospace';
  // 우측 정보
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(10,12,14,0.75)"; ctx.fillRect(W - 302, 8, 290, 26);
  ctx.fillStyle = C.text;
  const waveTxt = room.doorOpen ? "출구 개방" : room.wave === 0 ? "준비" : "웨이브 " + room.wave + "/" + room.waves;
  const wt = room.kind === "boss" ? (room.doorOpen ? "출구 개방" : "보스전") : room.kind === "station" ? REWARD[specialKind()].name : room.doorOpen ? "출구 개방" : room.cleared ? "보상 획득" : room.challenge ? (room.chStarted ? "버티기 " + Math.ceil(room.chT) + "초" : "준비") : waveTxt;
  ctx.fillText(roomLabel(room.n) + " · " + wt + " · 점수 " + run.score, W - 20, 21);
  // 장착 모듈
  ctx.textAlign = "center";
  SLOT_ORDER.forEach((sl, i) => {
    const m = p.mods[sl], x = 12 + i * 34, y = 38;
    ctx.fillStyle = "rgba(10,12,14,0.75)"; ctx.fillRect(x, y, 30, 22);
    if (m) { ctx.fillStyle = FAM[MODS[m.id].fam].color; ctx.fillRect(x + 2, y + 2, 26, 18); ctx.strokeStyle = RARITY[m.r].color; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, 28, 20); }
    ctx.fillStyle = m ? "#101214" : "#4a525b"; ctx.font = '700 11px "IBM Plex Sans KR", sans-serif';
    ctx.fillText(SLOTS[sl][0], x + 15, y + 11.5);
  });
  ctx.textAlign = "left";
  ctx.textAlign = "left";
  if (touchMode) { drawTouch(); return; }
  // PC: 하단 쿨타임 막대
  const cd = cooldowns();
  ctx.fillStyle = "rgba(10,12,14,0.75)"; ctx.fillRect(12, H - 34, p.weapon === "wrench" ? 420 : 560, 26);
  ctx.fillStyle = C.muted; ctx.fillText("대시", 20, H - 21);
  for (let i = 0; i < p.dash.max; i++) {
    const x = 56 + i * 26;
    ctx.fillStyle = "#2a2f35"; ctx.fillRect(x, H - 28, 20, 14);
    if (i < p.dash.charges) { ctx.fillStyle = C.visor; ctx.fillRect(x, H - 28, 20, 14); }
    else if (i === p.dash.charges) { ctx.fillStyle = "rgba(62,224,208,0.4)"; ctx.fillRect(x, H - 28, 20 * p.dash.regen / p.st.dashRegen, 14); }
  }
  const bar = (label, x, frac, col) => {
    ctx.fillStyle = C.muted; ctx.fillText(label, x, H - 21);
    const bx = x + ctx.measureText(label).width + 8;
    ctx.fillStyle = "#2a2f35"; ctx.fillRect(bx, H - 28, 64, 14);
    ctx.fillStyle = frac >= 1 ? col : col + "66"; ctx.fillRect(bx, H - 28, 64 * frac, 14);
  };
  const bx0 = 56 + p.dash.max * 26 + 12;
  bar(WEAPONS[p.weapon].spName, bx0, cd.throw, C.hazard);
  bar("내려찍기", bx0 + 138, cd.slam, "#fff1a8");
  if (p.weapon === "rivet") bar(p.overheat > 0 ? "과열!" : "과열", bx0 + 290, p.heat / 100 - 0.0001, "#ff6a2b");
  if (p.weapon === "torch") bar(p.fuelLock ? "연료 부족" : "연료", bx0 + 290, p.fuel / 100 - 0.0001, "#7fe0ff");
  if (muted) { ctx.fillStyle = C.muted; ctx.fillText("소리 꺼짐 (M)", W - 130, H - 21); }
}

function drawTouch() {
  // 겹침 모드(패널이 들어가지 않는 화면): 게임 캔버스 위에 반투명으로
  const st = touch.stick, r = cv.getBoundingClientRect(), sc = r.width / W;
  let stick = null;
  if (st) {
    const rad = st.rad / sc, x = clamp((st.sx - r.left) / sc, 72, W * 0.5), y = clamp((st.sy - r.top) / sc, 90, H - 72);
    const dx = st.x - st.sx, dy = st.y - st.sy, l = Math.hypot(dx, dy), m = Math.min(l / sc, rad);
    stick = { x, y, r: rad, kx: l ? x + dx / l * m : x, ky: l ? y + dy / l * m : y };
  }
  const map = {};
  for (const b of ctrlButtons()) map[b.k] = { ...b, x: (b.x - r.left) / sc, y: (b.y - r.top) / sc, r: b.r / sc, label: (TB[b.k] || {}).label || (b.k === "atk" ? "공격" : "") };
  for (const [k, b] of Object.entries(arcButtons(0, 0))) map[k].label = b.label;
  drawControls(ctx, map, stick, null, true);
}

function render() {
  if (state === "ending") { drawEnding(); return; }
  ctx.save();
  if (shakeAmt > 0) ctx.translate(rand(-shakeAmt, shakeAmt), rand(-shakeAmt, shakeAmt));
  drawFloor();
  drawBackWall();
  drawSideWalls();
  if (state === "title") {
    for (const o of room.obstacles) drawCrate(o);
    drawFrontWall();
    ctx.restore();
    return;
  }
  drawFloorMarks();
  // 앞뒤 정렬: 화면 아래(앞)에 있는 것을 나중에 그림
  const list = [];
  for (const o of room.obstacles) list.push({ k: o.y + o.h, f: () => drawCrate(o) });
  for (const e of enemies) list.push({ k: e.y, f: () => drawEnemy(e) });
  if (room.wreck) list.push({ k: room.wreck.y, f: () => drawWreck(room.wreck) });
  for (const q of room.presses || []) list.push({ k: q.y + PRESS.r, f: () => drawPress(q) });
  for (const bm of booms) if (bm.t > 0.02) list.push({ k: bm.y, f: () => drawBarrel({ x: bm.x, y: bm.y, state: "fuse", t: 0.1, flash: 0, drop: 0, roll: 0 }) });
  list.push({ k: player.y, f: drawPlayer });
  if (player.wrench) list.push({ k: player.wrench.y, f: () => drawWrench(player.wrench) });
  if (room.pickup) list.push({ k: room.pickup.y, f: () => drawPickup(room.pickup) });
  for (const b of bolts) list.push({ k: b.y, f: () => drawBolt(b) });
  for (const sh of shots) list.push({ k: sh.y, f: () => drawShot(sh) });
  for (const hd of healDrops) list.push({ k: hd.y, f: () => drawDrop(hd) });
  list.sort((a, b) => a.k - b.k);
  for (const it of list) it.f();
  // 상자 뒤에 가려진 로봇 윤곽
  if (playerHidden()) {
    const X = player.x, Y = syf(player.y);
    ctx.save(); ctx.globalAlpha = 0.75; ctx.strokeStyle = C.visor; ctx.lineWidth = 2; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.ellipse(X, Y - 18, 13, 10, 0, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.arc(X, Y - 34, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  drawBeams();
  drawZaps();
  drawDoorSigns();
  // 파티클
  for (const q of particles) {
    const a = clamp(q.life / q.max, 0, 1), X = q.x, Y = syf(q.y, q.z || 0);
    ctx.globalAlpha = a; ctx.fillStyle = q.color;
    if (q.square) { ctx.save(); ctx.translate(X, Y); ctx.rotate(q.rot); ctx.fillRect(-q.size / 2, -q.size / 2, q.size, q.size); ctx.restore(); }
    else if (!q.glow) { ctx.beginPath(); ctx.ellipse(X, Y, q.size * (1.4 - a * 0.4), q.size * 0.7, 0, 0, Math.PI * 2); ctx.fill(); }
    else { ctx.globalCompositeOperation = "lighter"; ctx.beginPath(); ctx.arc(X, Y, q.size * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fill(); ctx.globalCompositeOperation = "source-over"; }
  }
  ctx.globalAlpha = 1;
  drawFrontWall();
  drawPlayerBar();
  // 숫자
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const t of texts) {
    const X = t.x, Y = syf(t.y, t.z);
    ctx.globalAlpha = clamp(t.t / 0.4, 0, 1);
    ctx.font = (t.big ? "700 18px" : "600 13px") + ' "IBM Plex Mono", "IBM Plex Sans KR", monospace';
    ctx.fillStyle = "rgba(0,0,0,0.6)"; ctx.fillText(t.str, X + 1, Y + 1);
    ctx.fillStyle = t.color; ctx.fillText(t.str, X, Y);
  }
  ctx.globalAlpha = 1;
  ctx.restore();

  // 조명: 가장자리 어둡게
  if (!GR.vig) { GR.vig = ctx.createRadialGradient(W / 2, H * 0.55, H * 0.35, W / 2, H * 0.55, H * 0.85); GR.vig.addColorStop(0, "rgba(0,0,0,0)"); GR.vig.addColorStop(1, "rgba(0,0,0,0.45)"); }
  ctx.fillStyle = GR.vig; ctx.fillRect(0, 0, W, H);
  // 피격 비네트
  if (hurtFlash > 0) {
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, H * 0.8);
    g.addColorStop(0, "rgba(255,40,30,0)"); g.addColorStop(1, `rgba(255,40,30,${0.45 * hurtFlash})`);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  // 배너
  if (banner) {
    const a = clamp(banner.t / 0.4, 0, 1) * clamp((2.4 - banner.t) / 0.2, 0, 1);
    ctx.globalAlpha = a; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    if (curZone() >= 3) { const bg = ctx.createLinearGradient(0, 0, W, 0); bg.addColorStop(0, "rgba(10,12,14,0)"); bg.addColorStop(0.2, "rgba(10,12,14,0.6)"); bg.addColorStop(0.8, "rgba(10,12,14,0.6)"); bg.addColorStop(1, "rgba(10,12,14,0)"); ctx.fillStyle = bg; ctx.fillRect(0, 168, W, banner.sub ? 88 : 64); }
    ctx.font = '400 40px "Black Han Sans", "IBM Plex Sans KR", sans-serif';
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillText(banner.title, W / 2 + 2, 200 + 2);
    ctx.fillStyle = C.hazard; ctx.fillText(banner.title, W / 2, 200);
    if (banner.sub) { ctx.font = '500 16px "IBM Plex Sans KR", sans-serif'; ctx.fillStyle = C.text; ctx.fillText(banner.sub, W / 2, 238); }
    ctx.globalAlpha = 1;
  }
  drawBossBar();
  if (room.boss && room.boss.kind === "qc9" && !room.boss.dead) drawQCOverlay(room.boss);
  if (room.challenge && room.chStarted && !room.cleared) {
    const left = Math.max(0, room.chT), urgent = left < 5;
    ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = '700 34px "IBM Plex Mono", monospace';
    ctx.fillStyle = "rgba(0,0,0,0.55)"; ctx.fillText(left.toFixed(1), W / 2 + 2, 152);
    ctx.fillStyle = urgent ? C.good : C.danger; ctx.fillText(left.toFixed(1), W / 2, 150);
    ctx.font = '600 12px "IBM Plex Sans KR", sans-serif'; ctx.fillStyle = C.text; ctx.fillText("긴급 생산 라인 · 버티기", W / 2, 176);
    ctx.restore();
  }
  drawHud();
}

// ================= 루프 =================
const STEP = 1 / 60;
let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000); last = now;
  if (state === "play" || state === "dead") {
    acc += dt;
    while (acc >= STEP) {
      acc -= STEP;
      if (hitstop > 0) { hitstop -= STEP; continue; }
      if (state === "play" || state === "dead") update(STEP);
    }
  } else { acc = 0; if (state === "ending") updateEnding(dt); }
  musicUpdate();
  layoutUI();
  render();
  drawPanels();
  document.body.classList.toggle("playing", state === "play");
  requestAnimationFrame(frame);
}

room = genRoom(1, "module");
player = newPlayer(); recalcStats(); enemies = []; bolts = []; pending = []; particles = []; texts = []; afterimages = []; run = { score: 0, kills: 0, time: 0, scrap: 0 };
fitCanvas();
requestAnimationFrame(frame);

matchMedia("(orientation: portrait)").addEventListener("change", (e) => { if (e.matches && touchMode && state === "play") pause(); });
$("btnStart").addEventListener("click", () => { if (touchMode && canFS() && !isFS()) enterFS(); startRun(); });
$("btnFS").addEventListener("click", toggleFS);
{
  const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const canLock = !iOS && canFS() && !!(screen.orientation && screen.orientation.lock);
  if (canLock) $("btnRotFS").hidden = false;
  else { $("rotHint").hidden = false; $("rotHint").textContent = iOS && !isStandalone() ? "아이폰은 폰을 직접 가로로 돌려주세요. 공유 버튼 → 홈 화면에 추가로 열면 주소창 없이 즐길 수 있어요." : "폰을 가로로 돌리면 바로 이어져요."; }
  $("btnRotFS").addEventListener("click", () => { initAudio(); enterFS(); });
}
syncFSButton();
const retry = () => (run && run.test === "b3" ? startBoss3Test() : run && run.test === "z3" ? startZone3Test() : run && run.test === "z2" ? startZone2Test() : run && run.test === "b2" ? startBoss2Test() : run && run.test ? startBossTest() : startRun());
$("btnBoss3").addEventListener("click", () => { if (touchMode && canFS() && !isFS()) enterFS(); startBoss3Test(); });
$("btnZ3").addEventListener("click", () => { if (touchMode && canFS() && !isFS()) enterFS(); startZone3Test(); });
$("btnBoss2").addEventListener("click", () => { if (touchMode && canFS() && !isFS()) enterFS(); startBoss2Test(); });
$("btnRetry").addEventListener("click", retry);
$("btnZ2").addEventListener("click", () => { if (touchMode && canFS() && !isFS()) enterFS(); startZone2Test(); });
$("btnBoss").addEventListener("click", () => { if (touchMode && canFS() && !isFS()) enterFS(); startBossTest(); });
$("btnChar").addEventListener("click", goHome);
initPicker();
initWeaponPicker();
$("btnResume").addEventListener("click", resume);
$("btnLeave").addEventListener("click", () => { if (state === "choice" && room.shopActive) { sfx("choose"); closeShop(); } });
$("btnReroll").addEventListener("click", () => { if (state === "choice" && room.shopActive && run.scrap >= PRICE.reroll) { run.scrap -= PRICE.reroll; shopRerolls++; buildShop(); sfx("pickup"); openShop(); } });
$("btnHome").addEventListener("click", goHome);
$("btnRank").addEventListener("click", lbOpen);
$("btnRank2").addEventListener("click", lbOpen);
$("btnRankClose").addEventListener("click", lbClose);
$("lbSubmit").addEventListener("click", lbSubmit);
// 설정 (일시정지 화면): 효과음·배경음 볼륨, 진동
{
  const sv = $("setSfx"), mv = $("setMus"), vb = $("setVib");
  sv.value = Math.round(SET.sfx * 100); mv.value = Math.round(SET.mus * 100); vb.checked = SET.vib;
  sv.addEventListener("input", () => { SET.sfx = sv.value / 100; saveSettings(); applyVolumes(); });
  sv.addEventListener("change", () => sfx("hit"));
  mv.addEventListener("input", () => { SET.mus = mv.value / 100; saveSettings(); applyVolumes(); });
  vb.addEventListener("change", () => { SET.vib = vb.checked; saveSettings(); if (SET.vib) buzz(30); });
}
// 숨은 개발자 메뉴: 시작 화면의 버전 글자를 2초 안에 5번 누르면 테스트 버튼이 나타나요
{
  let taps = 0, last = 0;
  $("verTag").addEventListener("click", () => {
    const now = performance.now(); taps = now - last < 2000 ? taps + 1 : 1; last = now;
    if (taps >= 5) { taps = 0; const row = $("testRow"); row.hidden = !row.hidden; sfx("choose"); }
  });
}
// 결과 복사
$("btnShare").addEventListener("click", async () => {
  const r = run, fin = r && r.won && curZone() >= ZONES;
  const where = fin ? "공장 탈출 성공!" : roomLabel(room.n) + " 도달";
  const url = /^https?:/.test(location.href) && !/claude\.ai/.test(location.href) ? "\n" + location.href.split("#")[0].split("?")[0] : "";
  const text = `RoboEscape ${GAME_VER} · ${where}\n점수 ${r.score} · 처치 ${r.kills} · ${lbFmtTime(r.time)} · ${CHARS[r.char].name}/${WEAPONS[r.weapon].name}${url}`;
  let ok = false;
  try { await navigator.clipboard.writeText(text); ok = true; } catch (e) {
    try { const ta = document.createElement("textarea"); ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select(); ok = document.execCommand("copy"); ta.remove(); } catch (e2) {}
  }
  const b = $("btnShare"); b.textContent = ok ? "복사했어요" : "복사 실패"; if (ok) sfx("copy"); setTimeout(() => (b.textContent = "결과 복사"), 1500);
});
})();
