---
name: post-ad-mensagem-de-texto
description: "Formato de anúncio mensagem de texto — conversa fictícia de chat em dois balões, com o herói do negócio apoiado ao lado."
allowed-tools: paint create_post
---

# Formato de anúncio: mensagem de texto

- Objetivo: contar uma conversa curta de dois balões, com o herói ao lado.
- Herói: o que representa a oferta deste anúncio, escolhido pelo pedido e pelo arquivo da marca: produto, prato, pessoa, lugar ou objeto-símbolo do serviço (cartão, chave, ferramenta). Com foto do dono, passe-a em referenceImageIds e gere uma imagem nova (editOfImageId só corrige a peça gerada). Pessoa real só com foto dela. Sem foto, use só o que o dono confirmou.
- Adaptação (o celular e os balões ficam): café, grãos ou xícara, com "Quer o de sempre?"; banco ou seguro, cartão ou envelope com a cor da marca, nunca cédula; reparo, a peça ou ferramenta do serviço; dentista, cartão de agendamento e escova; loja de roupa, peça dobrada ou sacola da marca; escola, caderno sobre a mesa; app, cartão ou adesivo da marca.
- Composição: celular inteiro, de frente, à esquerda, quase toda a altura. Tela limpa com dois balões grandes: pergunta em cinza claro à esquerda, resposta na cor de destaque da marca à direita; sem barra de status ou digitação. [HERO] inteiro à direita, apoiado na mesa, de metade a toda a altura do celular. Fundo desfocado e neutro.
- Texto: (1) balões, até 6 palavras cada, o maior texto; (2) legenda "Conversa fictícia" no rodapé, se a conversa não for real; (3) assinatura, menor que os balões.
- Prompt-base: comece o prompt do paint por este texto, em inglês, preenchendo os campos entre colchetes com os fatos do pedido e do arquivo da marca (sem deixar colchetes); com foto do herói, passe-a em referenceImageIds e gere uma imagem nova: "Eye-level photo of a real smartphone upright on a wooden table, seen straight on, filling almost the full height of a [ASPECT_RATIO] frame on the left. Clean generic chat screen, no status bar, app name, avatar or send icon: a light grey bubble on the left reads '[QUESTION]', a [BRAND COLOR] bubble on the right reads '[ANSWER]', both large and sharp. On the right, [HERO] rests whole on the table, sharp, between half and full phone height, never floating. Blurred neutral background of [SETTING FROM THE HERO'S WORLD], warm side light, matte editorial finish. Small '[DISCLAIMER]' and '[SIGNATURE]' at the bottom margin. Only these four slots carry text; render exactly this text, nothing else."
- Revisão: Reprove e corrija com editOfImageId se: balão com palavra trocada, faltando ou repetida; legenda ausente numa conversa fictícia; celular ou balão cortado; o herói flutua, está cortado ou não toca a mesa; o herói ou os elementos não combinam com o negócio; tela com barra de status, nome de app, logo, avatar ou ícone de envio; texto ilegível a 360 px; dia, horário ou preço errados.
- Evite: nome de app, logo, avatar ou foto identificável, dados pessoais, cara de print real, marca ou interface de terceiros, depoimento, avaliação ou antes e depois.
- Fatos necessários: diálogo aprovado palavra por palavra; conversa real só com autorização de quem falou; o herói real (foto do dono) ou o que ele representa; dia, horário ou preço confirmados na marca.
- Propósito comum: comunidade, storytelling ou produto.
