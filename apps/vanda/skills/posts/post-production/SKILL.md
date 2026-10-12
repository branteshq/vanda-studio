---
name: post-production
description: "Produção de post do Instagram com paint: criar ou revisar arte, briefing, referências, revisão e create_post. Use para qualquer arte nova ou revisão de post."
allowed-tools: list read paint create_post present
---

# Produção de post, imagem por imagem

Crie cada imagem COMPLETA com `paint`: fotografia, ilustração, tipografia e assinatura nos mesmos pixels. Não gere um fundo para montar texto depois. Não use Python, HTML, SVG, overlays ou catálogo de layouts. Use o modelo configurado na conta; não prometa fidelidade perfeita nem troque de modelo sem pedido. Escolha tipo, propósito e format antes de tudo e siga as habilidades deles.

## 0. Tipo → propósito → format

Decida pelo pedido, pela marca e pelo momento do perfil; o que o dono pedir explicitamente vence. Reels ainda não são produzidos.

1. **Tipo** (`type`): image (uma arte), carousel (2–10 slides) ou story (9:16, efêmero). Carrossel infinito (contínuo, panorâmico, em loop, imagens atravessando os cortes) é um carousel com fluxo próprio: busque `carrossel infinito` no tool_search e siga post-type-infinite-carousel. Para muita informação (até 10 slides, dados, passos), use o carrossel comum. O mesmo propósito pode viver em tipos diferentes.
2. **Propósito** (`purpose`): o objetivo que guia o design. Ids: institucional, educacional, informativo, produto, promocional, prova_social, editorial, storytelling, bastidores, comunidade, anuncio, dados, expressao_cultural, employer_branding. Secundário só com dois objetivos reais; o principal decide a hierarquia. Se for ambíguo, consulte o mix em /posts.
3. **Format** (`format`): a proporção de todas as imagens, dentro do que o tipo permite (image e carousel: 1:1, 4:5, 3:4, 4:3 ou 16:9; story: 9:16). Use o mesmo valor em `aspectRatio` em cada paint. `paint` não gera 4:3 (paisagem pintada é 16:9). Fotos prontas do dono mantêm a proporção original se o feed aceitar (4:5 a 1,91:1): informe o format mais próximo, sem repintar.

Busque no tool_search `post tipo <image|carrossel|carrossel infinito|story>` e `post propósito <sinal do pedido>` e leia o SKILL.md de cada um (o secundário só se houver). Formato de anúncio pedido (meme, tier list…): busque `formato de anúncio <nome>`, siga o SKILL.md e cumpra a Revisão dele. Em revisão, leia o post em /posts (type, format, propósito, justificativa) e carregue só o que a correção exige.

No `create_post`, informe type, format, propósito e `rationale` (até 400 caracteres): `<type> porque …; <propósito> porque …; <format> porque …; decisões visuais: …`. Ao entregar, diga ao dono em uma frase por que escolheu tipo, propósito e format.

## 1. Briefing e conteúdo antes dos pixels

- Leia a seção Design do arquivo da marca (paleta, tipografia, logo) e as referências. Preserve hex, nomes e fatos confirmados. Cite as fontes da seção como direção tipográfica, sem prometer reprodução exata. Sem paleta, proponha uma sóbria (2–3 cores em hex), diga que é proposta e não a chame de marca; na entrega, ofereça salvá-la na seção Design.
- Identifique público, objetivo, assunto e ação final. Se o briefing for suficiente, decida a direção e execute, sem pedir aprovação em cada etapa. Pergunte apenas por informação indispensável que não esteja disponível.
- Escreva a copy antes de gerar. Uma ideia central por imagem, títulos curtos, frases concretas. Preserve literalmente texto aprovado, acentos, preços, números, ressalvas e nomes. Não invente depoimentos, qualificações, registros profissionais, benefícios ou condições comerciais.
- Densidade não é sofisticação: divida o conteúdo em vez de diminuir a letra. Se a copy obrigatória não couber legível, explique o conflito antes de abreviar.
- Peça fundo opaco, margens generosas (cerca de 6–8%), alto contraste e texto legível a cerca de 360 px de largura. Nada de moldura de celular, várias páginas numa imagem ou transparência involuntária. Confira as dimensões retornadas em vez de prometê-las.

