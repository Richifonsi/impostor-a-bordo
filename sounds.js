/* Efectos de Impostor a Bordo, sintetizados con Web Audio API (sin archivos).
   El AudioContext solo se crea tras un gesto (clic, toque o tecla) y se
   reanuda en cada gesto, también en móvil. El silencio, el volumen y la
   música quedan en localStorage (ib-muted, ib-volume, ib-music). */
(function (root) {
  "use strict";

  var MUTE_KEY = "ib-muted";
  var ORDER = ["kill", "task", "meeting", "vote", "crew", "impostor"];

  function snapshot(s) {
    var src = s && typeof s === "object" ? s : {};
    var me = src.me && typeof src.me === "object" ? src.me : null;
    var progress = src.progress && src.progress.length ? src.progress : [0, 0];
    var bodies = [];
    if (me && me.bodies && me.bodies.length) {
      for (var i = 0; i < me.bodies.length; i++) bodies.push(String(me.bodies[i]));
    }
    var log = [];
    if (src.log && src.log.length) {
      for (var j = 0; j < src.log.length; j++) log.push(String(src.log[j]));
    }
    return {
      phase: src.phase ? String(src.phase) : "",
      winner: src.winner ? String(src.winner) : "",
      done: Number(progress[0]) || 0,
      log: log,
      alive: me ? me.alive === true : null,
      room: me && me.room ? String(me.room) : null,
      bodies: bodies,
      name: me && me.name ? String(me.name) : ""
    };
  }

  function lastIndexOfSub(hay, needle) {
    if (!needle.length || hay.length < needle.length) return -1;
    outer: for (var i = hay.length - needle.length; i >= 0; i--) {
      for (var j = 0; j < needle.length; j++) {
        if (hay[i + j] !== needle[j]) continue outer;
      }
      return i;
    }
    return -1;
  }

  function addedLines(prev, next) {
    if (!prev.length || !next.length) return [];
    var max = prev.length < next.length ? prev.length : next.length;
    for (var len = max; len > 0; len--) {
      var slice = prev.slice(prev.length - len);
      var at = lastIndexOfSub(next, slice);
      if (at !== -1) return next.slice(at + len);
    }
    return [];
  }

  function isChat(line) {
    return line.indexOf("💬") === 0 || line.indexOf("👻") === 0;
  }

  function isSkipLine(line) {
    return line.indexOf("Nadie fue expulsado") === 0;
  }

  function isEjectLine(line) {
    return line.indexOf(" fue expulsado al espacio") !== -1 && !isSkipLine(line);
  }

  function diffEvents(prevState, nextState) {
    if (!prevState || !nextState) return [];
    return diffSnaps(snapshot(prevState), snapshot(nextState));
  }

  function diffSnaps(prev, next) {
    if (next.phase === "lobby" && prev.phase && prev.phase !== "lobby") return [];
    var events = [];
    var lines = addedLines(prev.log, next.log);
    var system = [];
    for (var i = 0; i < lines.length; i++) {
      if (!isChat(lines[i])) system.push(lines[i]);
    }

    if (prev.phase === "play" && next.phase === "meeting") events.push({ id: "meeting" });

    var ejected = false;
    var skipped = false;
    var selfEjected = false;
    for (var k = 0; k < system.length; k++) {
      if (isSkipLine(system[k])) skipped = true;
      else if (isEjectLine(system[k])) {
        ejected = true;
        if (next.name && system[k].indexOf(next.name + " fue expulsado") === 0) selfEjected = true;
      }
    }
    if (ejected) events.push({ id: "vote", ejected: true });
    else if (skipped) events.push({ id: "vote", ejected: false });

    var died = prev.alive === true && next.alive === false && !selfEjected && prev.phase === "play";
    var witnessed = false;
    if (prev.phase === "play" && prev.room && prev.room === next.room) {
      var seen = {};
      for (var b = 0; b < prev.bodies.length; b++) seen[prev.bodies[b]] = true;
      for (var n = 0; n < next.bodies.length; n++) {
        if (!seen[next.bodies[n]]) witnessed = true;
      }
    }
    if (died || witnessed) events.push({ id: "kill" });

    if (next.done > prev.done && next.phase !== "lobby") events.push({ id: "task" });

    if (next.phase === "end" && prev.phase !== "end") {
      if (next.winner.indexOf("Ganan los tripulantes") !== -1) events.push({ id: "crew" });
      else if (next.winner.indexOf("Gana el impostor") !== -1) events.push({ id: "impostor" });
    }
    return events;
  }

  function ramp(param, t, peak, attack, dur) {
    var a = attack > 0 ? attack : 0.01;
    if (a > dur * 0.45) a = dur * 0.45;
    if (a < 0.005) a = 0.005;
    param.setValueAtTime(0.0001, t);
    param.exponentialRampToValueAtTime(peak > 0.0001 ? peak : 0.0001, t + a);
    param.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  function osc(ctx, dest, type, freq, t, dur, peak, slideTo) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    o.connect(g);
    g.connect(dest);
    ramp(g.gain, t, peak, 0.02, dur);
    o.start(t);
    o.stop(t + dur + 0.03);
  }

  function burst(ctx, dest, t, dur, peak, opts) {
    var frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buffer.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buffer;
    var filter = ctx.createBiquadFilter();
    filter.type = opts.type || "lowpass";
    filter.frequency.setValueAtTime(opts.from, t);
    if (opts.to) filter.frequency.exponentialRampToValueAtTime(opts.to, t + dur);
    filter.Q.setValueAtTime(opts.q || 0.7, t);
    var g = ctx.createGain();
    src.connect(filter);
    filter.connect(g);
    g.connect(dest);
    ramp(g.gain, t, peak, 0.01, dur);
    src.start(t);
    src.stop(t + dur + 0.03);
  }

  function playMeeting(ctx, dest, t) {
    osc(ctx, dest, "sawtooth", 146.83, t, 1.15, 0.08, 123.47);
    var notes = [493.88, 369.99];
    var end = t;
    for (var i = 0; i < 6; i++) {
      var start = t + i * 0.18;
      osc(ctx, dest, "square", notes[i % 2], start, 0.14, 0.2);
      end = start + 0.16;
    }
    return end;
  }

  function playKill(ctx, dest, t) {
    burst(ctx, dest, t, 0.09, 0.28, { type: "highpass", from: 2200, to: 500, q: 0.6 });
    osc(ctx, dest, "sine", 246.94, t, 0.3, 0.3, 55);
    osc(ctx, dest, "triangle", 349.23, t + 0.01, 0.16, 0.12, 73.42);
    return t + 0.34;
  }

  function playTask(ctx, dest, t) {
    osc(ctx, dest, "sine", 783.99, t, 0.12, 0.24);
    osc(ctx, dest, "sine", 1174.66, t + 0.09, 0.18, 0.2);
    osc(ctx, dest, "triangle", 1567.98, t + 0.16, 0.14, 0.1);
    return t + 0.32;
  }

  function playCrew(ctx, dest, t) {
    var arp = [523.25, 659.25, 783.99, 1046.5];
    for (var i = 0; i < arp.length; i++) osc(ctx, dest, "triangle", arp[i], t + i * 0.11, 0.26, 0.16);
    var chord = t + 0.46;
    for (var c = 0; c < arp.length; c++) osc(ctx, dest, "sine", arp[c], chord, 0.62, 0.07);
    return chord + 0.66;
  }

  function playImpostor(ctx, dest, t) {
    osc(ctx, dest, "sawtooth", 110, t, 1.3, 0.11, 55);
    osc(ctx, dest, "square", 155.56, t + 0.12, 1.05, 0.05, 77.78);
    osc(ctx, dest, "sine", 207.65, t + 0.35, 0.7, 0.09, 82.41);
    burst(ctx, dest, t, 0.35, 0.12, { type: "lowpass", from: 480, to: 90, q: 1.4 });
    return t + 1.35;
  }

  function playVote(ctx, dest, t, ejected) {
    if (!ejected) {
      burst(ctx, dest, t, 0.07, 0.16, { type: "highpass", from: 1600, to: 2800, q: 0.5 });
      osc(ctx, dest, "square", 659.25, t + 0.02, 0.09, 0.1);
      osc(ctx, dest, "square", 493.88, t + 0.14, 0.16, 0.1);
      return t + 0.34;
    }
    burst(ctx, dest, t, 0.42, 0.22, { type: "bandpass", from: 280, to: 2600, q: 0.85 });
    osc(ctx, dest, "sine", 880, t + 0.16, 0.52, 0.15, 196);
    osc(ctx, dest, "sine", 98, t + 0.46, 0.28, 0.24, 42);
    return t + 0.82;
  }

  function schedule(ctx, dest, events, t0) {
    var sorted = events.slice().sort(function (a, b) {
      return ORDER.indexOf(a.id) - ORDER.indexOf(b.id);
    });
    var t = t0 || 0;
    for (var i = 0; i < sorted.length; i++) {
      var ev = sorted[i];
      if (ev.id === "meeting") t = playMeeting(ctx, dest, t);
      else if (ev.id === "kill") t = playKill(ctx, dest, t);
      else if (ev.id === "task") t = playTask(ctx, dest, t);
      else if (ev.id === "vote") t = playVote(ctx, dest, t, ev.ejected !== false);
      else if (ev.id === "crew") t = playCrew(ctx, dest, t);
      else if (ev.id === "impostor") t = playImpostor(ctx, dest, t);
      t += 0.04;
    }
    return t;
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { diffEvents: diffEvents, schedule: schedule, snapshot: snapshot };
  }
  if (typeof document === "undefined") return;

  var ctx = null;
  var master = null;
  var musicBus = null;
  var last = null;
  var muted = false;
  var unlocked = false;
  var volume = 80;
  var musicOn = false;
  var musicTimer = null;
  var musicLive = [];
  var nextNote = 0;
  var chordStep = 0;
  var VOL_KEY = "ib-volume";
  var MUSIC_KEY = "ib-music";
  var CAFE = [
    [130.81, 164.81, 196.00, 246.94],
    [110.00, 130.81, 164.81, 196.00],
    [174.61, 220.00, 261.63, 329.63],
    [98.00, 123.47, 146.83, 174.61]
  ];
  var CHORD = 3.6;

  function readMuted() {
    try { return localStorage.getItem(MUTE_KEY) === "1"; }
    catch (e) { return false; }
  }
  function writeMuted(v) {
    try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); }
    catch (e) {}
  }
  function clampVolume(v) {
    var n = parseInt(v, 10);
    if (isNaN(n)) return 80;
    if (n < 0) return 0;
    if (n > 100) return 100;
    return n;
  }
  function readVolume() {
    try {
      var raw = localStorage.getItem(VOL_KEY);
      if (raw == null || raw === "") return 80;
      return clampVolume(raw);
    } catch (e) { return 80; }
  }
  function writeVolume(v) {
    try { localStorage.setItem(VOL_KEY, String(v)); }
    catch (e) {}
  }
  function readMusic() {
    try { return localStorage.getItem(MUSIC_KEY) === "1"; }
    catch (e) { return false; }
  }
  function writeMusic(v) {
    try { localStorage.setItem(MUSIC_KEY, v ? "1" : "0"); }
    catch (e) {}
  }
  muted = readMuted();
  volume = readVolume();
  musicOn = readMusic();

  function level() {
    if (muted || volume <= 0) return 0;
    return volume / 100;
  }

  function applyGain() {
    if (!master || !ctx) return;
    var now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(level(), now);
  }

  function ensure() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return null;
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.setValueAtTime(level(), ctx.currentTime);
      master.connect(ctx.destination);
      musicBus = ctx.createGain();
      musicBus.gain.setValueAtTime(0.6, ctx.currentTime);
      musicBus.connect(master);
    }
    return ctx;
  }

  /* Un búfer en silencio dentro del gesto desbloquea Safari/iOS, donde
     resume() a veces no basta y el contexto vuelve a suspended. */
  function kick(c) {
    try {
      var frames = Math.max(1, Math.floor(c.sampleRate * 0.05));
      var buf = c.createBuffer(1, frames, c.sampleRate);
      var src = c.createBufferSource();
      src.buffer = buf;
      src.connect(c.destination);
      src.start(0);
    } catch (e) {}
  }

  function unlock() {
    var c = ensure();
    if (!c) return;
    var pending = c.resume();
    if (pending && pending.catch) pending.catch(function () {});
    if (!unlocked || c.state !== "running") kick(c);
    unlocked = true;
    if (musicOn) armMusic();
  }

  function onGesture() { unlock(); }

  function emit(id) {
    if (root.__IB_SOUND_TEST__) {
      if (!root.__IB_SOUND_LOG__) root.__IB_SOUND_LOG__ = [];
      root.__IB_SOUND_LOG__.push(id);
    }
  }

  function playAll(events) {
    if (!events.length || muted || volume <= 0 || !unlocked || !ctx) return;
    try {
      if (ctx.state !== "running") {
        var pending = ctx.resume();
        if (pending && pending.catch) pending.catch(function () {});
      }
      /* Se programa aunque el contexto aún esté suspended: si resume()
         termina un instante después, el sonido no se pierde. */
      schedule(ctx, master, events, ctx.currentTime + 0.02);
      for (var i = 0; i < events.length; i++) {
        var ev = events[i];
        emit(ev.id === "vote" && ev.ejected === false ? "vote-skip" : ev.id);
      }
    } catch (e) {}
  }

  function trackNode(node, end) {
    musicLive.push({ node: node, end: end });
    if (musicLive.length < 40) return;
    var now = ctx.currentTime;
    var keep = [];
    for (var i = 0; i < musicLive.length; i++) {
      if (musicLive[i].end > now - 0.2) keep.push(musicLive[i]);
    }
    musicLive = keep;
  }

  function softPad(freq, t, dur, peak) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(freq, t);
    o.connect(g);
    g.connect(musicBus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.start(t);
    o.stop(t + dur + 0.05);
    trackNode(o, t + dur + 0.05);
  }

  function roomBed(t, dur) {
    var frames = Math.max(1, Math.floor(ctx.sampleRate * dur));
    var buf = ctx.createBuffer(1, frames, ctx.sampleRate);
    var data = buf.getChannelData(0);
    for (var i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(700, t);
    filter.Q.setValueAtTime(0.6, t);
    var g = ctx.createGain();
    src.connect(filter);
    filter.connect(g);
    g.connect(musicBus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.02, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.start(t);
    src.stop(t + dur + 0.05);
    trackNode(src, t + dur + 0.05);
  }

  function cupTick(t) {
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(1318.5, t);
    o.frequency.exponentialRampToValueAtTime(880, t + 0.12);
    o.connect(g);
    g.connect(musicBus);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.035, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
    o.start(t);
    o.stop(t + 0.16);
    trackNode(o, t + 0.16);
  }

  function pumpMusic() {
    if (!ctx || !musicOn || !musicBus) return;
    var horizon = ctx.currentTime + 1.4;
    if (!nextNote || nextNote < ctx.currentTime) nextNote = ctx.currentTime + 0.06;
    while (nextNote < horizon) {
      var chord = CAFE[chordStep % CAFE.length];
      chordStep += 1;
      for (var i = 0; i < chord.length; i++) softPad(chord[i], nextNote, CHORD + 0.45, 0.05);
      roomBed(nextNote, CHORD + 0.3);
      cupTick(nextNote + 1.6);
      nextNote += CHORD;
    }
  }

  function armMusic() {
    if (!ctx || !musicOn || musicTimer) return;
    nextNote = 0;
    musicTimer = setInterval(pumpMusic, 250);
    pumpMusic();
  }

  function stopMusic() {
    if (musicTimer) {
      clearInterval(musicTimer);
      musicTimer = null;
    }
    for (var i = 0; i < musicLive.length; i++) {
      try { musicLive[i].node.stop(); } catch (e) {}
    }
    musicLive = [];
    nextNote = 0;
  }

  function fingerprint(snap) {
    return JSON.stringify(snap);
  }

  function sync(state) {
    try {
      if (!state || typeof state !== "object" || state.error) return;
      var snap = snapshot(state);
      if (!last) {
        last = snap;
        return;
      }
      if (fingerprint(last) === fingerprint(snap)) return;
      var events = diffSnaps(last, snap);
      last = snap;
      if (events.length) playAll(events);
    } catch (e) {}
  }

  function muteLabel() {
    return muted ? "🔇 Silencio" : "🔊 Sonido";
  }
  function musicLabel() {
    return musicOn ? "🎵 Café" : "🎵 Música";
  }

  function paintControls() {
    var btn = document.getElementById("ib-mute");
    var music = document.getElementById("ib-music");
    var range = document.getElementById("ib-volume");
    var num = document.getElementById("ib-volume-n");
    if (btn) {
      btn.textContent = muteLabel();
      btn.title = muted ? "Activar sonido" : "Silenciar";
      btn.setAttribute("aria-label", btn.title);
      btn.setAttribute("aria-pressed", muted ? "true" : "false");
    }
    if (music) {
      music.textContent = musicLabel();
      music.title = musicOn ? "Quitar la música de fondo" : "Poner música de cafetería";
      music.setAttribute("aria-label", music.title);
      music.setAttribute("aria-pressed", musicOn ? "true" : "false");
    }
    if (range && String(range.value) !== String(volume)) range.value = String(volume);
    if (num) num.textContent = String(volume);
  }

  function mount() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", mount);
      return;
    }
    if (document.getElementById("ib-audio")) {
      paintControls();
      return;
    }
    if (!document.getElementById("ib-audio-style")) {
      var style = document.createElement("style");
      style.id = "ib-audio-style";
      style.textContent = "#ib-audio{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin:10px 0 0;padding:8px 10px;border-radius:16px}#ib-audio button{margin:0}#ib-vol{display:inline-flex;align-items:center;gap:8px;margin:0;padding:6px 10px;font-size:13px;font-weight:700}#ib-volume{width:96px;margin:0;accent-color:var(--amber-deep,#b8752a)}#ib-volume-n{min-width:1.6em;text-align:right}";
      document.head.appendChild(style);
    }
    var box = document.createElement("div");
    box.id = "ib-audio";
    box.className = "glass";
    box.setAttribute("role", "group");
    box.setAttribute("aria-label", "Sonido");

    var btn = document.createElement("button");
    btn.id = "ib-mute";
    btn.type = "button";
    btn.className = "chip";
    btn.addEventListener("click", function () {
      muted = !muted;
      writeMuted(muted);
      applyGain();
      paintControls();
    });

    var vol = document.createElement("label");
    vol.id = "ib-vol";
    vol.className = "glass-inset";
    vol.setAttribute("for", "ib-volume");
    var volName = document.createElement("span");
    volName.textContent = "Volumen";
    var range = document.createElement("input");
    range.id = "ib-volume";
    range.type = "range";
    range.min = "0";
    range.max = "100";
    range.step = "1";
    range.value = String(volume);
    range.setAttribute("aria-label", "Volumen");
    range.addEventListener("input", function () {
      volume = clampVolume(range.value);
      writeVolume(volume);
      applyGain();
      paintControls();
    });
    var num = document.createElement("span");
    num.id = "ib-volume-n";
    vol.appendChild(volName);
    vol.appendChild(range);
    vol.appendChild(num);

    var music = document.createElement("button");
    music.id = "ib-music";
    music.type = "button";
    music.className = "chip";
    music.addEventListener("click", function () {
      musicOn = !musicOn;
      writeMusic(musicOn);
      if (musicOn) armMusic();
      else stopMusic();
      paintControls();
    });

    box.appendChild(btn);
    box.appendChild(vol);
    box.appendChild(music);

    var bar = document.querySelector(".bar");
    if (bar && bar.parentElement) bar.insertAdjacentElement("afterend", box);
    else document.body.appendChild(box);
    paintControls();
  }

  document.addEventListener("pointerdown", onGesture, true);
  document.addEventListener("pointerup", onGesture, true);
  document.addEventListener("click", onGesture, true);
  document.addEventListener("keydown", onGesture, true);
  document.addEventListener("touchstart", onGesture, { capture: true, passive: true });
  document.addEventListener("touchend", onGesture, { capture: true, passive: true });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible" || !unlocked || !ctx) return;
    if (ctx.state !== "running") {
      var pending = ctx.resume();
      if (pending && pending.catch) pending.catch(function () {});
    }
  });

  root.IBSound = {
    sync: sync,
    isMuted: function () { return muted; }
  };
  try { mount(); } catch (e) {}
  if (root.__IB_SOUND_TEST__) {
    root.IBSound._reset = function () { last = null; };
    root.IBSound._unlock = unlock;
    root.IBSound._state = function () { return ctx ? ctx.state : "none"; };
    root.IBSound._volume = function () { return volume; };
    root.IBSound._music = function () { return musicOn; };
    root.IBSound._level = function () { return master ? master.gain.value : level(); };
    root.IBSound._suspend = function () { return ctx ? ctx.suspend() : Promise.resolve(); };
  }
})(typeof window !== "undefined" ? window : globalThis);
