---
name: creating-carousel-images
description: Cria posts e carrosséis profissionais de Instagram inteiramente com geração de imagens, incluindo texto, retratos e diagramas. Use para qualquer arte nova ou revisão de post, especialmente conteúdo educativo de médicos, dentistas, engenheiros e outros autônomos.
allowed-tools: list read paint create_post present
---

# Carrosséis profissionais, imagem por imagem

Crie cada slide COMPLETO com `paint`: fotografia, ilustração, tipografia e assinatura nos mesmos pixels. Não gere um fundo para montar texto depois. Não use Python, HTML, SVG, overlays ou catálogo de layouts. Use o modelo configurado na conta; não prometa fidelidade perfeita nem troque de modelo sem pedido.

## 1. Briefing e conteúdo antes dos pixels

- Leia `/brand/kit.json`, o contexto de marca e referências disponíveis. Preserve cores hex, nomes e fatos confirmados. Cite as fontes do kit como direção tipográfica, sem prometer reprodução exata de uma fonte.
- Identifique público, objetivo, assunto e ação final. Se o briefing for suficiente, decida a direção e execute, sem pedir aprovação em cada etapa. Pergunte apenas por informação indispensável que não esteja disponível.
- Planeje a função e o texto de cada slide: gancho → explicação útil → ação. Respeite a quantidade pedida. Sem quantidade definida, use apenas as páginas necessárias; não estique conteúdo para preencher uma cota.
- Escreva a copy antes de gerar. Uma ideia central por página, títulos curtos, frases concretas. Preserve literalmente texto aprovado, acentos, preços, números, ressalvas e nomes. Não invente depoimentos, qualificações, registros profissionais, benefícios ou condições comerciais.
- Densidade não é sofisticação. Prefira dividir conteúdo a diminuir a letra. Se a quantidade fixa de slides e a copy obrigatória forem incompatíveis com legibilidade, explique o conflito antes de omitir ou abreviar.

## 2. Direção editorial, não decoração genérica

Escolha uma linguagem que sirva à profissão e à marca. Varie o ritmo da série sem perder identidade. Estas são direções possíveis, não modelos obrigatórios:

- **Capa com presença:** retrato ou cena profissional dominante, enquadramento com espaço negativo para o título. Um gradiente escuro localizado pode sustentar texto claro sem escurecer o rosto. Título editorial grande, serifado quando combinar com a marca, e assinatura discreta. Não empilhe selos, ícones e chamadas competindo com o gancho.
- **Página educativa:** fundo claro, título forte, diagramas realmente explicativos e legendas próximas do elemento que descrevem. Uma grade 2×2 funciona para quatro conceitos curtos; para conteúdo mais complexo, use menos blocos ou mais slides. Não faça uma grade de ícones decorativos para fingir informação.
- **Conclusão:** sintetize a decisão útil e proponha uma ação pertinente, sem urgência falsa. Não termine automaticamente toda série com “agende agora”.

Use normalmente 4:5 para feed, mesma proporção em toda a série e fundo explicitamente opaco. Peça margens generosas (cerca de 6–8%), alto contraste e texto confortável em uma visualização de aproximadamente 360 px de largura. Não prometa 1080×1350 só porque pediu 4:5: confira as dimensões retornadas. Nada de moldura de celular, montagem com várias páginas numa imagem ou transparência involuntária.

## 3. Referências têm funções distintas

- Inspecione referências antes de usá-las. Diga no prompt o papel de cada imagem: identidade da pessoa, produto/logo ou direção de arte.
- Para pessoa real, use a foto fornecida em `referenceImageIds`; preserve traços, tom de pele, idade aparente e proporções. Não embeleze, afine rosto ou invente outro profissional. Não peça peso ou percentual de gordura para produzir um retrato. Se não houver foto e a identidade for indispensável, peça a foto; não apresente um rosto inventado como o cliente.
- Uma referência de estilo NÃO autoriza copiar o rosto, nome, logotipo, texto ou credenciais nela. Demonstrações fictícias devem ser identificadas como fictícias.
- Use o logo fornecido quando necessário. Sem logo, prefira o nome da marca em texto; não invente um símbolo oficial.
- Gere a primeira página e inspecione. Passe seu imageId como referência de estilo nas seguintes, junto das referências de identidade necessárias. Explique que é para manter paleta, família tipográfica, assinatura e acabamento, NÃO repetir a copy ou composição da capa. Priorize referências relevantes dentro do limite da ferramenta.

