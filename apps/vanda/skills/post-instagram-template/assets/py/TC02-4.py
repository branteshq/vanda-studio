"""TC02-4 Glossário 4/5 · carrossel só texto (1080×1350)."""

# Modelo de layout da skill post-instagram-template, convertido para Pillow.
# Preencha CORES, FONTES, FOTOS e TEXTOS; o LAYOUT guarda as posições medidas do original.
# Os cinzas do modelo são papéis: neutros são derivados entre CORES['escuro'] e CORES['claro'].

OUTPUT = "/home/user/out/tc02-4.png"

CORES = {
    "escuro": "#262626",  # fundos escuros e títulos
    "claro": "#F2F2F2",  # fundo da arte
    "destaque": "#6E6E6E",  # pílulas, números grandes, botões, ícones de check
    "cartao": "#FFFFFF",  # cartões brancos
}

# Famílias de /home/user/fonts/manifest.json.
FONTES = {"titulo": "Playfair Display", "texto": "Inter"}

FOTOS = {}

# Textos de cima para baixo. Troque todo [colchete]; string vazia remove o elemento.
TEXTOS = {
    'texto01': '@[seuperfil]',  # 26px, texto, 600, neutro
    'texto02': '04/05',  # 26px, texto, 700, neutro
    'texto03': '[Termo 3]',  # 110px, título, 700, escuro
    'texto04': '[classe gramatical]',  # 30px, texto, 400, neutro
    'texto05': '[Definição em linguagem simples.]',  # 42px, texto, 500, escuro
    'texto06': 'Exemplo: [frase de uso no dia a dia].',  # 34px, texto, 400, neutro
    'texto07': 'Arraste',  # 28px, texto, 700, escuro
}

LAYOUT = [
    {"op":"box","box":[0,0,1080,1350],"radius":0,"fill":["light",1],"gradient":None,"borders":None},
    {"op":"text","key":"texto01","content":[96,88,154.95,36],"pads":[0,0,0,0],"hug":True,"anchor":"left","maxW":888,"role":"body","size":26,"weight":600,"lineHeight":32.5,"tracking":0,"upper":False,"align":"left","lines":1,"bg":None,"style":{"color":["mix:0.265",1]}},
    {"op":"text","key":"texto02","content":[907.47,88,76.53,36],"pads":[0,0,0,0],"hug":True,"anchor":"right","maxW":888,"role":"body","size":26,"weight":700,"lineHeight":32.5,"tracking":0,"upper":False,"align":"left","lines":1,"bg":None,"style":{"color":["mix:0.265",1]}},
    {"op":"text","key":"texto03","content":[96,379.17,888,113.3],"pads":[0,0,0,0],"hug":False,"anchor":"left","maxW":888,"role":"title","size":110,"weight":700,"lineHeight":113.3,"tracking":-2.2,"upper":False,"align":"left","lines":1,"bg":None,"style":{"color":["dark",1]}},
    {"op":"text","key":"texto04","content":[96,518.47,888,41],"pads":[0,0,0,0],"hug":False,"anchor":"left","maxW":888,"role":"body","size":30,"weight":400,"lineHeight":37.5,"tracking":0,"upper":False,"align":"left","lines":1,"bg":None,"style":{"color":["mix:0.265",1],"italic":True}},
    {"op":"box","box":[96,585.47,888,2],"radius":0,"fill":["dark",1],"gradient":None,"borders":None},
    {"op":"text","key":"texto05","content":[96,613.47,888,60.89],"pads":[0,0,0,0],"hug":False,"anchor":"left","maxW":888,"role":"body","size":42,"weight":500,"lineHeight":60.9,"tracking":0,"upper":False,"align":"left","lines":1,"bg":None,"style":{"color":["dark",1]}},
    {"op":"text","key":"texto06","content":[96,700.36,888,49.3],"pads":[0,0,0,0],"hug":False,"anchor":"left","maxW":888,"role":"body","size":34,"weight":400,"lineHeight":49.3,"tracking":0,"upper":False,"align":"left","lines":1,"bg":None,"style":{"color":["mix:0.265",1]}},
    {"op":"text","key":"texto07","content":[835.72,1224,100.28,38],"pads":[0,0,0,0],"hug":True,"anchor":"right","maxW":840,"role":"body","size":28,"weight":700,"lineHeight":35,"tracking":0,"upper":False,"align":"left","lines":1,"bg":None,"style":{"color":["dark",1]}},
    {"op":"icon","strokes":[{"parts":[[[955.5,1243],[976.5,1243]]],"stroke":["dark",1],"fill":None,"width":3},{"parts":[[[967.5,1234],[976.5,1243],[967.5,1252]]],"stroke":["dark",1],"fill":None,"width":3}]},
]

