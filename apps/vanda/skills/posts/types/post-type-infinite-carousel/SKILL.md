---
name: post-type-infinite-carousel
description: "Tipo de post carrossel infinito (contínuo, panorâmico, conectado, emendado, em loop, seamless): mais apelo visual que o carrossel comum — impacto, deslize e uma cena única —, com menos texto por slide; para informar muito (dados, passos, comparações), o carrossel comum é melhor. Acabamento profissional: uma só cena cortada em até 5 slides, um herói grande (personagem, produto, objeto 3D) sentado no corte 1→2, ambiente contínuo, satélites atravessando os outros cortes, progresso em %. Post tipo carrossel infinito, type carousel, format 4:5 ou 1:1: slide 1 em paint e os seguintes por extend_infinite_carousel."
allowed-tools: list read paint extend_infinite_carousel weave_infinite_carousel create_post
---

# Carrossel infinito (type carousel)

Uma imagem larga cortada em slides iguais, no nível dos melhores carrosséis infinitos: um **herói grande sentado num corte**, um ambiente contínuo atrás de tudo, satélites nos outros cortes, texto que nunca encosta num corte e um contador de progresso em %. Serve para qualquer assunto e estilo (personagem, produto, comida, carro, mascote, objeto 3D, tela de app), não só espaço.

- **Força:** é o carrossel de maior apelo visual. A cena contínua prende o deslize, o slide 1 para a rolagem no feed e o conjunto parece uma peça premium. Use quando o objetivo é chamar atenção, marcar a marca ou apresentar um produto ou ideia com impacto.
- **Limite:** transmite menos informação que o carrossel comum. São até 5 slides, cada um com um título curto e no máximo 25 palavras, numa coluna estreita. Se a mensagem precisa de muitos dados, passos, comparações ou explicações, o carrossel comum serve melhor. Diga isso ao dono quando ele pedir um infinito com muito conteúdo, e ofereça cortar o texto ou usar o comum.

```
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ SLIDE 1 ╳│╳ SLIDE 2 │ SLIDE 3  │ SLIDE 4  │ SLIDE 5  │
└────HERÓI─┴────◉─────┴──────────┴────◉─────┴────◉─────┘
 corte 1→2 = herói · demais cortes = satélites · o corte 5→1 é a volta
```

## Anatomia de um carrossel de referência

| Elemento          | O que os bons fazem                                                                                                                       | Números (em % do slide)                                                                                                                                                     |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Herói             | UM sujeito grande com o centro visual exatamente no corte 1→2: o slide 1 mostra uma parte, o slide 2 o resto, e o olho quer deslizar      | ~55–70% da altura, apoiado embaixo e saindo pela borda inferior; o corte passa pela parte mais rica e simples (tronco, capacete, garrafa, porta do carro), nunca pelo rosto |
| Ambiente          | uma cena contínua na tela inteira; mudança de ambiente (claro → escuro, dentro → fora) em **diagonal** dentro de um slide, nunca no corte | horizonte e luz na mesma % da altura em todos os slides                                                                                                                     |
| Satélites         | um objeto por corte restante, alternando em cima e embaixo, com brilho e sombra, nas cores do kit (ou da paleta proposta)                 | 20–30% da altura; nunca dois seguidos na mesma altura                                                                                                                       |
| Plano médio       | um planeta, forma ou objeto grande desfocado, meio fora do quadro                                                                         | desfoque leve; dentro do slide, longe das bordas                                                                                                                            |
| Evidência         | prints, telas, gráficos em cartão com sombra e uma seta ou nota escrita à mão                                                             | na coluna de texto                                                                                                                                                          |
| Texto             | título condensado em caixa alta na cor de destaque; corpo arredondado e legível; uma palavra-chave colorida por parágrafo                 | título grande (gancho maior que os internos), corpo legível no celular, coluna estreita                                                                                     |
| Progresso e marca | "0%… 100%" pequeno e discreto; @perfil pequeno                                                                                            | embaixo e em cima, centralizados                                                                                                                                            |
| Cortes            | todos contínuos, inclusive a volta do último para o primeiro                                                                              | nota perto de 0                                                                                                                                                             |

## Como o gerador funciona (leia antes de planejar)

A cena é pintada **em cadeia**, da esquerda para a direita, e cada slide nasce como continuação real do anterior:

1. **Slide 1** com `paint`: a peça completa, com o herói saindo pela borda direita.
2. **Slides 2…N** com `extend_infinite_carousel`, um por chamada. A ferramenta continua a cena a partir da metade direita do slide anterior, com a ponte atravessando o corte (no 1→2, o resto do herói). Depois completa o novo slide com o texto dele. Quando o novo slide é o último (`total`), a ferramenta fecha a volta N→1 com `loopBridge`.

