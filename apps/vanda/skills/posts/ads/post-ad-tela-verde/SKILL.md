---
name: post-ad-tela-verde
description: "Formato de anúncio tela verde — apresentador recortado na frente de uma cena com o herói atrás, estilo green screen de criador."
allowed-tools: paint create_post
---

# Formato de anúncio: tela verde

- Objetivo: simular um quadro estático de criador, com apresentador recortado na frente, cena do negócio atrás e herói visível. Não é vídeo.
- Herói: o que representa a oferta neste post, escolhido pelo pedido e pelo arquivo da marca: produto, prato, pessoa, lugar ou um objeto-símbolo do serviço (cartão, chave, ferramenta, documento). Com foto do dono, passe-a em referenceImageIds e gere uma imagem nova (editOfImageId só corrige a peça gerada). Pessoa real só com foto dela. Sem foto, descreva só o que o dono confirmou.
- Mundo do herói (a cena atrás): café, balcão e o prato ou a xícara; clínica, cadeira e bandeja de instrumentos; oficina, bancada, ferramenta e peça; banco, mesa limpa, pasta e cartão em branco na cor da marca (nunca cédulas nem gráficos); loja de roupa, arara e vitrine; escola, carteira e quadro.
- Composição: apresentador recortado da cintura para cima, 40% a 50% da altura, à esquerda, olhando para a câmera e apontando para o herói (fictício ou o dono). Herói inteiro, de frente, 30% a 40% da altura, à direita. Recorte sem halo; luz igual nos planos.
- Texto: até três slots: título (o maior, até 5 palavras), apoio com o nome do herói e um dado confirmado (até 6 palavras) e assinatura da marca (a menor). Sem dado confirmado, só título e marca.
- Prompt-base: comece o prompt do paint por este texto, em inglês, preenchendo os campos entre colchetes com os fatos do pedido e do arquivo da marca (sem deixar colchetes): "Static [ASPECT_RATIO] creator green-screen frame: [PRESENTER], cut out in sharp focus from the waist up, about 45% of frame height on the left, looking at the camera and gesturing toward [HERO]. Behind them, an inserted scene of [SCENE] with its own perspective, reading as a separate panel. On the right, [HERO] stands whole, front-facing, about 35% of frame height. Soft key light from the upper left matches on all planes; no halo. Matte materials, fine grain, high contrast. Text only in three slots: headline [HEADLINE] largest, support line [SUPPORT LINE] medium, brand signature [BRAND SIGNATURE] smallest in a free corner. Single still, no phone frame, no app interface, no green cast; render exactly this text, nothing else."
- Revisão: Reprove e corrija com editOfImageId se: o herói tem menos de 30% da altura ou está cortado; o apresentador cobre o herói; pessoa e cena parecem uma foto só; o gesto não aponta para o herói; há halo ou luz diferente nos planos; o herói ou os elementos da cena não combinam com o negócio; aparecem cédulas ou gráficos em serviço financeiro; há mais de três textos ou símbolo sobre a assinatura; letra errada no nome; cópias extras do herói; chroma verde chapado.
- Evite: chroma verde cru, moldura de celular, interface de app ou editor, locução, depoimento, avaliação, resultado, dado, estoque, oferta ou preço inventados, alegação de saúde, marca ou interface de terceiros, pessoa real sem foto do dono.
- Fatos necessários: nome exato do herói, o que a cena mostra e qualquer fala ou dado aprovado; preço só se confirmado.
- Propósito comum: produto ou educacional.
