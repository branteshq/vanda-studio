---
name: post-type-image
description: "Tipo de post imagem única no feed (type image; format 1:1, 4:5, 3:4, 4:3 ou 16:9): uma arte, foto única, mensagem lida numa olhada."
allowed-tools: paint create_post
---

# Imagem única (type image)

- Força: impacto imediato; uma ideia lida numa olhada. Limite: não comporta sequência nem muito conteúdo; o que sobrar vai para a legenda.
- Format: 1:1, 4:5, 3:4, 4:3 ou 16:9 (paint não gera 4:3: ele serve a fotos prontas da galeria). Escolha pelo conteúdo e pela marca: 4:5 ocupa mais tela no feed, 1:1 funciona bem para produto e grade, 3:4 é um retrato intermediário, 4:3 e 16:9 servem a fotos e cenas em paisagem, mas ocupam menos tela. Passe o mesmo valor em `aspectRatio` no paint; se o provedor rejeitar, consulte `recovery`, escolha outro format permitido e explique a mudança.
- Hierarquia em até três níveis: mensagem principal, apoio (dado, data, preço ou benefício) e assinatura discreta.
- Texto mínimo: título de poucas palavras e no máximo uma frase de apoio.
- Revisão: a mensagem principal é o primeiro ponto de atenção a 360 px e nada essencial fica colado nas bordas.
- create_post: type image, o format usado e exatamente um imageId.
