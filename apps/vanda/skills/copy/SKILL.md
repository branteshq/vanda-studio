---
name: copy
description: "Texto de tudo que a Vanda publica: legenda de post (primeira linha, corpo, pedido, hashtags), texto na arte (título, apoio, chamada), capa e slides de carrossel, story, ganchos, títulos pelo nível de consciência do público e os sinais de texto de IA. Use ao escrever ou revisar legenda, título, gancho, chamada, hashtags ou o texto de qualquer arte."
license: Partes adaptadas de coreyhaines31/marketingskills (MIT); ai-tells.md copiado sem mudanças
allowed-tools: read create_post
---

# Copy

Você escreve como uma redatora sênior de agência: concreta, com ritmo irregular, a partir de fatos e não de fórmulas. Texto que soa gerado faz o leitor duvidar de tudo ao redor.

## 1. Antes de escrever

- Fatos de /brand/marca.md: o que vende, para quem, Voz, Nunca fazer. Escreva na voz da marca, não na sua.
- Um trabalho por texto: o que a pessoa deve saber ou fazer depois de ler.
- O título depende de quanto o público já sabe:
  - não sabe que tem o problema: comece pela cena ou pelo sintoma ("Acordou com o pescoço travado de novo");
  - sabe o problema: nomeie o problema com as palavras dele;
  - conhece as soluções: diga por que esta, com o diferencial concreto;
  - conhece a marca: oferta, prova, prazo;
  - já é cliente: a novidade, a condição, a chamada direta.

## 2. Princípios

- Claro antes de esperto. Específico antes de vago: "entrega em 40 min no Gonzaga", não "entrega rápida".
- Benefício antes de característica; as palavras que o cliente usa, não as da empresa; voz ativa.
- Teste da troca: se a frase serviria igual no concorrente, reescreva. Se falta o diferencial para isso, escreva o melhor possível e diga ao dono qual fato falta.
- Só afirme o que os fatos sustentam. Não invente número, depoimento, prêmio, garantia, benefício ou condição. Se o pedido exige uma afirmação sem prova, escreva a mais próxima que os fatos permitem e diga ao dono o que destravaria a original (avaliações, laudo, política escrita).
- Preserve literalmente texto aprovado, preços, números, acentos e nomes.

## 3. Ganchos

O gancho é a capa, o título e a primeira linha da legenda. Os moldes abaixo são formas de partida; preencha sempre com um fato, número ou cena real:

- Curiosidade: "[resultado] quase sempre vem de [causa específica]"; "[resultado] em [tempo curto]".
- História: "Semana passada, [coisa inesperada]"; "Quase [erro grande]".
- Valor: "[número] [coisas] para [resultado]"; "Como [resultado] sem [dor comum]".
- Opinião: "[conselho comum] nos custou [resultado]"; "Paramos de [hábito] e [resultado]".
- Prova: "[número real] [pedidos, clientes, anos] em [período]".

## 4. Texto na arte

- Imagem: título de até ~6 palavras, no máximo uma frase de apoio (até ~12 palavras) e a assinatura. O resto vai na legenda.
- Story: até ~15 palavras na arte; se houver ação, diga qual em texto curto.
- No prompt do paint, o texto vai EXATO entre aspas, separado em título, apoio e assinatura. Se o texto obrigatório não cabe legível, divida em slides em vez de diminuir a letra.
- Caixa alta só em título curto ou se a marca usa. Numere slides (2/5) só quando houver ordem.

## 5. Carrossel

```
1         CAPA     o gancho, até 6 palavras, legível em miniatura.
2         APOSTA   por que importa, em uma frase. Também funciona como capa:
                   o Instagram pode reexibir o carrossel a partir dele.
3 a N     UMA IDEIA POR SLIDE: título de 3 a 7 palavras, até 25 palavras.
N+1       RESUMO   tudo em lista, o slide que as pessoas salvam e enviam.
ÚLTIMO    CHAMADA  um pedido só.
```

Com 2 ou 3 slides, junte: capa → conteúdo → resumo e chamada. Se a capa promete uma contagem ("5 cortes"), entregue exatamente essa, sem enchimento. A estrutura da série está em /skills/post/carousel.md.

## 6. Legenda

```
Linha 1   ~125 caracteres visíveis antes do "mais". O gancho: concreto, curto,
          cortado num suspense e não no meio de uma oração. Nunca saudação,
          hashtag, @ ou emoji como primeiro caractere. Não repita a capa:
          acrescente.
Corpo     2 a 6 parágrafos curtos com uma linha em branco entre eles. Os
          termos de busca entram como frase natural ("bolo de pote em Santos").
Pedido    um só: comentar uma palavra (RECEITA, sem espaço nem emoji),
          salvar, compartilhar ou mandar DM. Dois pedidos valem nenhum.
Hashtags  até 5, de tema, na última linha, ou nenhuma. Nada genérico
          (#viral, #fyp, #explore, #instagood, #love, #reels).
```

Limite de 2.200 caracteres; 600 que entregam valem mais que 1.800. Sem link na legenda (não é clicável): aponte para a bio ou a DM. Emoji como pontuação, no máximo ~4 a cada 100 caracteres.

## 7. Sinais de texto de IA

Nunca:

1. Revelação por contraste: "Não é X, é Y", "Não é só X, é Y", "Mais que X, Y". Diga Y direto, com o motivo.
2. Lista de negação: "Sem fila, sem espera, sem complicação." Diga o que acontece.
3. Rabo de vírgulas: a frase termina e segue ", garantindo…", ", sem…". Termine na afirmação.
4. Pergunta que você mesma responde e revelação com dois-pontos: "O resultado? …", "O segredo: …".
5. Clichês: "no mundo de hoje", "seja você X ou Y", "diga adeus a", "eleve seu", "leve ao próximo nível", "descubra o poder", "experiência única", "qualidade e compromisso", "não perca!".
6. Travessão em título, arte e legenda curta.

Com moderação: um fragmento solto e uma lista de três por texto; no máximo um ponto de exclamação; nada de uma frase por linha no post inteiro; emoji não é marcador de lista. Siga também a skill `unslop`. Para textos longos, leia `ai-tells.md` (em inglês): a lista completa, com exemplos e reescritas.

## 8. Conferência

Antes do `create_post`: linha 1 até ~125 caracteres, sem hashtag; um pedido; até 5 hashtags sem genéricas; nenhum link; termos de busca presentes; texto da arte igual ao aprovado; nenhum sinal do §7; teste da troca no título. Se um conserto exige um fato que você não tem, pergunte ou deixe sem, nunca invente.
