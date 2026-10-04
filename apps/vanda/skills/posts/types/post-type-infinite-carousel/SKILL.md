---
name: post-type-infinite-carousel
description: "Carrossel infinito (contínuo, panorâmico, seamless, loop): slides que formam uma só cena ao deslizar, com arte atravessando cada corte e o último voltando ao primeiro. type carousel, format 4:5 ou 1:1."
allowed-tools: read paint create_post
---

# Carrossel infinito (type carousel)

Uma única cena larga dividida em slides: ao deslizar parece que a câmera passeia pela mesma imagem, e o fim do último slide continua no começo do primeiro. Força: chama atenção e prende o deslize. Limite: pede mais planejamento e mais revisão que um carrossel comum.

## Como o paint se comporta (leia antes de planejar)

`paint` gera cada slide separadamente. A referência passa o estilo, mas o modelo NÃO copia os pixels da borda. Por isso:

- Objeto geométrico cortado ao meio nunca casa: cada slide fecha a sua metade como forma inteira, e o corte vira bico ou "folha". Relógio, moeda, círculo, arco, letra, número, gráfico de barras, ponteiros, símbolos, prédios com janelas, pessoas e produtos NÃO servem de ponte.
- O que casa: fundo liso igual, faixas horizontais com altura e cor exatas, e formas orgânicas em que pequenas diferenças parecem naturais.
- Editar com `editOfImageId` regenera o slide inteiro e pode criar uma nova quebra. Não use edição para "consertar" um corte.

## Plano antes de pintar

- Quantidade: lista de k itens → k + 2 slides (gancho, itens, CTA). Sem lista, 5 slides. Use de 3 a 10; o loop funciona melhor entre 5 e 8.
- Slide 1: gancho de até 8 palavras e "arraste →". Slides do meio: uma ideia cada (número grande opcional, título de até 6 palavras, corpo de até 20). Último: CTA (salvar, seguir, comentar) e "↺ volte ao início".
- Format: 4:5 (padrão) ou 1:1, o mesmo em todos os slides.
- Escreva uma **ficha de continuidade** e cole-a LITERALMENTE em todo prompt:
  1. **Fundo:** uma cor lisa (hex) ou um degradê só vertical, de cima para baixo, com os mesmos hex e posições. Sem vinheta, sem luz ou sombra nas bordas, sem moldura, sem degradê horizontal, sem céu com nuvens variando.
  2. **Espinha:** 1 ou 2 faixas horizontais contínuas que atravessam todos os slides de borda a borda (estrada, rio, fita, onda larga, trilho, chão), com cor hex e posição em % da altura fixas, por exemplo "fita #7D9AAA de 66% a 72% da altura, reta e lisa, tocando as duas bordas". É a principal ponte.
  3. **Perfil das bordas:** de cima para baixo, o que aparece na coluna de cada borda (faixas com % e hex). Bordas esquerda e direita de TODOS os slides têm exatamente esse perfil, inclusive a volta do último para o primeiro.
- **Pontes extras** (opcionais, uma por corte, variadas): só formas orgânicas sem contorno exato, como nuvens, folhagem, ondas, fumaça, morros, plantas, tecido ou fitas onduladas, vindas de dentro de um slide e se dissolvendo na espinha antes da borda. Elas dão vida à cena; a continuidade fica com o fundo e a espinha.

## Pintura em sequência

1. Pinte o slide 1 com a ficha de continuidade e inspecione. Confira se o fundo e a espinha batem com a ficha nas duas bordas.
2. Pinte os slides seguintes com a mesma ficha e só o slide anterior em `referenceImageIds`; no último, o anterior e o slide 1. Diga que a referência serve para estilo, luz e escala, e que as bordas seguem a ficha.
3. Nos 15% de cada lado de cada slide só podem existir fundo, espinha e formas orgânicas. Nada de texto, símbolo, ícone, objeto de contorno definido ou detalhe fino.
4. Texto e elementos com significado (gráfico, produto, pessoa, ícone) ficam na área central, longe das bordas, sobre área calma ou cartão sólido.

## Revisão

- Compare as bordas de cada par vizinho e do par último → primeiro: mesma cor de fundo, espinha na mesma altura e espessura, nenhuma forma partida nem bico no corte, nenhuma faixa de luz ou sombra na borda.
- Cada slide precisa funcionar sozinho. O slide 1 funciona como capa e como miniatura da grade (recorte 3:4 no centro).
- Se um corte falhar, repinte do zero só um dos slides vizinhos com a ficha mais simples (menos faixas, sem pontes extras perto da borda). Máximo de duas rodadas; se ainda houver salto, diga ao dono qual corte e por quê. Não entregue como infinito um carrossel com quebras visíveis.

## Entrega

`create_post` com type carousel, o format usado e os imageIds na ordem. Legenda com o essencial nos primeiros 125 caracteres. Diga ao dono para manter a ordem: o efeito infinito aparece ao deslizar do último de volta ao primeiro. Diga também que, gerando slide a slide, a continuidade é muito boa, mas não perfeita pixel a pixel.

Se o dono quiser montar sozinho (Canva, Figma): tela de largura 1080 × número de slides e altura 1350 (ou 1080), guias a cada 1080 px, um só fundo, formas atravessando cada guia, uma forma meio para fora da borda direita copiada meio para fora da esquerda na mesma altura, texto a 80 px das guias, exportar e dividir em partes iguais. Esse caminho dá continuidade perfeita.
