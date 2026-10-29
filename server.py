import json, math, os, random, secrets, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs

# Distancias en píxeles del plano (el mismo espacio que las salas de index.html).
# ATTACK_RANGE y PUSH_RANGE son la holgura entre los bordes de la caja de golpe,
# no la distancia de centro a centro. HITBOX es el radio de esa caja.
ATTACK_RANGE = 40
PUSH_RANGE = 40
PUSH_DISTANCE = 30
HITBOX = 14
LIVES = 3
ATTACK_COOLDOWN = 3
PUSH_COOLDOWN = 2

L = threading.Lock()
ROOT = Path(__file__).resolve().parent
MAP = {"Barra": ["Tostadora", "Caja", "Bodega de granos"], "Tostadora": ["Barra", "Terraza"], "Caja": ["Barra", "Bodega de granos"],
       "Bodega de granos": ["Barra", "Caja", "Cuarto de máquinas", "Cocina", "Molinos"], "Cuarto de máquinas": ["Bodega de granos", "Cámaras"], "Cámaras": ["Cuarto de máquinas", "Caldera de espresso", "Molinos"],
       "Terraza": ["Tostadora", "Cocina"], "Cocina": ["Terraza", "Bodega de granos"], "Molinos": ["Bodega de granos", "Cámaras", "Caldera de espresso"], "Caldera de espresso": ["Molinos", "Cámaras"]}
VENTS = {"Cuarto de máquinas": "Cámaras", "Cámaras": "Cuarto de máquinas", "Terraza": "Cocina", "Cocina": "Terraza"}
TASKS = {"Barra": "Limpiar la barra", "Tostadora": "Calibrar el tueste", "Caja": "Cuadrar la caja", "Bodega de granos": "Subir sacos de grano", "Cuarto de máquinas": "Arreglar cables",
         "Cámaras": "Revisar cámaras", "Terraza": "Acomodar mesas", "Cocina": "Hornear pandebonos", "Molinos": "Ajustar la molienda", "Caldera de espresso": "Purgar la caldera"}
# Silueta de cada sala en el plano. El punto de aparición es el mismo `stand` del mapa.
POLYS = {
    "Tostadora": [(46, 120), (92, 80), (164, 76), (208, 114), (208, 174), (164, 212), (92, 216), (46, 178)],
    "Caja": [(390, 260), (526, 260), (554, 288), (554, 372), (526, 400), (390, 400), (362, 372), (362, 288)],
    "Cocina": [(812, 272), (984, 272), (984, 520), (908, 520), (908, 368), (812, 368)],
    "Cuarto de máquinas": [(36, 448), (112, 448), (112, 500), (180, 500), (180, 590), (36, 590)],
    "Bodega de granos": [(280, 456), (704, 456), (756, 504), (756, 548), (704, 596), (280, 596), (232, 548), (232, 504)],
    "Cámaras": [(40, 640), (150, 640), (236, 700), (150, 760), (40, 760), (24, 744), (24, 656)],
}
MOLINOS = [(430 + 72 * math.cos(i * math.pi / 3), 710 + 72 * math.sin(i * math.pi / 3)) for i in range(6)]
SPAWN = {
    "Tostadora": (120, 186), "Barra": (500, 184), "Terraza": (836, 196), "Caja": (458, 368),
    "Cocina": (946, 468), "Cuarto de máquinas": (112, 566), "Bodega de granos": (490, 562),
    "Cámaras": (92, 728), "Molinos": (430, 736), "Caldera de espresso": (900, 742),
}

def new():
    return {"phase": "lobby", "players": {}, "log": ["Sala abierta. Únanse y alguien pulse Empezar."], "bodies": [], "votes": {}, "winner": None, "last_push": None, "push_seq": 0}
G = new()
def P(n):
    return G["players"].get(n)
def alive():
    return [p for p in G["players"].values() if p["alive"]]
def rnd(v):
    v = round(float(v), 2)
    iv = round(v)
    return int(iv) if abs(v - iv) < 1e-9 else v