Cada chamada repinta a borda direita do slide anterior e devolve a **cadeia inteira com novos imageIds**. Use sempre a cadeia devolvida, tanto na chamada seguinte quanto no `create_post`.

Faixas que a ferramenta repinta (o que estiver nelas muda):

- **corte 1→2 (herói):** 30% da direita do slide 1 e 30% da esquerda do slide 2;
- **demais cortes e a volta N→1:** 20% de cada lado.

**Orçamento de etapas e de tempo (obrigatório):** a resposta inteira tem cerca de 10 minutos, e cada slide da cadeia leva por volta de 1,5 min.

- Leia esta skill, post-production, a do propósito e `/brand/kit.json` uma vez só. Não leia imagens antigas da galeria nem posts anteriores, a menos que o dono peça.
- Pesquisa web: no máximo 1 busca e 1 leitura, e só se o tema exigir dado atual.
- Busque `carrossel infinito` no tool_search para ter `extend_infinite_carousel`.
- Depois: 1 `paint` (slide 1), N−1 `extend_infinite_carousel` e `create_post`. As chamadas intermediárias não trazem prévia; a única prévia vem quando a volta fecha. Não use `read` nos slides, nem entre as chamadas nem depois.
- **Chat objetivo:** não narre etapas nem comente slides intermediários. Fale com o dono só em duas horas: uma linha com o plano antes de pintar (tema, estilo, herói, número de slides) e a entrega no fim.
- Não repinte slides para corrigir detalhes: cada repintura quebra a cadeia.

## 0. Marca (obrigatório, antes do plano)

O carrossel é da marca, não da skill. O contexto da marca já está na conversa: memória (identidade, voz, público, restrições), kit e notas.

- Leia `/brand/kit.json` e `list /brand/references`.
- **Kit com cores ou fontes:** a ficha de estilo usa só essas cores (fundo, destaques, satélites, título) e só essas fontes, com os hex exatos. A direção de estilo da tabela define apenas a cena e a luz, nunca a paleta nem as fontes. `extend_infinite_carousel` já anexa o kit a cada slide, mas o slide 1 (`paint`) depende de você escrever os hex e as fontes no prompt: a cena continua com as cores e a tipografia do slide 1, então um slide 1 fora do kit deixa o carrossel inteiro fora do kit.
- **Kit vazio:** proponha uma paleta sóbria (2–3 cores em hex) coerente com a voz e o setor da memória. Diga na linha do plano que é uma proposta, não a paleta oficial. Nunca apresente cores inventadas como "da marca". Na entrega, ofereça em uma frase salvar a paleta no kit.
- **Referências:** imagens de estilo ou produto em `/brand/references` entram em `referenceImageIds` no `paint` do slide 1 (estilo, luz, produto real). Rosto de pessoa só se a referência for daquela pessoa.
- **Assinatura:** o nome da marca (ou o @perfil) em texto pequeno e discreto. Nunca invente um logo nem símbolo.
- **Voz e restrições da memória** valem para o herói, a cena e o texto (por exemplo: sem tom sensacionalista, sem prometer resultado, pessoas só com contexto). Se uma restrição bater de frente com o herói planejado, troque o herói.

## 1. Briefing: deduza, não interrogue

- Tema, mensagem, público e idioma (todo texto no idioma do dono).
- **Slides:** **4 por padrão** (gancho, 2 ideias, CTA); 5 só se o dono pedir mais; mínimo 3. Com mais ideias, junte ou escolha as mais fortes.
- **Format:** 4:5 por padrão (ocupa mais tela); 1:1 só se pedirem.
- **Herói:** um sujeito concreto ligado ao tema. Se o pedido exigir algo real e específico (um produto, uma pessoa) e você não souber como ele é, pergunte uma vez, junto com a direção de estilo. Nunca reproduza arte de outro perfil nem o rosto de uma pessoa real.
- **Estilo:** escolha a direção da tabela que melhor combina com a voz, o setor e o kit da marca, e diga em uma linha (com a paleta). O cinematográfico escuro é uma opção, não o padrão. Todo estilo tem herói e satélites: um carrossel infinito sem herói é um carrossel comum.

## 2. Plano (escreva antes de pintar)

