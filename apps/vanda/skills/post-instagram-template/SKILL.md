---
name: post-instagram-template
description: Monta artes gráficas com texto para posts e carrosséis de Instagram usando o catálogo de templates Python/Pillow da Vanda. Use para criar qualquer post ou carrossel com layout estruturado, mesmo quando o dono não disser “template”.
allowed-tools: list read paint run_code create_post
---

# Post de Instagram a partir de modelo

Monta post único ou carrossel para profissional autônomo usando os modelos de layout da Vanda Studio e a identidade visual do cliente.

Tudo que está no canvas "Templates de post Instagram" está dentro desta skill. Todos os slides em 4:5, 1080×1350.

## Arquivos da skill

- `/skills/post-instagram-template/references/modelos.md`: ficha de cada um dos 141 slides, elemento por elemento, de cima para baixo. Depois de escolher no catálogo, leia somente as linhas indicadas com `offset` e `limit`.
- `/skills/post-instagram-template/references/diretrizes.md`: texto integral das notas do canvas (diretrizes de cor para a IA e legenda das áreas de foto).
- `/skills/post-instagram-template/assets/py/<ID>.py`: template Pillow completo e executável de cada slide. Leia somente os scripts escolhidos. Cada arquivo contém um cabeçalho editável e o motor de desenho.

IDs: `Main` e `S02` a `S20` (posts únicos), `C01` a `C12` (carrosséis, `C01-1` é a capa), `T01` a `T20` (posts só texto), `TC01` a `TC08` (carrosséis só texto).

## Catálogo compacto

Escolha aqui antes de ler fichas ou scripts. `Ficha` informa os parâmetros `offset` e `limit` para ler somente o trecho correspondente de `/skills/post-instagram-template/references/modelos.md`. Os scripts ficam em `/skills/post-instagram-template/assets/py/`.

### Posts únicos com layout visual

| ID | Use para | Script | Ficha |
|---|---|---|---|
| Main | apresentação com foto de fundo | `Main.py` | offset 13, limit 10 |
| S02 | citação com foto de fundo | `S02.py` | offset 23, limit 9 |
| S03 | dica rápida | `S03.py` | offset 32, limit 11 |
| S04 | mito x verdade | `S04.py` | offset 43, limit 12 |
| S05 | depoimento | `S05.py` | offset 55, limit 16 |
| S06 | dado de impacto | `S06.py` | offset 71, limit 11 |
| S07 | agenda aberta com foto de fundo | `S07.py` | offset 82, limit 12 |
| S08 | bastidores com foto de fundo | `S08.py` | offset 94, limit 9 |
| S09 | pergunta da semana | `S09.py` | offset 103, limit 10 |
| S10 | checklist | `S10.py` | offset 113, limit 24 |
| S11 | antes e depois | `S11.py` | offset 137, limit 17 |
| S12 | novidade com foto de fundo | `S12.py` | offset 154, limit 12 |
| S13 | data comemorativa com foto de fundo | `S13.py` | offset 166, limit 9 |
| S14 | frase tipográfica | `S14.py` | offset 175, limit 9 |
| S15 | pergunta frequente com foto de fundo | `S15.py` | offset 184, limit 9 |
| S16 | oferta | `S16.py` | offset 193, limit 12 |
| S17 | galeria | `S17.py` | offset 205, limit 20 |
| S18 | nova especialização com foto de fundo | `S18.py` | offset 225, limit 9 |
| S19 | evento ou palestra com foto de fundo | `S19.py` | offset 234, limit 15 |
| S20 | contato com foto de fundo | `S20.py` | offset 249, limit 13 |

### Carrosséis com layout visual