def dist(a, b):
    return math.hypot(a["x"] - b["x"], a["y"] - b["y"])
def gap(a, b):
    """Holgura entre bordes. 0 si las cajas se tocan o se solapan."""
    return max(0.0, dist(a, b) - 2 * HITBOX)
def in_poly(x, y, poly):
    n = len(poly)
    c = False
    j = n - 1
    for i in range(n):
        xi, yi = poly[i]
        xj, yj = poly[j]
        if (yi > y) != (yj > y):
            if x < (xj - xi) * (y - yi) / (yj - yi) + xi:
                c = not c
        j = i
    if c:
        return True
    for i in range(n):
        ax, ay = poly[i]
        bx, by = poly[(i + 1) % n]
        dx, dy = bx - ax, by - ay
        l2 = dx * dx + dy * dy
        t = 0 if l2 == 0 else max(0.0, min(1.0, ((x - ax) * dx + (y - ay) * dy) / l2))
        qx, qy = ax + t * dx, ay + t * dy
        if (x - qx) ** 2 + (y - qy) ** 2 <= 0.75 ** 2:
            return True
    return False
def inside(room, x, y):
    if room == "Barra":
        return (310 <= x <= 690 and 100 <= y <= 212) or (x - 310) ** 2 + (y - 156) ** 2 <= 56 ** 2 or (x - 690) ** 2 + (y - 156) ** 2 <= 56 ** 2
    if room == "Terraza":
        return (790 <= x <= 860 and 96 <= y <= 224) or (x - 860) ** 2 + (y - 160) ** 2 <= 64 ** 2
    if room == "Caldera de espresso":
        return (x - 900) ** 2 + (y - 710) ** 2 <= 70 ** 2
    if room == "Molinos":
        return in_poly(x, y, MOLINOS)
    return in_poly(x, y, POLYS[room])
def enter(p, room):
    p["room"] = room
    p["x"], p["y"] = SPAWN[room]
def clamp_along(room, x0, y0, x1, y1):
    if inside(room, x1, y1):
        return x1, y1
    if not inside(room, x0, y0):
        return SPAWN[room]
    lo, hi = 0.0, 1.0
    for _ in range(28):
        mid = (lo + hi) / 2
        if inside(room, x0 + (x1 - x0) * mid, y0 + (y1 - y0) * mid):
            lo = mid
        else:
            hi = mid
    return x0 + (x1 - x0) * lo, y0 + (y1 - y0) * lo
def point_of(d):
    if "x" not in d or "y" not in d:
        return None
    x, y = d.get("x"), d.get("y")
    if isinstance(x, bool) or isinstance(y, bool):
        return None
    if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
        return None
    if x != x or y != y or abs(x) > 10000 or abs(y) > 10000:
        return None
    return float(x), float(y)
def check():
    imp = [p for p in alive() if p["role"] == "impostor"]
    crew = [p for p in alive() if p["role"] == "tripulante"]
    tot = sum(len(p["tasks"]) + len(p["done"]) for p in G["players"].values() if p["role"] == "tripulante")
    dn = sum(len(p["done"]) for p in G["players"].values() if p["role"] == "tripulante")
    if not imp:
        G["winner"] = "¡Ganan los tripulantes! El impostor fue expulsado."
    elif len(imp) >= len(crew):
        G["winner"] = "¡Gana el impostor!"
    elif tot and dn >= tot:
        G["winner"] = "¡Ganan los tripulantes! Terminaron todas las tareas."
    if G["winner"]:
        G["phase"] = "end"
        G["log"].append(G["winner"] + " Impostor: " + ", ".join(p["name"] for p in G["players"].values() if p["role"] == "impostor"))
def place(p, x, y):
    rx, ry = rnd(x), rnd(y)
    if inside(p["room"], rx, ry):
        p["x"], p["y"] = rx, ry
    else:
        p["x"], p["y"] = x, y
def go_point(p, xy):
    x, y = xy
    if not inside(p["room"], x, y):
        return {"error": "Ese punto está fuera de la sala"}
    place(p, x, y)
    return {"ok": 1}
