---
name: post-instagram-template
description: "Monta posts e carrosséis de Instagram com 141 templates Python/Pillow. Use sempre que o pedido corresponder a um formato estruturado disponível, mesmo sem mencionar ‘template’: mito x verdade, checklist, depoimento, comparativo, antes e depois, glossário, passo a passo, perguntas frequentes, lista, oferta, comunicado, enquete, mini-aula ou carrossel. Também use quando o dono pedir template ou layout preciso."
allowed-tools: list read paint run_code create_post
---

# Post de Instagram a partir de modelo

Monta post único ou carrossel para profissional autônomo usando os modelos de layout da Vanda Studio e a identidade visual do cliente.

Tudo que está no canvas "Templates de post Instagram" está dentro desta skill. Todos os slides em 4:5, 1080×1350.

## Arquivos da skill

- `/skills/post-instagram-template/references/modelos.md`: ficha de cada um dos 141 slides, elemento por elemento, de cima para baixo (textos fixos, placeholders, tamanho em px, peso, serifa ou sans, papel da cor, áreas de foto, ícones, cartões, blocos de fundo). Consulte só a ficha do modelo que vai usar.
- `/skills/post-instagram-template/references/diretrizes.md`: texto integral das notas do canvas (diretrizes de cor para a IA e legenda das áreas de foto).
- `/skills/post-instagram-template/assets/py/<ID>.py`: template Pillow completo e executável de cada slide. Leia somente os scripts escolhidos. Cada arquivo contém um cabeçalho editável e o motor de desenho.

IDs: `Main` e `S02` a `S20` (posts únicos), `C01` a `C12` (carrosséis, `C01-1` é a capa), `T01` a `T20` (posts só texto), `TC01` a `TC08` (carrosséis só texto).

Canvas original, se tiver acesso: https://claude.ai/artifact/Si8wdVvrtTE4xUeAci6EyK

## Processo

1. Leia `/brand/kit.json`, `/brand/memory.md` e as referências relevantes. Só pergunte o que ainda for indispensável: tema, objetivo, formato, textos reais ou foto específica.
2. Escolha o modelo pela lista abaixo e consulte somente seu trecho em `/skills/post-instagram-template/references/modelos.md`.
3. Leia `/skills/post-instagram-template/assets/py/<ID>.py`. Preserve `LAYOUT` e o motor; adapte apenas o cabeçalho `OUTPUT`, `CORES`, `FONTES`, `FOTOS` e `TEXTOS`. Remova todo placeholder antes da entrega ou informe claramente o que ficou aberto.
4. Passe o código Python completo adaptado para `run_code`. Inclua em `inputPaths` as fotos e documentos usados. Para carrossel, execute os slides na ordem e use nomes de saída ordenáveis.
5. Leia cada imagem produzida e confira conteúdo, marca, contraste, cortes, sobreposições e consistência entre slides. Corrija no máximo duas vezes, conforme as regras gerais da Vanda.
6. Quando o pedido for criar um post, use as imagens aprovadas em `create_post` e entregue um rascunho. Agendamento continua sendo uma ação separada.

Os scripts geram peças 1080×1350 em `/home/user/out/`. Não copie apenas parte do motor e não tente executar o caminho da skill como um módulo: leia o arquivo, adapte o cabeçalho e envie o código completo para `run_code`.

## Modelos

**Único, com foto do profissional ao fundo.** Apresentação, citação, agenda aberta, bastidores, novidade, data comemorativa, pergunta que mais recebo, nova especialização, evento, contato.

**Único, sem foto do profissional.** Dica rápida, mito x verdade, depoimento, dado de impacto, pergunta da semana, checklist, antes e depois, frase tipográfica, oferta, galeria.

**Único, só texto.** Manchete, frase com destaque, lista numerada, pergunta e resposta, pare x comece, definição de dicionário, post estilo nota, em números, passo a passo, opinião impopular, lembrete do dia, glossário, sinais de alerta, faça x não faça, comunicado, enquete A ou B, carta ao cliente, citação de estudo, horário de atendimento, pergunta retórica.

**Carrossel, capa com foto do profissional.** Erros comuns, como funciona, perguntas frequentes, estudo de caso, sobre mim, depoimentos.

**Carrossel, sem foto.** Mitos e verdades, guia rápido, serviços, lista de dicas, antes e depois, comparativo.

**Carrossel, só texto.** Thread, glossário, pare x comece, checklist completo, o que ninguém te conta, faça x não faça, linha do tempo, mini-aula.

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
