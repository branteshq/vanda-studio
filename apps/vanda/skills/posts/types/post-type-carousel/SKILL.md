---
name: post-type-carousel
description: "Tipo de post carrossel no feed (type carousel, 2 a 10 slides; format 1:1, 4:5, 3:4, 4:3 ou 16:9): sequência, passos, lista, várias ideias, narrativa, slides."
allowed-tools: read paint create_post
---

# Carrossel (type carousel)

- Força: sequência, profundidade e tempo de atenção; cada slide carrega uma ideia. Limite: pede que a pessoa deslize; o primeiro slide precisa funcionar sozinho no feed.
- Planeje a função e o texto de cada slide antes de gerar (por exemplo gancho → desenvolvimento → fechamento). Respeite a quantidade pedida; sem quantidade definida, use só os slides necessários.
- Format: 1:1, 4:5, 3:4, 4:3 ou 16:9 (paint não gera 4:3: ele serve a fotos prontas da galeria), o MESMO em todos os slides (o Instagram recorta a série pela proporção do primeiro). Paisagem ocupa menos tela; escolha pelo conteúdo e pela marca e passe o valor em `aspectRatio` em cada paint. Se o provedor rejeitar, consulte `recovery`, troque o format da série inteira e explique.
- Consistência: gere o primeiro slide e inspecione. Passe o imageId dele como referência de estilo nos seguintes, junto das referências de identidade necessárias, para manter paleta, família tipográfica, assinatura e acabamento, NÃO a copy ou a composição da capa.
- Varie o ritmo entre slides sem perder a identidade.
- Revisão: compare a série inteira: identidade, ordem, ritmo, ausência de repetição acidental e mesmo format. Corrija só o slide com defeito.
- create_post: type carousel, o format usado e 2 a 10 imageIds na ordem dos slides.