## 4. Escreva um briefing visual executável para cada paint

Cada chamada cria UMA página. Inclua:

1. Objetivo, público e função desta página na série.
2. Proporção, fundo opaco, composição, posição do assunto, hierarquia, contraste e margens.
3. Paleta e tipografia, com papéis claros em vez de uma lista de adjetivos.
4. Texto EXATO entre aspas, separado por título, corpo e assinatura; uma ocorrência de cada trecho, sem texto extra. Instruções de layout não devem aparecer impressas.
5. Conteúdo visual concreto: o que cada diagrama mostra, rótulos e relações espaciais. Evite instruções físicas perigosas ou figuras técnicas cuja correção não possa avaliar.
6. Papel das referências e tudo que precisa permanecer consistente.

Exemplo de direção para uma página educativa (substitua nome e copy pelos fatos do briefing, não use placeholders na geração):

> Uma única página de carrossel 4:5, fundo opaco marfim, para um engenheiro explicar sinais que merecem avaliação. Título grande no topo, duas ilustrações comparativas centrais de parede, legendas curtas e assinatura discreta no rodapé. Texto em grafite, detalhes em verde-petróleo, margens de 7%, legível a 360 px. Texto exato, cada trecho uma vez: título “Nem toda fissura é igual”; legenda esquerda “Observe onde aparece”; legenda direita “Acompanhe se muda”; ressalva “Uma imagem não substitui avaliação técnica.”; assinatura “Estúdio Exemplo”. Mostre uma fissura fina e outra com mudança visível, sem escalas numéricas ou classificação de risco inventadas. A imagem de referência guia apenas paleta e tipografia. Não copie seu retrato nem sua copy. Nenhum texto adicional.

Isso é uma estrutura de prompt, não um layout para repetir em todos os clientes. Faça escolhas visuais específicas ao assunto.

## 5. Revisão obrigatória e correções limitadas

`paint` devolve pixels. Inspecione CADA página final; para imagens existentes use `read`. Uma chamada bem-sucedida não prova qualidade.

- Compare todo texto com a copy: omissões, duplicações, grafia, acentos, números, assinatura e ressalvas.
- Confira leitura em tamanho de feed, contraste, margens, cortes e colisões. Corpo pequeno demais reprova a página, mesmo com uma foto bonita.
- Confira identidade, produto, logo, anatomia, mãos, instrumento profissional e correção dos diagramas. Relações erradas ou rótulos trocados não são detalhes decorativos.
- Compare a série inteira: identidade consistente, ritmo, ordem, ausência de repetição acidental. Confira proporção/dimensões e fundo opaco.
- Para um defeito localizado, use `editOfImageId` da página afetada, diga exatamente o que muda e o que deve permanecer. Nunca refaça a série inteira por hábito. Inspecione novamente também as partes protegidas: edição generativa pode alterá-las.
- Faça no máximo duas rodadas de correção por pedido. Se persistir erro, diga o que falta; não declare pronta uma peça defeituosa. Não prometa preservação pixel a pixel nem cores exatas só porque o prompt as pediu.
- Saúde e engenharia: conteúdo educativo não é diagnóstico nem orientação individual. Não prometa resultado clínico, segurança estrutural ou conformidade regulatória. Diagramas especializados e publicidade profissional precisam de revisão do responsável antes de publicar.

## 6. Entrega

Crie o rascunho com `create_post`, apenas com os imageIds finais, na ordem planejada, e uma legenda fiel aos fatos. Não inclua tentativas descartadas. Confirme o resultado real e responda de forma curta, apontando qualquer limitação. Agendar ou publicar exige pedido explícito separado; aprovação estética não basta.
