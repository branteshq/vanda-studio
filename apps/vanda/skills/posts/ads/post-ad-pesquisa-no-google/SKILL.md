---
name: post-ad-pesquisa-no-google
description: "Formato de anúncio pesquisa no Google — a pergunta que o cliente digita numa busca genérica e a marca como solução."
allowed-tools: paint create_post
---

# Formato de anúncio: pesquisa no Google

- Objetivo: ligar a pergunta digitada numa busca à marca como solução.
- Herói: o que representa a oferta neste post, escolhido pelo pedido e pelo arquivo da marca: produto, prato, pessoa, lugar ou um objeto-símbolo do serviço (cartão, chave, ferramenta, documento). Com foto do dono, passe-a em referenceImageIds e gere uma imagem nova (se o dono pedir para manter a foto e só mudar fundo ou estilo, edite-a com editOfImageId). Pessoa real só com foto dela. Sem foto, descreva só o que o dono confirmou.
- Adaptação: o herói muda com o negócio. Café: a bebida ou o prato inteiro. Banco: um cartão físico sem marca, nunca cédula, moeda ou gráfico. Reparo: a ferramenta ou a peça real do serviço. Clínica: um objeto simples do cuidado, sem paciente. Loja de roupa: a peça inteira. Escola ou app: um caderno, uma chave, nunca tela.
- Composição: fundo claro e opaco, margens de 7%. Em cima, a busca: campo de cantos arredondados, borda fina, um quarto da altura, pergunta à esquerda. Embaixo, a solução: cartão na cor da marca, dois quintos da altura, com o herói inteiro ao lado do nome. Serviço sem objeto: nome e o que resolve.
- Texto: cinco slots, cada um uma vez. (1) "a busca", legenda pequena acima do campo; (2) a pergunta aprovada, minúsculas, até oito palavras; (3) "a solução", legenda pequena acima do cartão; (4) nome da marca, até quatro palavras, o maior texto; (5) apoio, até oito palavras.
- Prompt-base: comece o prompt do paint por este texto, em inglês, preenchendo os campos entre colchetes com os fatos do pedido e do arquivo da marca (sem deixar colchetes); com foto do herói, passe-a em referenceImageIds e gere uma imagem nova (se o dono pedir para manter a foto e só mudar fundo ou estilo, edite-a com editOfImageId): "[ASPECT_RATIO] flat graphic on matte off-white, 7% margins, top-down view, no device frame, soft light. Upper quarter: a small caption 'a busca' above a rounded search field with thin border and no icons; inside it the question [APPROVED QUESTION] in lowercase dark sans-serif. Lower two-fifths: a small caption 'a solução' above a large rounded card in solid [BRAND COLOR], matte finish, holding [HERO] whole beside the brand name [BRAND NAME] in heavy bold type, the largest text, with [SUPPORT LINE] below in regular weight. For a service, [HERO] is a simple stand-in object from its world. Render exactly this text, nothing else; no search-engine logo, interface, results, footer or price."
- Revisão: Reprove e corrija com editOfImageId se: a pergunta difere da aprovada ou erra acento; a barra tem logo, lupa ou resultados; falta legenda ou cartão; o nome aparece duas vezes ou não é o maior texto; o cartão não usa a cor da marca; o herói sumiu ou foi cortado; o herói ou os elementos não combinam com o negócio; há preço, horário ou rodapé.
- Evite: logo, cores ou interface de qualquer buscador; resultados ou avaliações; marcas de terceiros; saúde com a marca como solução médica; depoimento, preço, prazo ou área inventados.
- Fatos necessários: a pergunta exata aprovada pelo dono e o que a marca faz. Preço, horário e área só na legenda, se confirmados.
- Propósito comum: produto, institucional ou educacional.
