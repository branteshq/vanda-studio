---
name: post-type-infinite-carousel
description: "Carrossel infinito (contínuo, panorâmico, seamless, loop): slides que formam uma só cena ao deslizar, com arte atravessando cada corte e o último voltando ao primeiro. type carousel, format 4:5 ou 1:1."
allowed-tools: read paint create_post
---

# Carrossel infinito (type carousel)

Uma única cena larga dividida em slides: ao deslizar parece que a câmera passeia pela mesma imagem, e o fim do último slide continua no começo do primeiro. Força: chama atenção e prende o deslize. Limite: pede mais planejamento e mais revisão que um carrossel comum.

## Plano antes de pintar

- Quantidade: lista de k itens → k + 2 slides (gancho, itens, CTA). Sem lista, 5 slides. Use de 3 a 10; o loop funciona melhor entre 5 e 8.
- Slide 1: gancho de até 8 palavras e "arraste →". Slides do meio: uma ideia cada (número grande opcional, título de até 6 palavras, corpo de até 20). Último: CTA (salvar, seguir, comentar) e "↺ volte ao início".
- Escolha UM mundo contínuo: paisagem, cenário, linha ou caminho que atravessa tudo. Mesma luz, paleta, linha do horizonte na mesma altura e mesmo estilo em todos os slides. Imagens ricas (foto, ilustração, 3D) funcionam melhor que formas chapadas.
- Planeje uma ponte por corte, inclusive a volta (último → primeiro): um objeto grande (25–45% da altura) cortado ao meio pelo corte — metade sai pela borda direita de um slide e a outra metade entra pela borda esquerda do seguinte. Varie o tipo e o tamanho das pontes.
- Format: 4:5 (padrão) ou 1:1, o mesmo em todos os slides.

## Pintura em sequência

1. Pinte o slide 1 e inspecione. No prompt, diga que ele é o primeiro trecho de um panorama, descreva o que está na borda esquerda (a metade final da ponte de volta) e na borda direita (a metade inicial da ponte 1→2), com cor de fundo e altura do horizonte.
2. Para cada slide seguinte, passe o slide anterior em `referenceImageIds` e diga: "a borda esquerda continua exatamente a borda direita da referência", repetindo a descrição da ponte, da cor de fundo e do horizonte naquele ponto. Inclua também o slide 1 como referência de estilo.
3. No último slide, passe o penúltimo e o slide 1: a borda direita deve continuar na borda esquerda do slide 1.

Texto fica na coluna central (cerca de 60% da largura), longe das bordas e das pontes, sobre área calma ou cartão sólido. Nada de texto cruzando um corte.

## Revisão

- Compare cada par vizinho e o par último → primeiro: fundo, horizonte e ponte precisam continuar sem salto, degrau de cor ou objeto desalinhado.
- Cada slide precisa funcionar sozinho; nenhum slide pode ser só "meio objeto" sem mensagem.
- O slide 1 funciona como capa e como miniatura da grade (recorte 3:4 no centro).
- Para um corte ruim, refaça só um dos dois slides vizinhos com `editOfImageId`, passando o outro como referência e descrevendo a borda que deve casar. Máximo de duas rodadas; se ainda houver salto, diga ao dono onde.

## Entrega

`create_post` com type carousel, o format usado e os imageIds na ordem. Legenda com o essencial nos primeiros 125 caracteres. Diga ao dono para manter a ordem: o efeito infinito aparece ao deslizar do último de volta ao primeiro.

Se o dono quiser montar sozinho (Canva, Figma): tela de largura 1080 × número de slides e altura 1350 (ou 1080), guias a cada 1080 px, um só fundo em degradê, formas atravessando cada guia, uma forma meio para fora da borda direita copiada meio para fora da esquerda na mesma altura, texto a 80 px das guias, exportar e dividir em partes iguais.