| ID | Use para | Scripts | Ficha |
|---|---|---|---|
| C01 | erros comuns, 5 slides, capa com foto | `C01-{1..5}.py` | offset 264, limit 73 |
| C02 | como funciona, 5 slides, capa com foto | `C02-{1..5}.py` | offset 337, limit 70 |
| C03 | mitos e verdades, 5 slides | `C03-{1..5}.py` | offset 407, limit 74 |
| C04 | perguntas frequentes, 5 slides, capa com foto | `C04-{1..5}.py` | offset 481, limit 70 |
| C05 | guia rápido, 5 slides | `C05-{1..5}.py` | offset 551, limit 63 |
| C06 | estudo de caso, 5 slides, capa com foto | `C06-{1..5}.py` | offset 614, limit 65 |
| C07 | sobre mim, 5 slides, capa com foto | `C07-{1..5}.py` | offset 679, limit 64 |
| C08 | serviços, 5 slides | `C08-{1..5}.py` | offset 743, limit 74 |
| C09 | lista de dicas, 6 slides | `C09-{1..6}.py` | offset 817, limit 75 |
| C10 | antes e depois, 4 slides | `C10-{1..4}.py` | offset 892, limit 54 |
| C11 | comparativo, 4 slides | `C11-{1..4}.py` | offset 946, limit 70 |
| C12 | depoimentos, 5 slides, capa com foto | `C12-{1..5}.py` | offset 1016, limit 79 |

### Posts somente com texto

| ID | Use para | Script | Ficha |
|---|---|---|---|
| T01 | manchete | `T01.py` | offset 1097, limit 8 |
| T02 | frase com destaque | `T02.py` | offset 1105, limit 8 |
| T03 | lista numerada | `T03.py` | offset 1113, limit 15 |
| T04 | pergunta e resposta | `T04.py` | offset 1128, limit 12 |
| T05 | pare x comece | `T05.py` | offset 1140, limit 11 |
| T06 | definição de dicionário | `T06.py` | offset 1151, limit 12 |
| T07 | nota | `T07.py` | offset 1163, limit 10 |
| T08 | números ou estatísticas | `T08.py` | offset 1173, limit 14 |
| T09 | passo a passo em um post | `T09.py` | offset 1187, limit 21 |
| T10 | opinião impopular | `T10.py` | offset 1208, limit 9 |
| T11 | lembrete do dia | `T11.py` | offset 1217, limit 10 |
| T12 | glossário | `T12.py` | offset 1227, limit 15 |
| T13 | sinais de alerta | `T13.py` | offset 1242, limit 17 |
| T14 | faça x não faça | `T14.py` | offset 1259, limit 20 |
| T15 | comunicado | `T15.py` | offset 1279, limit 10 |
| T16 | enquete A ou B | `T16.py` | offset 1289, limit 14 |
| T17 | carta ao cliente | `T17.py` | offset 1303, limit 9 |
| T18 | citação de estudo | `T18.py` | offset 1312, limit 8 |
| T19 | horário de atendimento | `T19.py` | offset 1320, limit 22 |
| T20 | pergunta retórica | `T20.py` | offset 1342, limit 9 |

### Carrosséis somente com texto

| ID | Use para | Scripts | Ficha |
|---|---|---|---|
| TC01 | thread ou texto corrido, 6 slides | `TC01-{1..6}.py` | offset 1353, limit 61 |
| TC02 | glossário, 5 slides | `TC02-{1..5}.py` | offset 1414, limit 61 |
| TC03 | pare de x e comece a, 5 slides | `TC03-{1..5}.py` | offset 1475, limit 65 |
| TC04 | checklist completo, 5 slides | `TC04-{1..5}.py` | offset 1540, limit 91 |
| TC05 | o que ninguém te conta, 5 slides | `TC05-{1..5}.py` | offset 1631, limit 61 |
| TC06 | faça x não faça, 5 slides | `TC06-{1..5}.py` | offset 1692, limit 76 |
| TC07 | linha do tempo, 5 slides | `TC07-{1..5}.py` | offset 1768, limit 61 |
| TC08 | mini-aula, 6 slides | `TC08-{1..6}.py` | offset 1829, limit 71 |

Canvas original, se tiver acesso: https://claude.ai/artifact/Si8wdVvrtTE4xUeAci6EyK

## Processo