def go_room(p, t):
    if t not in MAP.get(p["room"], []):
        return {"error": "Esa sala no está conectada"}
    enter(p, t)
    return {"ok": 1}
def act(d):
    global G
    a = d.get("action")
    n = (d.get("name") or "").strip()[:20]
    t = d.get("target")
    if a == "reset":
        G = new()
        return {"ok": 1}
    if a == "join":
        if not n:
            return {"error": "Falta nombre"}
        if n in G["players"]:
            return {"error": "Ese nombre ya está"}
        if G["phase"] != "lobby":
            return {"error": "La partida ya empezó"}
        tok = secrets.token_hex(6)
        sx, sy = SPAWN["Barra"]
        G["players"][n] = {"name": n, "token": tok, "room": "Barra", "x": sx, "y": sy, "alive": True, "lives": LIVES, "role": None, "tasks": [], "done": [], "cd": 0, "pcd": 0}
        G["log"].append(f"{n} se unió.")
        return {"ok": 1, "token": tok}
    p = P(n)
    if not p or p["token"] != d.get("token"):
        return {"error": "Jugador o token inválido"}
    if a == "start":
        if G["phase"] != "lobby" or len(G["players"]) < 3:
            return {"error": "Se necesitan al menos 3 jugadores en la sala"}
        ps = list(G["players"].values())
        random.shuffle(ps)
        k = 2 if len(ps) >= 7 else 1
        rooms = list(TASKS)
        for i, q in enumerate(ps):
            q["role"] = "impostor" if i < k else "tripulante"
            q["tasks"] = random.sample(rooms, 3) if q["role"] == "tripulante" else []
            q["lives"] = LIVES
            enter(q, "Barra")
        G["phase"] = "play"
        G["log"].append("¡La partida empezó! Revisen su rol.")
        return {"ok": 1}
    if G["phase"] == "end":
        return {"error": "La partida terminó"}
    if G["phase"] == "meeting":
        if a == "chat":
            msg = str(d.get("text", ""))[:200]
            G["log"].append(("👻 " if not p["alive"] else "💬 ") + f"{n}: {msg}")
            return {"ok": 1}
        if a != "vote":
            return {"error": "Hay una reunión: solo se puede votar"}
        if not p["alive"]:
            return {"error": "Los fantasmas no votan"}
        if t != "skip" and (t not in G["players"] or not G["players"][t]["alive"]):
            return {"error": "Voto inválido"}
        G["votes"][n] = t
        G["log"].append(f"{n} votó.")
        if len(G["votes"]) >= len(alive()):
            c = {}
            for v in G["votes"].values():
                c[v] = c.get(v, 0) + 1
            top = max(c.values())
            w = [k for k, v in c.items() if v == top]
            if len(w) == 1 and w[0] != "skip":
                out = G["players"][w[0]]
                out["alive"] = False
                out["lives"] = 0
                G["log"].append(f"{w[0]} fue expulsado al espacio. Votos: {c}")
            else:
                G["log"].append(f"Nadie fue expulsado. Votos: {c}")
            G["votes"] = {}
            G["bodies"] = []
            G["phase"] = "play"
            for q in G["players"].values():
                enter(q, "Barra")
            check()
        return {"ok": 1}
    if not p["alive"]:
        if a == "task" and p["role"] == "tripulante" and p["room"] in p["tasks"]:
            p["tasks"].remove(p["room"])
            p["done"].append(p["room"])
            check()
            return {"ok": 1}
        if a not in ("move", "moveto"):
            return {"error": "Eres un fantasma: solo puedes moverte y hacer tareas"}
    if p["cd"] > 0:
        p["cd"] -= 1
    if p.get("pcd", 0) > 0:
        p["pcd"] -= 1
    if a == "move":
        xy = point_of(d)
        if t in MAP or xy is None:
            return go_room(p, t)
        return go_point(p, xy)
    if a == "moveto":
        xy = point_of(d)
        if xy is None:
            return {"error": "Faltan coordenadas"}
        return go_point(p, xy)
    if a == "vent":
        if p["role"] != "impostor":
            return {"error": "Solo el impostor usa ventilas"}
        if p["room"] not in VENTS:
            return {"error": "Aquí no hay ventila"}
        enter(p, VENTS[p["room"]])
        return {"ok": 1}
    if a == "task":
        if p["role"] == "impostor":
            G["log"].append(f"{n} hizo una tarea en {p['room']}.")
            return {"ok": 1, "fake": 1}
        if p["room"] not in p["tasks"]:
            return {"error": "No tienes tarea en esta sala"}
        p["tasks"].remove(p["room"])
        p["done"].append(p["room"])
        G["log"].append(f"{n} hizo una tarea en {p['room']}.")
        check()
        return {"ok": 1}
    if a == "kill":
        q = P(t)
        if p["role"] != "impostor":
            return {"error": "No eres el impostor"}
        if not q or not q["alive"] or q["name"] == n or q["role"] == "impostor":
            return {"error": "Objetivo inválido"}
        if q["room"] != p["room"]:
            return {"error": "No está en tu sala"}
        if gap(p, q) > ATTACK_RANGE:
            return {"error": "Está fuera de alcance"}
        if p["cd"] > 0:
            return {"error": f"Espera {p['cd']} acciones más"}
        q["lives"] -= 1
        p["cd"] = ATTACK_COOLDOWN
        if q["lives"] <= 0:
            q["lives"] = 0
            q["alive"] = False
            G["bodies"].append({"name": t, "room": q["room"], "x": q["x"], "y": q["y"]})
            check()
        return {"ok": 1, "lives": q["lives"]}
    if a == "push":
        q = P(t)
        if not q or not q["alive"] or q["name"] == n:
            return {"error": "Objetivo inválido"}
        if q["room"] != p["room"]:
            return {"error": "No está en tu sala"}
        if gap(p, q) > PUSH_RANGE:
            return {"error": "Está fuera de alcance para empujar"}
        if p.get("pcd", 0) > 0:
            return {"error": f"Espera {p['pcd']} acciones más para empujar"}
        ox, oy = q["x"], q["y"]
        dx, dy = q["x"] - p["x"], q["y"] - p["y"]
        far = math.hypot(dx, dy)
        ux, uy = (1.0, 0.0) if far < 0.01 else (dx / far, dy / far)
        nx, ny = clamp_along(q["room"], q["x"], q["y"], q["x"] + ux * PUSH_DISTANCE, q["y"] + uy * PUSH_DISTANCE)
        place(q, nx, ny)
        p["pcd"] = PUSH_COOLDOWN
        G["push_seq"] += 1
        G["last_push"] = {"id": G["push_seq"], "by": n, "target": t, "room": p["room"], "from": {"x": ox, "y": oy}, "to": {"x": q["x"], "y": q["y"]}}
        return {"ok": 1, "x": q["x"], "y": q["y"]}
    if a in ("report", "meeting"):
        if a == "report":
            b = [x for x in G["bodies"] if x["room"] == p["room"]]
            if not b:
                return {"error": "No hay cuerpos aquí"}
            G["log"].append(f"🚨 {n} reportó el cuerpo de {b[0]['name']} en {p['room']}.")
        else:
            if p.get("btn"):
                return {"error": "Ya usaste tu botón de emergencia"}
            p["btn"] = 1
            G["log"].append(f"🚨 {n} llamó a reunión de emergencia.")
        dead = [q["name"] for q in G["players"].values() if not q["alive"]]
        if dead:
            G["log"].append("Fantasmas: " + ", ".join(dead))
        G["phase"] = "meeting"
        G["votes"] = {}
        return {"ok": 1}
    if a == "chat":
        msg = str(d.get("text", ""))[:200]
        if G["phase"] != "meeting" and p["alive"]:
            return {"error": "Solo se habla en reuniones"}
        G["log"].append(("👻 " if not p["alive"] else "💬 ") + f"{n}: {msg}")
        return {"ok": 1}
    return {"error": "Acción desconocida"}