# ---------------------------------------------------------------------------
# Motor de desenho. Não precisa editar abaixo desta linha.
# ---------------------------------------------------------------------------
import json
import math
import re

from PIL import Image, ImageDraw, ImageFont, ImageOps

W, H = 1080, 1350
S = 2  # supersampling: desenha em 2x e reduz, para bordas suaves

with open("/home/user/fonts/manifest.json", encoding="utf-8") as f:
    MANIFEST = json.load(f)

PAPEIS = {"dark": "escuro", "light": "claro", "accent": "destaque", "card": "cartao"}
STATIC_WEIGHTS = {"regular": 400, "medium": 500, "semibold": 600, "bold": 700}
_fonts = {}
_avisos = []


def aviso(msg):
    if msg not in _avisos:
        _avisos.append(msg)


def hex_rgb(value):
    value = value.lstrip("#")
    return tuple(int(value[i : i + 2], 16) for i in (0, 2, 4))


def cor(token, alpha=1.0):
    if token in PAPEIS:
        rgb = hex_rgb(CORES[PAPEIS[token]])
    elif token.startswith("mix:"):
        t = float(token[4:])
        a, b = hex_rgb(CORES["escuro"]), hex_rgb(CORES["claro"])
        rgb = tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))
    else:
        rgb = hex_rgb(token)
    return rgb + (round(255 * alpha),)


def fonte(papel, peso, tamanho):
    familia = FONTES["titulo" if papel == "title" else "texto"]
    chave = (familia, peso, tamanho)
    if chave in _fonts:
        return _fonts[chave]
    entradas = [e for e in MANIFEST["fonts"] if e["family"].lower() == familia.lower()]
    if not entradas:
        aviso(f"fonte '{familia}' não está instalada; usei Inter")
        entradas = [e for e in MANIFEST["fonts"] if e["family"] == "Inter"]
    variavel = [e for e in entradas if e.get("variable")]
    if variavel:
        font = ImageFont.truetype(variavel[0]["path"], tamanho)
        valores = []
        for eixo in font.get_variation_axes():
            nome = eixo["name"].decode() if isinstance(eixo["name"], bytes) else str(eixo["name"])
            if nome.lower() == "weight":
                valores.append(min(max(peso, eixo["minimum"]), eixo["maximum"]))
            elif nome.lower().startswith("optical"):
                valores.append(min(max(tamanho / S, eixo["minimum"]), eixo["maximum"]))
            else:
                valores.append(eixo.get("default", eixo["maximum"]))
        font.set_variation_by_axes(valores)
    else:
        melhor = min(entradas, key=lambda e: abs(STATIC_WEIGHTS.get(e.get("weight"), 400) - peso))
        font = ImageFont.truetype(melhor["path"], tamanho)
    _fonts[chave] = font
    return font


def sc(values):
    return [v * S for v in values]


def mascara_arredondada(w, h, raio):
    mask = Image.new("L", (w, h), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, w - 1, h - 1], radius=raio, fill=255)
    return mask