1. **História:** slide 1 gancho (até 8 palavras + "arraste →"), uma ideia por slide (título até 6 palavras, corpo até 25), último slide CTA (salvar, comentar, seguir) + "↺ volte ao início".
2. **Herói:** sujeito, pose (levemente virado para o lado do texto), altura (55–70%), por onde o corte passa (área grande e simples). Proibido como herói ou ponte: objetos com números, letras, ponteiros ou detalhes exatos (relógio com mostrador, calendário, placa, tela com texto, moeda, gráfico, documento). O modelo não continua esses detalhes através do corte e eles saem errados. Prefira formas grandes e lisas: personagem, produto, escultura, planta, veículo, esfera, objeto 3D sem inscrição. Um relógio só serve sem algarismos nem ponteiros.
3. **Mapa de cortes:** uma linha por corte, variando objeto, tamanho e altura. Exemplo para 5 slides:
   `1→2 HERÓI astronauta de traje branco, corpo inteiro, ~65% da altura, apoiado embaixo · 2→3 esfera laranja brilhante no terço superior · 3→4 esfera azul no terço inferior · 4→5 asteroide no terço superior · 5→1 VOLTA esfera grande no meio`.
4. **Ficha de estilo:** ambiente, luz, técnica (foto, 3D, ilustração), horizonte em %, a paleta em hex e as fontes. Paleta e fontes vêm do kit; sem kit, use a paleta proposta e uma condensada para título + uma sans legível. Ela vai igual no `paint` do slide 1 e em toda chamada (`style`).

## 3. Regras de design

1. **Herói no corte 1→2:** um só por carrossel, nascido no slide 1 e continuado no slide 2 pela ferramenta.
2. **Toda costura tem uma ponte:** o herói no 1→2 e um satélite em cada um dos outros cortes, inclusive a volta. Satélites com 20–30% da altura, alternando cima e baixo, sem texto nem logo.
3. **Ambiente contínuo:** o fundo encosta nas quatro bordas de todo slide. Proibido: moldura, vinheta, recorte de papel, mapa ou silhueta fechada, figura isolada no centro. Mudança de ambiente só em diagonal, dentro de um slide.
4. **Ordem de profundidade** (de trás para a frente): ambiente → véu → brilho → plano médio desfocado → herói → satélites → cartões de evidência → texto → progresso e @perfil. Quanto mais longe, mais desfoque; o herói é nítido.
5. **Colunas de texto** (fora das faixas repintadas):
   - slide 1: entre 22% e 60% da largura (a direita é do herói, a esquerda recebe a volta);
   - slide 2: entre 40% e 72% (a esquerda é do herói);
   - demais slides: entre 24% e 72%.
     A ferramenta já posiciona o texto dos slides 2…N. Você só escreve o conteúdo.
6. **Evidência** (prints, gráficos, telas de celular): na coluna de texto, em cartão com sombra, com uma seta desenhada ou uma nota curta em letra cursiva.
7. **Progresso e marca:** "0%", "33%", "67%", "100%" (4 slides; com 5, "0%", "25%", "50%", "75%", "100%"), pequeno, embaixo e centralizado; @perfil pequeno em cima, centralizado.
8. **Miniatura da grade:** o slide 1 é recortado em 3:4 no perfil; o gancho fica longe das laterais.

### Direções de estilo

| Estilo                 | Ambiente                                                                | Herói                                                 | Satélites                                   | Tipografia (sem kit)                                      |
| ---------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------- |
| Cinematográfico escuro | espaço profundo com nebulosa e estrelas, ou foto escurecida e desfocada | personagem ou produto renderizado com luz de contorno | esferas brilhantes, planetas                | condensada (tipo Bebas Neue) + arredondada (tipo Poppins) |
| Vitrine de produto     | degradê suave nas cores do kit ou cor lisa                              | o produto, recortado, com sombra suave                | o produto em outros ângulos, pílulas de cor | grotesca pesada + sans limpa                              |
| Editorial claro        | papel com granulado e um bloco de cor em diagonal                       | pessoa ou objeto com sombra dura                      | letras gigantes, anéis                      | condensada pesada + sans editorial                        |
| Panorama fotográfico   | uma foto contínua, levemente desfocada                                  | sujeito da mesma sessão de fotos                      | janelas com foto em arco                    | sans limpa                                                |
| Tech / UI              | espaço azulado com textura de grade                                     | celular ou notebook mostrando a tela                  | nós e esferas luminosas                     | geométrica + mono                                         |

## 4. Slide 1 (`paint`)

Um prompt com a ficha de estilo (hex e fontes do kit, ou a proposta), as referências da marca em `referenceImageIds`, `aspectRatio` no format escolhido e:

- **o herói com o centro visual exatamente na borda direita**, cortado por ela: só a metade esquerda dele aparece, ocupando no máximo os 35% da direita do slide (de 65% a 100% da largura). A outra metade fica para o slide 2. Ele tem ~55–70% da altura, apoiado embaixo, e o corte passa pelo tronco ou pela lateral, nunca pelo rosto;
- o gancho e "arraste →" na coluna de 22% a 60%, progresso "0%" embaixo no centro, @perfil em cima no centro;
- **texto nunca sobre o herói, pessoas ou objetos:** escreva no prompt que entre a última letra e o herói fica um vão livre de pelo menos 4% da largura, e que, se faltar espaço, o texto diminui ou sobe (o herói nunca vai para trás do texto);
- os 20% da esquerda só com o ambiente continuando (a volta repinta ali);
- o fundo encostando nas quatro bordas, sem moldura nem cartão.

