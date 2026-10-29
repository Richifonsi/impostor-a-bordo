/* Efectos de Impostor a Bordo, sintetizados con Web Audio API (sin archivos).
   El AudioContext solo se crea tras un gesto del usuario.
   El silencio persiste en localStorage["ib-muted"]. */
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
    osc(ctx, dest, "sawtooth", 146.83, t, 1.15, 0.05, 123.47);
    var notes = [493.88, 369.99];
    var end = t;
    for (var i = 0; i < 6; i++) {
      var start = t + i * 0.18;
      osc(ctx, dest, "square", notes[i % 2], start, 0.14, 0.13);
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
    osc(ctx, dest, "sine", 783.99, t, 0.11, 0.18);
    osc(ctx, dest, "sine", 1174.66, t + 0.08, 0.16, 0.16);
    osc(ctx, dest, "triangle", 1567.98, t + 0.16, 0.12, 0.07);
    return t + 0.3;
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
  var last = null;
  var muted = false;
  var ready = Promise.resolve(false);

  function readMuted() {
    try { return localStorage.getItem(MUTE_KEY) === "1"; }
    catch (e) { return false; }
  }
  function writeMuted(v) {
    try { localStorage.setItem(MUTE_KEY, v ? "1" : "0"); }
    catch (e) {}
  }
  muted = readMuted();

  function applyGain() {
    if (!master || !ctx) return;
    var now = ctx.currentTime;
    master.gain.cancelScheduledValues(now);
    master.gain.setValueAtTime(muted ? 0 : 0.5, now);
  }

  function unlock() {
    var AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) {
      ready = Promise.resolve(false);
      return;
    }
    if (!ctx) {
      ctx = new AC();
      master = ctx.createGain();
      master.gain.setValueAtTime(muted ? 0 : 0.5, ctx.currentTime);
      master.connect(ctx.destination);
    }
    ready = ctx.resume().then(function () { return ctx.state === "running"; }).catch(function () { return false; });
  }

  function onGesture() {
    unlock();
    ready.then(function (ok) {
      if (!ok) return;
      document.removeEventListener("pointerdown", onGesture, true);
      document.removeEventListener("keydown", onGesture, true);
      document.removeEventListener("touchstart", onGesture, true);
    });
  }

  function emit(id) {
    if (root.__IB_SOUND_TEST__) {
      if (!root.__IB_SOUND_LOG__) root.__IB_SOUND_LOG__ = [];
      root.__IB_SOUND_LOG__.push(id);
    }
  }

  function playAll(events) {
    if (!events.length || muted || !ctx) return;
    var ticket = ready;
    ticket.then(function (ok) {
      try {
        if (!ok || muted || !ctx || ctx.state !== "running") return;
        schedule(ctx, master, events, ctx.currentTime);
        for (var i = 0; i < events.length; i++) {
          var ev = events[i];
          emit(ev.id === "vote" && ev.ejected === false ? "vote-skip" : ev.id);
        }
      } catch (e) {}
    });
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

  function label() {
    return muted ? "🔇 Silencio" : "🔊 Sonido";
  }

  function mount() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", mount);
      return;
    }
    if (document.getElementById("ib-mute")) return;
    var style = document.createElement("style");
    style.textContent = "#ib-mute{margin:6px 0}";
    document.head.appendChild(style);
    var btn = document.createElement("button");
    btn.id = "ib-mute";
    btn.type = "button";
    btn.textContent = label();
    btn.setAttribute("aria-pressed", muted ? "true" : "false");
    btn.title = muted ? "Activar sonido" : "Silenciar";
    btn.setAttribute("aria-label", btn.title);
    btn.addEventListener("click", function () {
      muted = !muted;
      writeMuted(muted);
      applyGain();
      btn.textContent = label();
      btn.title = muted ? "Activar sonido" : "Silenciar";
      btn.setAttribute("aria-label", btn.title);
      btn.setAttribute("aria-pressed", muted ? "true" : "false");
    });
    var bar = document.querySelector(".bar");
    if (bar && bar.parentElement) bar.parentElement.insertBefore(btn, bar);
    else document.body.appendChild(btn);
  }

  document.addEventListener("pointerdown", onGesture, true);
  document.addEventListener("keydown", onGesture, true);
  document.addEventListener("touchstart", onGesture, true);
  mount();

  root.IBSound = {
    sync: sync,
    isMuted: function () { return muted; }
  };
  if (root.__IB_SOUND_TEST__) {
    root.IBSound._reset = function () { last = null; };
    root.IBSound._unlock = unlock;
    root.IBSound._state = function () { return ctx ? ctx.state : "none"; };
  }
})(typeof window !== "undefined" ? window : globalThis);
