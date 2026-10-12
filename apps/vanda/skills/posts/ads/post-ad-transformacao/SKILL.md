---
name: post-ad-transformacao
description: "Formato de anúncio transformação — antes e depois em duas metades da mesma cena, para mostrar a mudança de um serviço, peça ou espaço."
allowed-tools: paint create_post
---

# Formato de anúncio: transformação

- Objetivo: mostrar a mudança do negócio em duas metades da mesma cena.
- Herói: o que representa a mudança: o item ou, sem objeto físico, o próprio espaço (mesa, balcão) que muda de estado. Com foto do dono, passe-a em referenceImageIds e gere uma imagem nova (editOfImageId só corrige a peça gerada). Pessoa real só com foto dela. Sem foto, descreva só o que o dono confirmou.
- Adaptação (por negócio): roupas, peça amassada na cadeira e, depois, passada e dobrada no lugar; café ou restaurante, bancada suja e, depois, o prato servido; reparos, pia com torneira pingando e, depois, torneira nova e seca; contabilidade, mesa com pilhas de papel e, depois, um documento organizado sob luz quente, sem cédulas nem gráficos; consultório, escola ou software, sala em desordem e, depois, o lugar arrumado, sem interface de terceiros nem resultado no corpo.
- Composição: duas metades verticais iguais, quase toda a altura, com vão claro. Mesmo enquadramento, luz e objetos fixos; muda só o [HERO] ou o estado do ambiente. Título centralizado acima; faixas "Antes" e "Depois" sólidas no canto de cada metade, fora do assunto; assinatura abaixo.
- Texto: Título (o maior, até 6 palavras); "Antes" e "Depois" (médios, até 2 palavras); assinatura (menor, só o nome da marca); "Cena ilustrativa" (miúdo, legível) se a cena não for registro real. Campos: [TITLE], [BEFORE_WORD], [AFTER_WORD], [SIGNATURE], [DISCLAIMER].
- Prompt-base: comece o prompt do paint por este texto, em inglês, preenchendo os campos entre colchetes com os fatos do pedido e do arquivo da marca (sem deixar colchetes): "[ASPECT_RATIO] image with two equal vertical panels side by side and a clear gap, showing the same [SCENE FROM THE HERO'S WORLD] from one fixed eye-level camera with identical framing, light and fixed objects. Left panel BEFORE: [BEFORE_STATE], with [HERO] not yet in place, cooler daylight. Right panel AFTER: the same spot with [HERO] finished and in place, tidy, soft warm window light, realistic textures, editorial photography. Bold centered title [TITLE] above; solid [BRAND COLOR] bands with white text in each panel's top corner reading [BEFORE_WORD] and [AFTER_WORD]; small brand line [SIGNATURE] below; tiny legible [DISCLAIMER]. No people, no logos, no prices. Render exactly this text, nothing else."
- Revisão: Reprove e corrija com editOfImageId se: as metades têm ângulo, luz, escala ou objetos fixos diferentes; o "depois" mostra algo que o "antes" não sugere; o herói ou os elementos não combinam com o negócio; a ressalva está ilegível a 360 px; há palavra trocada, acento faltando ou texto extra; uma faixa cobre o assunto; há preço, prazo ou depoimento escrito; há rosto alterado, logo ou interface de terceiros.
- Evite: resultado pessoal (corpo, pele, saúde), pessoas alteradas, "resultados reais" sem evidência, garantia, preço, horário ou área de atendimento não informados, logos, interfaces e depoimentos inventados.
- Fatos necessários: a mudança que a marca pode afirmar, o herói que a causa e se a cena é real.
- Propósito comum: prova_social ou produto.