def spot(q):
    return {"name": q["name"], "x": q["x"], "y": q["y"], "lives": q["lives"], "alive": q["alive"], "room": q["room"]}
def view(n, tok):
    p = P(n)
    me = None
    if p and p["token"] == tok:
        me = {"name": n, "role": p["role"], "room": p["room"], "alive": p["alive"], "lives": p["lives"], "x": p["x"], "y": p["y"],
              "tasks": p["tasks"], "done": p["done"], "cd": p["cd"], "push_cd": p.get("pcd", 0),
              "exits": MAP[p["room"]], "vent": VENTS.get(p["room"]) if p["role"] == "impostor" else None,
              "here": [q["name"] for q in alive() if q["room"] == p["room"] and q["name"] != n],
              "bodies": [b["name"] for b in G["bodies"] if b["room"] == p["room"]],
              "corpses": [{"name": b["name"], "x": b["x"], "y": b["y"]} for b in G["bodies"] if b["room"] == p["room"]],
              "positions": [spot(q) for q in G["players"].values() if q["room"] == p["room"]]}
    tot = sum(len(q["tasks"]) + len(q["done"]) for q in G["players"].values() if q["role"] == "tripulante")
    dn = sum(len(q["done"]) for q in G["players"].values() if q["role"] == "tripulante")
    players = []
    for q in G["players"].values():
        row = {"name": q["name"], "alive": q["alive"] if G["phase"] != "play" else True, "voted": q["name"] in G["votes"],
               "lives": q["lives"], "x": q["x"], "y": q["y"], "room": q["room"]}
        players.append(row)
    return {"phase": G["phase"], "players": players, "log": G["log"][-40:], "me": me, "progress": [dn, tot], "map": MAP,
            "spawns": {room: {"x": xy[0], "y": xy[1]} for room, xy in SPAWN.items()},
            "rules": {"attack_range": ATTACK_RANGE, "push_range": PUSH_RANGE, "push_distance": PUSH_DISTANCE, "hitbox": HITBOX,
                      "lives": LIVES, "attack_cooldown": ATTACK_COOLDOWN, "push_cooldown": PUSH_COOLDOWN},
            "last_push": G["last_push"], "winner": G["winner"]}
