---
name: post
description: "Produzir ou revisar post do Instagram com paint: imagem, carrossel, carrossel infinito (contínuo, panorâmico, em loop) ou story; tipo, propósito e format; formatos de anúncio (meme, tier list, massinha, notas do iPhone, nós vs eles…); referências da marca, pessoas reais, revisão e create_post. Leia antes de qualquer arte nova ou revisão de post, junto com design e copy."
allowed-tools: list read write paint create_post present reference_search reference_save extend_infinite_carousel weave_infinite_carousel
---

# Post

Esta skill produz o post. A direção de arte está em /skills/design/SKILL.md e o texto em /skills/copy/SKILL.md: leia os dois antes do primeiro paint de um post novo.

Leia só o que o post pede, todos em /skills/post: `purposes.md` (os 14 propósitos), `formats.md` (formatos de anúncio, um arquivo cada em `formats/`), `carousel.md`, `infinite-carousel.md` e `story.md`.

## 1. Tipo, propósito e format

O que o dono pedir explicitamente vence. Reels ainda não são produzidos.

1. Tipo (`type`): image, uma ideia lida numa olhada; carousel, 2 a 10 slides (leia `carousel.md`); carrossel infinito, contínuo, panorâmico ou em loop (é um carousel, leia `infinite-carousel.md`); story, 9:16 e efêmero (leia `story.md`).
2. Propósito (`purpose`): institucional, educacional, informativo, produto, promocional, prova_social, editorial, storytelling, bastidores, comunidade, anuncio, dados, expressao_cultural ou employer_branding. Leia em `purposes.md` a entrada escolhida: estrutura, visual, texto e os fatos que o post exige.
   - Produto ou linha nova que a peça mostra (o item, o uso, os benefícios) é `produto`, mesmo dito "novo" ou "lançamento". `anuncio` só quando a notícia é uma data, evento, parceria, inauguração ou mudança de funcionamento, e o post existe para contar isso. Desconto ou prazo de oferta é `promocional`.
3. Format (`format`): image e carousel em 1:1, 4:5, 3:4, 4:3 ou 16:9; story em 9:16. Passe o mesmo valor em `aspectRatio` em cada paint. 4:5 ocupa mais tela no feed; paint não gera 4:3 (serve a fotos prontas). Fotos prontas do dono mantêm a proporção original se o feed aceitar (4:5 a 1,91:1), sem repintar. Se o provedor rejeitar, consulte `recovery`, troque e explique.
4. Formato de anúncio (opcional): se o dono citar um (meme, tier list…) ou se um servir melhor que arte livre, abra `formats.md` e leia só o arquivo do escolhido. Ele define a composição; type, propósito e format continuam valendo.

Em revisão, leia o post em /posts (type, format, propósito, justificativa) e carregue só o que a correção exige.

## 2. Referências

- Antes do primeiro paint, `reference_search`, e olhe as de layout e style que servem ao pedido. Passe 2 ou 3 em `referenceImageIds` e diga no prompt o papel de cada uma: "layout: <imageId>, mesma grade com conteúdo novo" se o feed for forte; "cores e assinatura: <imageId>, não copie a composição" se for fraco (design §2). `avoid` nunca vai ao paint: vira "evite …" no prompt.
- Assunto e texto novos: nunca repita o tema ou o título de um post do feed. Se o feed numera os posts (DICA 04), continue (DICA 05).
- Sem referências e com Instagram conectado, leia os últimos posts (read_instagram_posts, scope connected, limit 12, images true), julgue o feed (design §2) e salve 3 ou 4 com reference_save: layout se for forte; style com a nota "só cores e assinatura" se for fraco. Nunca face num post inteiro.
- Pessoa real: se Quem aparece põe o dono ou a equipe nos posts e o pedido não exclui pessoas, inclua a pessoa nessa frequência e desse jeito. Passe 1 ou 2 fotos `face` dela com 1 ou 2 de layout e diga o papel de cada uma ("rosto: <id>, mesma pessoa e mesmos traços"). Preserve traços, pele, idade e proporções, sem embelezar. Sem foto de rosto, faça o post sem ela e peça 2 ou 3 fotos uma vez. Nunca invente o rosto de uma pessoa real.
- Referência de outro perfil não autoriza copiar rosto, nome, logo, texto ou credenciais.
- Foto do dono que conflita com a Voz ou o Design (selfie casual, fundo bagunçado): diga por quê e ofereça um retrato profissional da mesma pessoa, outra foto ou um post sem foto; aguarde.
- Logo: use o `Logo:` (image:<id>) do Design ou a referência logo em `referenceImageIds`; sem eles, assine com o nome em texto. Nunca invente um logo.

## 3. Ordem de produção

1. Copy primeiro, pela skill copy: a ideia, o título, o texto exato de cada imagem.
2. Plano visual e prompt, pela skill design (§3 e §4), com as referências do §2 acima.
3. paint, uma imagem por chamada; em carrossel, a capa primeiro (carousel.md).
4. Crítica de cada imagem (design §7) e, além disso, o texto da imagem contra a copy: omissões, duplicações, grafia, acentos, números, assinatura. Defeito localizado se corrige com `editOfImageId`, no máximo duas rodadas.
5. Legenda pela skill copy (§6) e conferência dela (§8).

Saúde e engenharia: educativo não é diagnóstico nem garantia. Peças técnicas pedem revisão do responsável antes de publicar.

## 4. Entrega

`create_post` com os imageIds finais na ordem, legenda fiel aos fatos, type, format, propósito e `rationale` (até 400 caracteres): `<type> porque …; <propósito> porque …; <format> porque …; decisões visuais: manteve …; melhorou …`. Diga ao dono em uma frase por que escolheu tipo, propósito e format e, se a execução mudou em relação ao feed, o que mudou ("mantive o turquesa e a assinatura e troquei a moldura por foto do produto"). Agendar ou publicar exige pedido explícito separado.