1. Leia `/brand/kit.json` e `/brand/memory.md`. Use o catálogo acima para escolher o modelo. Só pergunte o que ainda for indispensável: tema, objetivo, formato, textos reais ou foto específica.
2. Consulte somente o trecho indicado de `/skills/post-instagram-template/references/modelos.md`, usando os valores exatos de `offset` e `limit`. Não leia o arquivo inteiro nem outros templates para comparar.
3. Leia `/skills/post-instagram-template/assets/py/<ID>.py`. Preserve `LAYOUT` e o motor; adapte apenas o cabeçalho `OUTPUT`, `CORES`, `FONTES`, `FOTOS` e `TEXTOS`. Remova todo placeholder antes da entrega ou informe claramente o que ficou aberto.
4. Passe o código Python completo adaptado para `run_code`. Inclua em `inputPaths` as fotos e documentos usados. Para carrossel, execute os slides na ordem e use nomes de saída ordenáveis.
5. Leia cada imagem produzida e confira conteúdo, marca, contraste, cortes, sobreposições e consistência entre slides. Corrija no máximo duas vezes, conforme as regras gerais da Vanda.
6. Quando o pedido for criar um post, use as imagens aprovadas em `create_post` e entregue um rascunho. Agendamento continua sendo uma ação separada.

Os scripts geram peças 1080×1350 em `/home/user/out/`. Não copie apenas parte do motor e não tente executar o caminho da skill como um módulo: leia o arquivo, adapte o cabeçalho e envie o código completo para `run_code`.

Área hachurada com selo "FOTO DO PROFISSIONAL AO FUNDO" pede retrato em sangria total, rosto no terço superior, texto embaixo sobre faixa escura. Se a foto não existir, gere o prompt com a skill prompt-foto-fiel. Outras áreas hachuradas são foto do trabalho ou retrato pequeno.

## Diretrizes de cor

Os modelos são cinza de propósito. Os cinzas são papéis, não cores.

| Cinza no modelo | Onde aparece | Vira na marca |
|---|---|---|
| Mais escuro | fundos escuros, títulos | cor escura principal |
| Claro de fundo | fundo da arte | fundo neutro ou claro |
| Médio de destaque | pílulas, números grandes, botões, check, sublinhado | cor de destaque |
| Intermediários | legendas, linhas, divisórias | neutros da paleta |

## Padrões para detectar e corrigir

### Cor

1. **Paleta inventada.** Sem identidade do cliente, a IA escolhe cores "bonitas". Pergunte antes. Nunca invente.
2. **Cinza copiado.** A arte final saiu cinza. Os cinzas são só papéis, troque pela tabela.
3. **Papel trocado entre slides.** Destaque verde no slide 2 e azul no slide 3. O mesmo papel usa a mesma cor em todos os slides e posts.
4. **Contraste fraco.** Texto claro em fundo claro, legenda cinza em fundo colorido. Escureça ou clareie até ler sem esforço.
5. **Efeito que a marca não usa.** Gradiente, brilho, sombra neon, textura. Tire.

### Tipografia

6. **Fonte do modelo mantida.** Troque pelas fontes da marca.
7. **Hierarquia achatada.** Título, subtítulo e apoio no mesmo tamanho. Mantenha a escala do modelo.

### Conteúdo

8. **Dado inventado.** Estatística, depoimento ou preço que ninguém forneceu. Vira placeholder entre colchetes.
9. **Colchete esquecido.** [Seu nome] publicado na arte final. Liste os abertos na entrega.
10. **Texto demais no slide.** Mais de uma ideia por slide de carrossel. Divida.

### Montagem

11. **Selo do modelo na arte.** "Modelo de layout" no rodapé. Remova.
12. **Carrossel sem fio.** Falta numeração 01/05, "Arraste" nos slides do meio ou chamada no último (salvar, enviar, direct ou link na bio). Coloque.
13. **Foto errada no lugar.** Foto do trabalho onde o modelo pede o profissional, ou o contrário. Confira o selo da área.

## Escrita

Português, direto. Sem travessão: use vírgula, dois pontos ou ponto.
