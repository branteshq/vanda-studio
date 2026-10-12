---
name: post-ad-nao-seja-burro
description: "Formato de anúncio não seja burro — alerta provocador sobre um hábito comum, em cartaz de alto contraste, sem insultar quem lê."
allowed-tools: paint create_post
---

# Formato de anúncio: não seja burro

- Objetivo: parar a rolagem com um alerta sobre um hábito. A provocação vai para o hábito, nunca para a pessoa.
- Herói: o item ou símbolo da escolha que a marca sugere, pelo pedido e pelo arquivo da marca: produto, prato, serviço, lugar ou objeto-símbolo (cartão, chave, ferramenta). A silhueta é o personagem, não o herói. Com foto do dono, passe-a em referenceImageIds e gere uma imagem nova (editOfImageId só corrige a peça gerada). Pessoa real só com foto dela. Sem foto, descreva só o que o dono confirmou.
- Adaptação: a silhueta faz o hábito do negócio; o símbolo ao lado é a oferta. Café: pedir o mesmo café de sempre, com xícara. Banco: deixar a fatura para depois, com cartão. Conserto: jogar fora um aparelho que tinha reparo, com ferramenta. Dentista: adiar a consulta de rotina, com escova. Loja: comprar o que já se tem, com cabide.
- Composição: fundo opaco de cor forte (amarelo ou a cor de maior contraste). De cima para baixo: título preto em caixa-alta, até 2 linhas, cerca de 30% da altura; silhueta preta chapada, sem rosto, no gesto do hábito, cerca de 40%; [HERO] chapado e pequeno ao lado; faixa de CTA escura com letras claras; assinatura pequena no rodapé.
- Texto: quatro slots, uma vez cada. Título, o maior, até 6 palavras. Apoio, pergunta de até 8 palavras. CTA, verbo no início, com o nome da marca. Assinatura, só o nome.
- Prompt-base: comece o prompt do paint por este texto, em inglês, preenchendo os campos entre colchetes com os fatos do pedido e do arquivo da marca (sem deixar colchetes): "Flat graphic warning poster, [ASPECT_RATIO], fully opaque [ACCENT COLOR] background, high contrast. Top: headline [TITLE] in very heavy black uppercase sans-serif, two lines at most, the largest text. Middle, about 40% of the height: a solid flat black silhouette of a faceless person in the gesture of [HABIT], no shading, with a small flat black [HERO] icon beside it, simplified from the reference when given. Below: the question [SUPPORT] in bold black. Bottom: dark [CTA COLOR] band with light letters carrying [CTA], then a small footer [SIGNATURE]. Flat frontal camera, matte print finish. Render exactly these four texts, once each, nothing else."
- Revisão: Reprove e corrija com editOfImageId se: o título não é o maior ou passa de duas linhas; algum trecho diverge da copy (palavra trocada, acento faltando); aparece cidade, horário, preço ou telefone não fornecidos; a frase xinga ou ironiza a pessoa ("burro", "sem saber"); a silhueta tem mão ou cabeça fundidas; o gesto não bate com o hábito; o herói ou os elementos não combinam com o negócio (xícara num banco, ferramenta numa loja); o apoio ou o CTA não lê bem em 360 px.
- Evite: chamar de burro ou ignorante; vergonha, medo ou perdas não comprovadas; preço, horário, cidade, prazo, depoimento ou nota inventados, na imagem e na legenda; logos de terceiros.
- Fatos necessários: o hábito-alvo, o herói, a escolha que a marca sugere e a copy aprovada. Cidade, horário, preço e canal só se estiverem no pedido ou na marca.
- Propósito comum: produto ou comunidade.
