---
name: post-ad-manchete-com-dado
description: "Formato de anúncio manchete com dado — número real do seu caixa como manchete, com fonte exata no rodapé: infográfico, estatística própria."
allowed-tools: paint create_post
---

# Formato de anúncio: manchete com dado

- Objetivo: um número verdadeiro do negócio como manchete, com fonte visível.
- Herói: o numeral é o protagonista; o herói de apoio é o que representa a oferta (produto, prato, pessoa, lugar ou objeto-símbolo do serviço: cartão, chave, ferramenta). Com foto do dono, passe-a em referenceImageIds e gere uma imagem nova (editOfImageId só corrige a peça gerada). Pessoa real só com foto dela. Sem foto, descreva só o que o dono confirmou.
- Mundo do herói (objeto de apoio, pequeno): bebida ou comida, xícara ou prato visto de cima; beleza, frasco ou pincel; reparos, peça ou ferramenta; finanças, caderno fechado ou caneta, nunca cédulas nem gráficos; educação, caderno e lápis; tecnologia, aparelho pequeno visto de cima.
- Composição: infográfico editorial, uma arte, fundo opaco claro e liso, margens de 7%. De cima para baixo: manchete curta; numeral, o maior elemento, até 80% da largura; complemento; [HERO] como contexto, no máximo um terço da altura, abaixo do numeral; rodapé com fonte à esquerda e assinatura à direita. Serviço sem objeto: elemento neutro (mesa, documento).
- Texto: três slots: manchete antes do número (até 3 palavras), numeral (só o número exato), complemento (até 4 palavras). Fonte no rodapé com o texto exato que o dono deu (até 10 palavras). Assinatura da marca. Nenhum outro texto.
- Prompt-base: comece o prompt do paint por este texto, em inglês, preenchendo os campos entre colchetes com os fatos do pedido e do arquivo da marca (sem deixar colchetes): "Editorial infographic poster, [ASPECT_RATIO], flat opaque light paper-toned background, 7% margins. Top to bottom: short [HEADLINE] in refined serif; the [NUMERAL] dominant, very large heavy display serif, up to 80% of the width, in [ACCENT COLOR]; [COMPLEMENT] in clean sans below. [HERO] sits low as quiet context, a single clean detail shot from above, never over a third of the height; for services, a neutral prop from the brand's world. Soft natural side light, subtle paper grain, matte finish, no gloss, no charts, no seals. Footer: [SOURCE] legible on the left, [BRAND] signature on the right. Render exactly these texts, each once, nothing else: [HEADLINE], [NUMERAL], [COMPLEMENT], [SOURCE], [BRAND]."
- Revisão: Reprove e corrija com editOfImageId se: o numeral não é o maior elemento ou se repete na manchete; a fonte tem letra menor que 3% da altura ou some a 360 px; o herói ocupa mais de um terço da altura ou disputa com o numeral; o herói ou os elementos não combinam com o negócio; há gráfico, selo ou outro número; número ou fonte errados; surgem "recorde", "maior", "quase" ou "%" não pedidos; a peça parece notícia real; há tela, painel ou objeto inventado; falta acento.
- Evite: estatísticas, estudos, fontes ou causas inventados; arredondar ou exagerar o dado; selos de pesquisa; marcas ou interfaces de terceiros.
- Fatos necessários: o número exato e a fonte que o dono confirmou (caixa, sistema, pesquisa própria). Sem eles, não crie este formato. Para o herói, o item real do pedido ou do arquivo da marca.
- Propósito comum: dados.
