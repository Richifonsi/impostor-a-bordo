import json, os, random, secrets, threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlparse, parse_qs
L=threading.Lock()
ROOT = Path(__file__).resolve().parent
MAP={"Barra":["Tostadora","Caja","Bodega de granos"],"Tostadora":["Barra","Terraza"],"Caja":["Barra","Bodega de granos"],
"Bodega de granos":["Barra","Caja","Cuarto de máquinas","Cocina","Molinos"],"Cuarto de máquinas":["Bodega de granos","Cámaras"],"Cámaras":["Cuarto de máquinas","Caldera de espresso","Molinos"],
"Terraza":["Tostadora","Cocina"],"Cocina":["Terraza","Bodega de granos"],"Molinos":["Bodega de granos","Cámaras","Caldera de espresso"],"Caldera de espresso":["Molinos","Cámaras"]}
VENTS={"Cuarto de máquinas":"Cámaras","Cámaras":"Cuarto de máquinas","Terraza":"Cocina","Cocina":"Terraza"}
TASKS={"Barra":"Limpiar la barra","Tostadora":"Calibrar el tueste","Caja":"Cuadrar la caja","Bodega de granos":"Subir sacos de grano","Cuarto de máquinas":"Arreglar cables",
"Cámaras":"Revisar cámaras","Terraza":"Acomodar mesas","Cocina":"Hornear pandebonos","Molinos":"Ajustar la molienda","Caldera de espresso":"Purgar la caldera"}
def new(): return {"phase":"lobby","players":{},"log":["Sala abierta. Únanse y alguien pulse Empezar."],"bodies":[],"votes":{},"winner":None}
G=new()
def P(n): return G["players"].get(n)
def alive(): return [p for p in G["players"].values() if p["alive"]]
def check():
    imp=[p for p in alive() if p["role"]=="impostor"]; crew=[p for p in alive() if p["role"]=="tripulante"]
    tot=sum(len(p["tasks"])+len(p["done"]) for p in G["players"].values() if p["role"]=="tripulante")
    dn=sum(len(p["done"]) for p in G["players"].values() if p["role"]=="tripulante")
    if not imp: G["winner"]="¡Ganan los tripulantes! El impostor fue expulsado."
    elif len(imp)>=len(crew): G["winner"]="¡Gana el impostor!"
    elif tot and dn>=tot: G["winner"]="¡Ganan los tripulantes! Terminaron todas las tareas."
    if G["winner"]:
        G["phase"]="end"; G["log"].append(G["winner"]+" Impostor: "+", ".join(p["name"] for p in G["players"].values() if p["role"]=="impostor"))
def act(d):
    global G
    a=d.get("action"); n=(d.get("name") or "").strip()[:20]; t=d.get("target")
    if a=="reset": G=new(); return {"ok":1}
    if a=="join":
        if not n: return {"error":"Falta nombre"}
        if n in G["players"]: return {"error":"Ese nombre ya está"}
        if G["phase"]!="lobby": return {"error":"La partida ya empezó"}
        tok=secrets.token_hex(6); G["players"][n]={"name":n,"token":tok,"room":"Barra","alive":True,"role":None,"tasks":[],"done":[],"cd":0}
        G["log"].append(f"{n} se unió."); return {"ok":1,"token":tok}
    p=P(n)
    if not p or p["token"]!=d.get("token"): return {"error":"Jugador o token inválido"}
    if a=="start":
        if G["phase"]!="lobby" or len(G["players"])<3: return {"error":"Se necesitan al menos 3 jugadores en la sala"}
        ps=list(G["players"].values()); random.shuffle(ps); k=2 if len(ps)>=7 else 1
        rooms=list(TASKS)
        for i,q in enumerate(ps):
            q["role"]="impostor" if i<k else "tripulante"; q["tasks"]=random.sample(rooms,3) if q["role"]=="tripulante" else []
        G["phase"]="play"; G["log"].append("¡La partida empezó! Revisen su rol."); return {"ok":1}
    if G["phase"]=="end": return {"error":"La partida terminó"}
    if G["phase"]=="meeting":
        if a!="vote": return {"error":"Hay una reunión: solo se puede votar"}
        if not p["alive"]: return {"error":"Los fantasmas no votan"}
        if t!="skip" and (t not in G["players"] or not G["players"][t]["alive"]): return {"error":"Voto inválido"}
        G["votes"][n]=t; G["log"].append(f"{n} votó.")
        if len(G["votes"])>=len(alive()):
            c={}
            for v in G["votes"].values(): c[v]=c.get(v,0)+1
            top=max(c.values()); w=[k for k,v in c.items() if v==top]
            if len(w)==1 and w[0]!="skip":
                G["players"][w[0]]["alive"]=False; G["log"].append(f"{w[0]} fue expulsado al espacio. Votos: {c}")
            else: G["log"].append(f"Nadie fue expulsado. Votos: {c}")
            G["votes"]={}; G["bodies"]=[]; G["phase"]="play"
            for q in G["players"].values(): q["room"]="Barra"
            check()
        return {"ok":1}
    if not p["alive"]:
        if a=="task" and p["role"]=="tripulante" and p["room"] in p["tasks"]:
            p["tasks"].remove(p["room"]); p["done"].append(p["room"]); check(); return {"ok":1}
        if a!="move": return {"error":"Eres un fantasma: solo puedes moverte y hacer tareas"}
    if p["cd"]>0: p["cd"]-=1
    if a=="move":
        if t not in MAP.get(p["room"],[]): return {"error":"Esa sala no está conectada"}
        p["room"]=t; return {"ok":1}
    if a=="vent":
        if p["role"]!="impostor": return {"error":"Solo el impostor usa ventilas"}
        if p["room"] not in VENTS: return {"error":"Aquí no hay ventila"}
        p["room"]=VENTS[p["room"]]; return {"ok":1}
    if a=="task":
        if p["role"]=="impostor": G["log"].append(f"{n} hizo una tarea en {p['room']}."); return {"ok":1,"fake":1}
        if p["room"] not in p["tasks"]: return {"error":"No tienes tarea en esta sala"}
        p["tasks"].remove(p["room"]); p["done"].append(p["room"]); G["log"].append(f"{n} hizo una tarea en {p['room']}."); check(); return {"ok":1}
    if a=="kill":
        q=P(t)
        if p["role"]!="impostor": return {"error":"No eres el impostor"}
        if p["cd"]>0: return {"error":f"Espera {p['cd']} acciones más"}
        if not q or not q["alive"] or q["room"]!=p["room"] or q["role"]=="impostor": return {"error":"Objetivo inválido"}
        q["alive"]=False; G["bodies"].append({"name":t,"room":p["room"]}); p["cd"]=3; check(); return {"ok":1}
    if a in("report","meeting"):
        if a=="report":
            b=[x for x in G["bodies"] if x["room"]==p["room"]]
            if not b: return {"error":"No hay cuerpos aquí"}
            G["log"].append(f"🚨 {n} reportó el cuerpo de {b[0]['name']} en {p['room']}.")
        else:
            if p.get("btn"): return {"error":"Ya usaste tu botón de emergencia"}
            p["btn"]=1; G["log"].append(f"🚨 {n} llamó a reunión de emergencia.")
        dead=[q["name"] for q in G["players"].values() if not q["alive"]]
        if dead: G["log"].append("Fantasmas: "+", ".join(dead))
        G["phase"]="meeting"; G["votes"]={}; return {"ok":1}
    if a=="chat":
        msg=str(d.get("text",""))[:200]
        if G["phase"]!="meeting" and p["alive"]: return {"error":"Solo se habla en reuniones"}
        G["log"].append(("👻 " if not p["alive"] else "💬 ")+f"{n}: {msg}"); return {"ok":1}
    return {"error":"Acción desconocida"}