def degrade(img, x, y, w, h, raio, grad):
    x, y, w, h = [round(v) for v in sc([x, y, w, h])]
    if w <= 0 or h <= 0:
        return
    camada = Image.new("RGBA", (w, h))
    d = ImageDraw.Draw(camada)
    direcao = grad["dir"]
    horizontal = direcao in ("to right", "to left", "90deg", "270deg")
    n = w if horizontal else h
    paradas = grad["stops"]
    for i in range(n):
        p = i / max(1, n - 1)
        if direcao in ("to top", "0deg", "to left", "270deg"):
            p = 1 - p
        a = paradas[0]
        b = paradas[-1]
        for j in range(len(paradas) - 1):
            if paradas[j][2] <= p <= paradas[j + 1][2]:
                a, b = paradas[j], paradas[j + 1]
                break
        span = (b[2] - a[2]) or 1
        t = min(1, max(0, (p - a[2]) / span))
        ca, cb = cor(a[0], a[1]), cor(b[0], b[1])
        c = tuple(round(ca[k] + (cb[k] - ca[k]) * t) for k in range(4))
        if horizontal:
            d.line([(i, 0), (i, h)], fill=c)
        else:
            d.line([(0, i), (w, i)], fill=c)
    if raio:
        vazio = Image.new("RGBA", (w, h))
        camada = Image.composite(camada, vazio, mascara_arredondada(w, h, round(raio * S)))
    img.alpha_composite(camada, (x, y))


def tracejado(d, p0, p1, cor_, largura, traco=12):
    (x0, y0), (x1, y1) = p0, p1
    comprimento = math.hypot(x1 - x0, y1 - y0)
    passos = max(1, int(comprimento / (traco * S * 2)))
    for i in range(passos + 1):
        a = min(1, i * 2 * traco * S / comprimento)
        b = min(1, (i * 2 + 1) * traco * S / comprimento)
        d.line([(x0 + (x1 - x0) * a, y0 + (y1 - y0) * a), (x0 + (x1 - x0) * b, y0 + (y1 - y0) * b)], fill=cor_, width=largura)


def caixa(img, op, box=None):
    x, y, w, h = box or op["box"]
    d = ImageDraw.Draw(img, "RGBA")
    raio = op.get("radius", 0) * S
    r = sc([x, y, x + w, y + h])
    r = [r[0], r[1], r[2] - 1, r[3] - 1]
    if op.get("fill"):
        d.rounded_rectangle(r, radius=raio, fill=cor(*op["fill"]))
    if op.get("gradient"):
        degrade(img, x, y, w, h, op.get("radius", 0), op["gradient"])
    bordas = op.get("borders")
    if not bordas:
        return
    lados = list(bordas.values())
    if len(bordas) == 4 and all(l == lados[0] for l in lados) and lados[0][1] != "dashed":
        largura, _, c = lados[0]
        d.rounded_rectangle(r, radius=raio, outline=cor(*c), width=max(1, round(largura * S)))
        return
    cantos = {"t": ((r[0], r[1]), (r[2], r[1])), "b": ((r[0], r[3]), (r[2], r[3])),
              "l": ((r[0], r[1]), (r[0], r[3])), "r": ((r[2], r[1]), (r[2], r[3]))}
    for lado, (largura, estilo, c) in bordas.items():
        lw = max(1, round(largura * S))
        (x0, y0), (x1, y1) = cantos[lado]
        meio = lw / 2
        if lado == "t":
            y0 = y1 = y0 + meio
        elif lado == "b":
            y0 = y1 = y0 - meio
        elif lado == "l":
            x0 = x1 = x0 + meio
        else:
            x0 = x1 = x0 - meio
        if estilo == "dashed":
            tracejado(d, (x0, y0), (x1, y1), cor(*c), lw)
        else:
            d.line([(x0, y0), (x1, y1)], fill=cor(*c), width=lw)