def read_static(name):
    return (ROOT / name).read_text(encoding="utf-8")
class H(BaseHTTPRequestHandler):
    def log_message(s, *a):
        pass
    def send(s, code, body, ct="application/json"):
        b = body.encode() if isinstance(body, str) else body
        s.send_response(code)
        s.send_header("Content-Type", ct + "; charset=utf-8")
        s.send_header("Access-Control-Allow-Origin", "*")
        s.end_headers()
        s.wfile.write(b)
    def do_GET(s):
        u = urlparse(s.path)
        q = parse_qs(u.query)
        if u.path == "/state":
            with L:
                return s.send(200, json.dumps(view(q.get("name", [""])[0], q.get("token", [""])[0]), ensure_ascii=False))
        if u.path == "/help":
            try:
                return s.send(200, read_static("help.txt"), "text/plain")
            except FileNotFoundError:
                return s.send(404, "No hay ayuda.", "text/plain")
        if u.path == "/sounds.js":
            try:
                return s.send(200, read_static("sounds.js"), "text/javascript")
            except FileNotFoundError:
                return s.send(404, "", "text/plain")
        return s.send(200, read_static("index.html"), "text/html")
    def do_POST(s):
        try:
            d = json.loads(s.rfile.read(int(s.headers.get("Content-Length", 0))) or "{}")
        except Exception:
            d = {}
        with L:
            r = act(d)
        s.send(200, json.dumps(r, ensure_ascii=False))
def main():
    port = int(os.environ.get("PORT", "8765"))
    print(f"Impostor a Bordo escuchando en 0.0.0.0:{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
if __name__ == "__main__":
    main()