## 2. Referências têm funções distintas

- Antes do primeiro paint, `reference_search`; passe 2–3 de layout/style em `referenceImageIds` e descreva o layout delas no prompt.
- Para pessoa real, use a foto em `referenceImageIds` (face, anexo ou post do feed); preserve traços, tom de pele, idade aparente e proporções. Não embeleze, afine rosto ou invente outro profissional. Não peça peso ou percentual de gordura para produzir um retrato. Se não houver foto e a identidade for indispensável, peça a foto; não apresente um rosto inventado como o cliente.
- Referência de outro perfil NÃO autoriza copiar rosto, nome, logotipo, texto ou credenciais. Demonstrações fictícias devem ser identificadas como fictícias.
- Foto do dono (anexo ou galeria): confira a Postura (Voz) e o Estilo/Evitar (Design) do arquivo da marca. Se conflitar (selfie casual, fone, fundo bagunçado em conta profissional), diga por quê e ofereça (a) um retrato profissional da mesma pessoa como referência, (b) outra foto ou (c) um post sem foto; aguarde a escolha.
- Logo: use o link `Logo:` (image:<id>) da seção Design ou referência logo, em `referenceImageIds` quando a peça levar assinatura; sem eles, assine com o nome em texto. Nunca invente um logo nem escolha imagem da galeria como logo; se uma parecer a logo, pergunte se pode salvá-la no guia da marca e grave a linha Logo antes de usar.

## 3. Briefing visual executável para cada paint

Cada chamada cria UMA imagem. Inclua:

1. Objetivo, público e função desta imagem no post.
2. Proporção, fundo opaco, composição, posição do assunto, hierarquia, contraste e margens.
3. Paleta e tipografia, com papéis claros em vez de uma lista de adjetivos.
4. Texto EXATO entre aspas, separado por título, corpo e assinatura; uma ocorrência de cada trecho, sem texto extra. Instruções de layout não devem aparecer impressas.
5. Conteúdo visual concreto: o que cada diagrama mostra, rótulos e relações espaciais. Evite instruções físicas perigosas ou figuras técnicas cuja correção não possa avaliar.
6. Papel das referências e tudo que precisa permanecer consistente.

As decisões de estilo do propósito entram aqui como escolhas concretas, nunca como layout para repetir.

## 4. Revisão obrigatória e correções limitadas

`paint` devolve pixels. Inspecione CADA imagem final; para imagens existentes use `read`. Uma chamada bem-sucedida não prova qualidade.

- Compare todo texto com a copy: omissões, duplicações, grafia, acentos, números, assinatura e ressalvas.
- Confira leitura em tamanho de feed, contraste, margens, cortes e colisões. Corpo pequeno reprova a imagem.
- Confira identidade, produto, logo, anatomia, mãos, instrumento profissional e correção dos diagramas. Relações erradas ou rótulos trocados não são detalhes decorativos.
- Para um defeito localizado, use `editOfImageId` da imagem afetada, diga exatamente o que muda e o que deve permanecer. Inspecione novamente também as partes protegidas: edição generativa pode alterá-las.
- Faça no máximo duas rodadas de correção por pedido. Se persistir erro, diga o que falta; não declare pronta uma peça defeituosa. Não prometa preservação pixel a pixel.
- Saúde e engenharia: conteúdo educativo não é diagnóstico nem orientação individual. Não prometa resultado clínico, segurança estrutural ou conformidade regulatória. Diagramas especializados e publicidade profissional precisam de revisão do responsável antes de publicar.

## 5. Entrega

Crie o rascunho com `create_post`: imageIds finais, na ordem planejada, legenda fiel aos fatos, type, format, propósito e justificativa (seção 0). Não inclua tentativas descartadas. Confirme o resultado real e responda de forma curta, apontando qualquer limitação. Agendar ou publicar exige pedido explícito separado; aprovação estética não basta.