def foto(img, op):
    x, y, w, h = op["box"]
    caminho = FOTOS.get(op["key"])
    X, Y, Wp, Hp = [round(v) for v in sc([x, y, w, h])]
    raio = round(op.get("radius", 0) * S)
    if caminho:
        src = Image.open(caminho).convert("RGBA")
        vertical = 0.3 if h > w else 0.5  # retrato: priorizar o terço superior
        recorte = ImageOps.fit(src, (Wp, Hp), Image.Resampling.LANCZOS, centering=(0.5, vertical))
        mask = mascara_arredondada(Wp, Hp, raio) if raio else None
        img.paste(recorte, (X, Y), mask)
        return
    aviso(f"{op['key']} sem foto: desenhei a área hachurada de referência ({' · '.join(op['label'][:1])})")
    camada = Image.new("RGBA", (Wp, Hp), cor("mix:0.892"))
    d = ImageDraw.Draw(camada)
    passo = 28 * S
    for k in range(-Hp, Wp + Hp, passo):
        d.line([(k, 0), (k + Hp, Hp)], fill=cor("mix:0.775"), width=round(14 * S / math.sqrt(2) * 2) // 2)
    mask = mascara_arredondada(Wp, Hp, raio) if raio else None
    img.paste(camada, (X, Y), mask)
    if op["label"]:
        rotulo = op["label"][0].upper()
        f = fonte("body", 800, 22 * S)
        tw = f.getlength(rotulo)
        bw, bh = tw + 52 * S, 60 * S
        bx, by = X + (Wp - bw) / 2, Y + (Hp - bh) / 2
        dd = ImageDraw.Draw(img, "RGBA")
        dd.rounded_rectangle([bx, by, bx + bw, by + bh], radius=16 * S, fill=cor("dark"))
        dd.text((bx + bw / 2, by + bh / 2), rotulo, font=f, fill=cor("light"), anchor="mm")


def icone(img, op):
    d = ImageDraw.Draw(img, "RGBA")
    for tr in op["strokes"]:
        for parte in tr["parts"]:
            pts = [(px * S, py * S) for px, py in parte]
            if tr.get("fill") and len(pts) > 2:
                d.polygon(pts, fill=cor(*tr["fill"]))
            if tr.get("stroke"):
                c = cor(*tr["stroke"])
                lw = max(1, round(tr["width"] * S))
                d.line(pts, fill=c, width=lw, joint="curve")
                for px, py in (pts[0], pts[-1]):
                    d.ellipse([px - lw / 2, py - lw / 2, px + lw / 2, py + lw / 2], fill=c)


def segmentos(valor, op):
    """Texto com **trecho** usa o estilo de destaque do modelo (cor, itálico ou marca-texto)."""
    base = op["style"]
    destaque = op.get("emph") or base
    partes = re.split(r"\*\*(.+?)\*\*", str(valor))
    out = []
    for i, parte in enumerate(partes):
        if parte:
            out.append((parte, destaque if i % 2 else base))
    return out


def medir(txt, f, tracking):
    return f.getlength(txt) + tracking * len(txt)


def quebrar(segs, f, tracking, largura):
    linhas, atual, w_atual = [], [], 0.0
    for txt, estilo in segs:
        for palavra in re.findall(r"\S+\s*|\s+", txt):
            wp = medir(palavra, f, tracking)
            wp_sem_espaco = medir(palavra.rstrip(), f, tracking)
            if atual and w_atual + wp_sem_espaco > largura:
                linhas.append(atual)
                atual, w_atual = [], 0.0
                palavra = palavra.lstrip()
                if not palavra:
                    continue
                wp = medir(palavra, f, tracking)
            atual.append((palavra, estilo))
            w_atual += wp
    if atual:
        linhas.append(atual)
    return linhas


def largura_linha(linha, f, tracking):
    if not linha:
        return 0
    total = sum(medir(p, f, tracking) for p, _ in linha[:-1])
    return total + medir(linha[-1][0].rstrip(), f, tracking)


def escrever_trecho(img, x, baseline, txt, f, estilo, tracking, alpha_base=1):
    d = ImageDraw.Draw(img, "RGBA")
    c = cor(*estilo["color"]) if estilo.get("color") else cor("dark")
    largura = medir(txt, f, tracking)
    if estilo.get("highlight"):
        tok, alpha, frac = estilo["highlight"]
        asc, desc = f.getmetrics()
        altura = (asc + desc) * frac
        d.rectangle([x - 6 * S, baseline + desc - altura, x + medir(txt.rstrip(), f, tracking) + 6 * S, baseline + desc], fill=cor(tok, alpha))
    if estilo.get("italic"):
        # Itálico sintético: as fontes instaladas não trazem o corte itálico.
        asc, desc = f.getmetrics()
        pad = int(f.size * 0.3)
        cw, ch = int(largura + pad * 2), asc + desc
        camada = Image.new("RGBA", (cw, ch))
        escrever_trecho(camada, pad, asc, txt, f, dict(estilo, italic=False, highlight=None), tracking)
        inclinacao = 0.2
        camada = camada.transform(camada.size, Image.Transform.AFFINE, (1, inclinacao, -inclinacao * asc, 0, 1, 0), Image.Resampling.BICUBIC)
        img.alpha_composite(camada, (round(x - pad), round(baseline - asc)))
        return largura
    if tracking == 0:
        d.text((x, baseline), txt, font=f, fill=c, anchor="ls")
        return largura
    cx = x
    for ch_ in txt:
        d.text((cx, baseline), ch_, font=f, fill=c, anchor="ls")
        cx += f.getlength(ch_) + tracking
    return largura


def texto(img, op):
    valor = TEXTOS.get(op["key"], "")
    if not str(valor).strip():
        return
    if op["upper"]:
        valor = str(valor).upper()
    segs = segmentos(valor, op)
    cx, cy, cw, chh = op["content"]
    pt, pr, pb, pl = op["pads"]
    largura_max = op["maxW"] if op["hug"] else cw
    altura_max = max(chh, op["lineHeight"] * op["lines"])
    tamanho = op["size"]
    while True:
        escala = tamanho / op["size"]
        f = fonte(op["role"], op["weight"], round(tamanho * S))
        tracking = op["tracking"] * escala * S
        lh = op["lineHeight"] * escala
        linhas = quebrar(segs, f, tracking, largura_max * S)
        if len(linhas) * lh <= altura_max + 1 or tamanho <= op["size"] * 0.55:
            break
        tamanho *= 0.94
    if tamanho < op["size"]:
        aviso(f"{op['key']}: texto longo, reduzi a fonte de {op['size']:.0f}px para {tamanho:.0f}px")
    larguras = [largura_linha(l, f, tracking) / S for l in linhas]
    bloco_w = max(larguras) if larguras else 0
    bloco_h = len(linhas) * lh
    if op["hug"]:
        if op["anchor"] == "right":
            bx = cx + cw - bloco_w
        elif op["anchor"] == "center":
            bx = cx + (cw - bloco_w) / 2
        else:
            bx = cx
        area = [bx, cy, bloco_w, chh]
    else:
        area = [cx, cy, cw, chh]
    if op.get("bg"):
        ax, ay, aw, ah = area
        fundo = [ax - pl, ay - pt, aw + pl + pr, max(ah, bloco_h) + pt + pb]
        caixa(img, op["bg"], fundo)
    ax, ay, aw, ah = area
    y = ay
    if op.get("bg") and bloco_h < ah:
        y = ay + (ah - bloco_h) / 2
    asc, desc = f.getmetrics()
    for linha, lw in zip(linhas, larguras):
        if op["align"] == "center":
            x = ax + (aw - lw) / 2
        elif op["align"] == "right":
            x = ax + aw - lw
        else:
            x = ax
        baseline = y * S + (lh * S - (asc + desc)) / 2 + asc
        px = x * S
        for i, (parte, estilo) in enumerate(linha):
            if i == len(linha) - 1:
                parte = parte.rstrip()
            px += escrever_trecho(img, px, baseline, parte, f, estilo, tracking)
        y += lh


def desenhar():
    img = Image.new("RGBA", (W * S, H * S), cor("light"))
    for op in LAYOUT:
        tipo = op["op"]
        if tipo == "box":
            caixa(img, op)
        elif tipo == "photo":
            foto(img, op)
        elif tipo == "icon":
            icone(img, op)
        elif tipo == "text":
            texto(img, op)
    final = img.resize((W, H), Image.Resampling.LANCZOS).convert("RGB")
    final.save(OUTPUT, "PNG")
    abertos = [k for k, v in TEXTOS.items() if "[" in str(v)]
    if abertos:
        aviso("placeholders abertos: " + ", ".join(abertos))
    print(f"Salvo em {OUTPUT}")
    for a in _avisos:
        print("Aviso:", a)


desenhar()