Inspecione antes de seguir. Se o herói não estiver cortado pela borda direita, repinte uma vez: sem isso não há continuidade.

## 5. Slides 2…N (`extend_infinite_carousel`)

Uma chamada por slide, em ordem:

- `imageIds`: a cadeia devolvida pela chamada anterior (na primeira, só o slide 1);
- `bridge`: no corte 1→2, o herói descrito exatamente como no slide 1; nos outros, o satélite do mapa, com cor, material, brilho, sombra e altura (_"esfera laranja brilhante, reflexo branco no alto à esquerda, halo suave, no terço superior"_);
- `content`: os textos exatos do slide (título, corpo, progresso em %) e a evidência, se houver;
- `style`: a ficha de estilo;
- `total`: quantos slides o carrossel terá (3 a 5), igual em toda chamada;
- `loopBridge`: o satélite da volta N→1, igual em toda chamada. A ferramenta só o pinta quando o novo slide é o último, e então fecha a volta sozinha.

As chamadas intermediárias devolvem só a cadeia e a nota do corte (perto de 0 = invisível). A chamada que fecha a volta traz a única prévia em faixa.

## 6. Revisão

1. **Prévia em faixa:** o herói atravessa o corte 1→2 inteiro e reconhecível; cada satélite atravessa o seu corte; a volta N→1 é contínua; nenhum degrau de cor ou horizonte desalinhado; nenhum slide parece cartão.
2. **Cada slide sozinho** carrega a sua mensagem; o slide 1 vende o deslize.
3. **Texto** exato, legível e fora das bordas. Use `read` num imageId só se precisar ver um slide de perto.

**Conserto (no máximo 1):** só se a prévia final mostrar um salto visível (objeto partido, degrau de cor), use `weave_infinite_carousel` com a cadeia final, uma ponte por corte e `onlySeams` com o número dele (1 = herói, N = volta). Nota alta sem salto visível não precisa de conserto. Se ainda houver salto, diga ao dono qual corte.

### Falhas comuns

| Sintoma                               | Correção                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| O herói não continua no slide 2       | O slide 1 não cortou o herói na borda direita: repinte o slide 1 antes de qualquer extensão                           |
| Corte do herói cai no rosto           | Descreva a pose "de perfil, o corte passa pelo tronco" no slide 1                                                     |
| Slides parecem cartões separados      | Moldura, vinheta ou figura fechada no slide 1: a cadeia copia o estilo, então corrija o slide 1                       |
| Volta N→1 com salto                   | Os 20% da esquerda do slide 1 tinham objeto ou texto: conserte com `onlySeams: [N]`                                   |
| Texto cortado ou apagado na borda     | O texto estava fora da coluna; no slide 1, mantenha-o entre 22% e 60%                                                 |
| Texto sobre o herói                   | No slide 1, o herói só nos 35% da direita e o vão de 4% escrito no prompt; nos seguintes, a ferramenta já exige o vão |
| Números ou ponteiros errados no herói | O herói tinha detalhes exatos (relógio, placa, tela): troque por uma forma lisa, sem inscrição                        |

## 7. Entrega

`create_post` com type carousel, o format usado e os imageIds da **última cadeia devolvida**, na ordem (nunca a prévia). Legenda com o essencial nos primeiros 125 caracteres. A mensagem ao dono tem no máximo 3 frases curtas: o que foi criado (tema, número de slides, rascunho salvo), por que esse tipo, propósito e format, e que a publicação é na ordem numérica. Com kit vazio, a terceira frase oferece salvar a paleta usada no kit. Sem repetir a legenda nem listar etapas.

## Método manual (Canva, Figma, Photoshop)

Se o dono quiser montar sozinho:

1. Criar design → tamanho personalizado: largura 1080 × número de slides (5 slides = 5400), altura 1350.
2. Réguas e uma guia vertical a cada 1080 px.
3. Um fundo só para a tela inteira (para uma foto em loop: duplicar, espelhar na horizontal e colocar lado a lado).
4. Herói sem fundo com o centro numa guia; uma esfera ou objeto em cada outra guia, alternando cima e baixo; para a volta, um objeto meio para fora da borda direita e uma cópia meio para fora da borda esquerda, na mesma altura.
5. Texto dentro de cada slide, a 80 px das guias; progresso em % embaixo; @perfil em cima.
6. Baixar em PNG e dividir em N colunas iguais (divisor de imagem: colunas = N, linhas = 1; no Figma, N frames sem espaço).
7. Publicar na ordem, num único carrossel.
