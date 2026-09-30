---
name: post-production
description: "Produção de post do Instagram com paint: criar ou revisar arte, briefing, referências, revisão e create_post. Use para qualquer arte nova ou revisão de post."
allowed-tools: list read paint create_post present
---

# Produção de post, imagem por imagem

Crie cada imagem COMPLETA com `paint`: fotografia, ilustração, tipografia e assinatura nos mesmos pixels. Não gere um fundo para montar texto depois. Não use Python, HTML, SVG, overlays ou catálogo de layouts. Use o modelo configurado na conta; não prometa fidelidade perfeita nem troque de modelo sem pedido. Escolha tipo, propósito e format antes de tudo e siga as habilidades deles.

## 0. Tipo → propósito → format

Não há tabela fixa: decida em cada caso o que serve melhor ao pedido, à marca e ao momento do perfil. O que o dono pedir explicitamente sempre vence. Reels ainda não são produzidos.

1. **Tipo** (`type`): image (uma arte), carousel (2–10 slides) ou story (9:16, efêmero). Pense no que a mensagem precisa: leitura instantânea, sequência e profundidade, ou urgência e proximidade. O mesmo propósito pode viver em tipos diferentes.
2. **Propósito** (`purpose`): o objetivo que guia o design. Ids: institucional, educacional, informativo, produto, promocional, prova_social, editorial, storytelling, bastidores, comunidade, anuncio, dados, expressao_cultural, employer_branding. Secundário só com dois objetivos reais; o principal decide a hierarquia. Se o objetivo for ambíguo, consulte o mix em /posts e sugira o que falta ou pergunte.
3. **Format** (`format`): a proporção de todas as imagens, dentro do que o tipo permite (image e carousel: 1:1, 4:5, 3:4, 4:3 ou 16:9; story: 9:16). Escolha pelo conteúdo, pela composição e pela marca, e use o mesmo valor em `aspectRatio` em cada paint.

Busque no tool_search `post tipo <image|carrossel|story>` e `post propósito <sinal do pedido>` e leia o SKILL.md de cada um (o secundário só se houver). Em revisão, leia o post em /posts (type, format, propósito, justificativa) e carregue só o que a correção exige.

No `create_post`, informe type, format, propósito e `rationale` (até 400 caracteres): `<type> porque …; <propósito> porque …; <format> porque …; decisões visuais: …`. Ao entregar, diga ao dono em uma frase por que escolheu tipo, propósito e format.

## 1. Briefing e conteúdo antes dos pixels

- Leia `/brand/kit.json`, o contexto de marca e referências disponíveis. Preserve cores hex, nomes e fatos confirmados. Cite as fontes do kit como direção tipográfica, sem prometer reprodução exata de uma fonte.
- Identifique público, objetivo, assunto e ação final. Se o briefing for suficiente, decida a direção e execute, sem pedir aprovação em cada etapa. Pergunte apenas por informação indispensável que não esteja disponível.
- Escreva a copy antes de gerar. Uma ideia central por imagem, títulos curtos, frases concretas. Preserve literalmente texto aprovado, acentos, preços, números, ressalvas e nomes. Não invente depoimentos, qualificações, registros profissionais, benefícios ou condições comerciais.
- Densidade não é sofisticação. Prefira dividir conteúdo a diminuir a letra. Se a copy obrigatória não couber com legibilidade, explique o conflito antes de omitir ou abreviar.
- Peça fundo explicitamente opaco, margens generosas (cerca de 6–8%), alto contraste e texto confortável numa visualização de aproximadamente 360 px de largura. Nada de moldura de celular, várias páginas numa imagem ou transparência involuntária. Confira as dimensões retornadas em vez de prometê-las.

## 2. Referências têm funções distintas

- Inspecione referências antes de usá-las. Diga no prompt o papel de cada imagem: identidade da pessoa, produto/logo ou direção de arte.
- Para pessoa real, use a foto fornecida em `referenceImageIds`; preserve traços, tom de pele, idade aparente e proporções. Não embeleze, afine rosto ou invente outro profissional. Não peça peso ou percentual de gordura para produzir um retrato. Se não houver foto e a identidade for indispensável, peça a foto; não apresente um rosto inventado como o cliente.
- Uma referência de estilo NÃO autoriza copiar o rosto, nome, logotipo, texto ou credenciais nela. Demonstrações fictícias devem ser identificadas como fictícias.
- Use o logo fornecido quando necessário. Sem logo, prefira o nome da marca em texto; não invente um símbolo oficial.

## 3. Briefing visual executável para cada paint

Cada chamada cria UMA imagem. Inclua:

1. Objetivo, público e função desta imagem no post.
2. Proporção, fundo opaco, composição, posição do assunto, hierarquia, contraste e margens.
3. Paleta e tipografia, com papéis claros em vez de uma lista de adjetivos.
4. Texto EXATO entre aspas, separado por título, corpo e assinatura; uma ocorrência de cada trecho, sem texto extra. Instruções de layout não devem aparecer impressas.
5. Conteúdo visual concreto: o que cada diagrama mostra, rótulos e relações espaciais. Evite instruções físicas perigosas ou figuras técnicas cuja correção não possa avaliar.
6. Papel das referências e tudo que precisa permanecer consistente.

As decisões de estilo do propósito entram aqui como escolhas concretas. É uma estrutura de prompt, não um layout para repetir: faça escolhas específicas ao assunto.

## 4. Revisão obrigatória e correções limitadas

`paint` devolve pixels. Inspecione CADA imagem final; para imagens existentes use `read`. Uma chamada bem-sucedida não prova qualidade.

- Compare todo texto com a copy: omissões, duplicações, grafia, acentos, números, assinatura e ressalvas.
- Confira leitura em tamanho de feed, contraste, margens, cortes e colisões. Corpo pequeno demais reprova a imagem, mesmo com uma foto bonita.
- Confira identidade, produto, logo, anatomia, mãos, instrumento profissional e correção dos diagramas. Relações erradas ou rótulos trocados não são detalhes decorativos.
- Para um defeito localizado, use `editOfImageId` da imagem afetada, diga exatamente o que muda e o que deve permanecer. Inspecione novamente também as partes protegidas: edição generativa pode alterá-las.
- Faça no máximo duas rodadas de correção por pedido. Se persistir erro, diga o que falta; não declare pronta uma peça defeituosa. Não prometa preservação pixel a pixel nem cores exatas só porque o prompt as pediu.
- Saúde e engenharia: conteúdo educativo não é diagnóstico nem orientação individual. Não prometa resultado clínico, segurança estrutural ou conformidade regulatória. Diagramas especializados e publicidade profissional precisam de revisão do responsável antes de publicar.

## 5. Entrega

Crie o rascunho com `create_post`, apenas com os imageIds finais, na ordem planejada, uma legenda fiel aos fatos, o type, o format, o propósito e a justificativa da seção 0. Não inclua tentativas descartadas. Confirme o resultado real e responda de forma curta, apontando qualquer limitação. Agendar ou publicar exige pedido explícito separado; aprovação estética não basta.