def view(n,tok):
    p=P(n); me=None
    if p and p["token"]==tok:
        me={"name":n,"role":p["role"],"room":p["room"],"alive":p["alive"],"tasks":p["tasks"],"done":p["done"],"cd":p["cd"],
            "exits":MAP[p["room"]],"vent":VENTS.get(p["room"]) if p["role"]=="impostor" else None,
            "here":[q["name"] for q in alive() if q["room"]==p["room"] and q["name"]!=n],
            "bodies":[b["name"] for b in G["bodies"] if b["room"]==p["room"]]}
    tot=sum(len(q["tasks"])+len(q["done"]) for q in G["players"].values() if q["role"]=="tripulante")
    dn=sum(len(q["done"]) for q in G["players"].values() if q["role"]=="tripulante")
    return {"phase":G["phase"],"players":[{"name":q["name"],"alive":q["alive"] if G["phase"]!="play" else True,"voted":q["name"] in G["votes"]} for q in G["players"].values()],
            "log":G["log"][-40:],"me":me,"progress":[dn,tot],"map":MAP,"winner":G["winner"]}
def read_static(name):
    return (ROOT / name).read_text(encoding="utf-8")
class H(BaseHTTPRequestHandler):
    def log_message(s,*a): pass
    def send(s,code,body,ct="application/json"):
        b=body.encode() if isinstance(body,str) else body
        s.send_response(code); s.send_header("Content-Type",ct+"; charset=utf-8"); s.send_header("Access-Control-Allow-Origin","*"); s.end_headers(); s.wfile.write(b)
    def do_GET(s):
        u=urlparse(s.path); q=parse_qs(u.query)
        if u.path=="/state":
            with L: return s.send(200,json.dumps(view(q.get("name",[""])[0],q.get("token",[""])[0]),ensure_ascii=False))
        if u.path=="/help":
            try: return s.send(200,read_static("help.txt"),"text/plain")
            except FileNotFoundError: return s.send(404,"No hay ayuda.","text/plain")
        if u.path=="/sounds.js":
            try: return s.send(200,read_static("sounds.js"),"text/javascript")
            except FileNotFoundError: return s.send(404,"","text/plain")
        return s.send(200,read_static("index.html"),"text/html")
    def do_POST(s):
        try: d=json.loads(s.rfile.read(int(s.headers.get("Content-Length",0))) or "{}")
        except: d={}
        with L: r=act(d)
        s.send(200,json.dumps(r,ensure_ascii=False))
def main():
    port = int(os.environ.get("PORT", "8765"))
    print(f"Impostor a Bordo escuchando en 0.0.0.0:{port}", flush=True)
    ThreadingHTTPServer(("0.0.0.0", port), H).serve_forever()
if __name__ == "__main__":
    main()
