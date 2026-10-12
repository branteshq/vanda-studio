---
name: post-ad-depoimento
description: "Formato de anúncio depoimento — testemunho real de cliente em citação grande, com identificação autorizada e o item ao lado."
allowed-tools: paint create_post
---

# Formato de anúncio: depoimento

- Objetivo: destacar uma fala real e autorizada de cliente.
- Herói: a fala literal do cliente, em citação grande. O item ao lado é o objeto-símbolo do negócio (produto, prato, cartão, chave, ferramenta) ou, em serviço, só um ícone neutro. Com foto do item, passe-a em referenceImageIds e gere uma imagem nova (se o dono pedir para manter a foto e só mudar fundo ou estilo, edite-a com editOfImageId). Pessoa real só com foto dela. Sem foto, descreva só o que o dono confirmou.
- Adaptação (o item muda com o negócio): café, um copo ou grão; clínica, um dente ou escova; roupas, uma peça dobrada; reparos, uma ferramenta; banco ou seguro, um cartão ou cadeado; escola, um livro ou lápis; app, um celular sem tela.
- Composição: fundo off-white liso, margem de 7%. A citação é o bloco dominante, no centro, com metade da área ou mais. Duas aspas gráficas grandes na cor de acento: abertura acima do primeiro verso, fechamento logo após o último. Identificação abaixo, cerca de um quarto do corpo da citação. [HERO] pequeno, até um terço da largura, ao lado ou abaixo, sem pessoa usando. Retrato só com foto real autorizada em referenceImageIds.
- Texto: só estes slots: citação, fala literal de até 20 palavras, o maior texto; identificação, nome e bairro ou cidade como autorizados; assinatura, nome da marca, pequena. Sem título, nota, estrelas ou chamada.
- Prompt-base: comece o prompt do paint por este texto, em inglês, preenchendo os campos entre colchetes com os fatos do pedido e do arquivo da marca (sem deixar colchetes): "[ASPECT_RATIO] testimonial card on a flat off-white background with 7% margins. A centered quotation in heavy sans-serif dark ink fills at least half the frame, with a small attribution below it and a small brand signature at the bottom. Two large flat quotation marks in [BRAND COLOR], one above the first line and one after the last word. A small [HERO], under one third of the frame width, faithful to the reference photo when given, sits beside or below the quote with no person using it. Text slots: quote [QUOTE] (verbatim, max 20 words), attribution [ATTRIBUTION], signature [BRAND]; render exactly this text, nothing else. Even diffuse light, no shadows, matte finish, no photographs, no faces, no logos."
- Revisão: Reprove e corrija com editOfImageId se: a citação muda palavra, acento ou pontuação; falta uma aspa ou ela fica solta; há texto fora dos slots; a identificação traz cargo ou dado não enviado; o item é maior que a citação; o item parece objeto do cliente ou antes e depois; o herói ou os elementos não combinam com o negócio; aparece rosto sem foto autorizada, mão ou avatar; o cartão imita app ou logo; texto cortado ou ilegível em 360 px.
- Evite: citação, nome, resultado ou prazo inventados; nota ou estrelas; aspas de jornal ou rede social; rosto fictício no lugar do cliente; atributos, certificações ou alegações de saúde do item; marcas ou interfaces de terceiros.
- Fatos necessários: fala literal do dono, identificação e autorização do cliente para publicar, e o item (foto ou nome). Sem isso, não crie este formato.
- Propósito comum: prova_social.
