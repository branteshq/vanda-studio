# Carrossel (type carousel)

Carrossel infinito, contínuo, panorâmico ou em loop: leia `infinite-carousel.md`.

- Força: o carrossel transmite mais informação (dados, passos, comparações), uma ideia por slide. Limite: menos apelo visual que o infinito.
- A capa é a miniatura: ela disputa o feed sozinha, antes de alguém saber que há mais slides. Escreva e desenhe a capa como uma peça que para a rolagem por conta própria.
- Cada slide tem dois trabalhos: entregar uma ideia e fazer a pessoa querer o próximo. Respeite a quantidade pedida; sem quantidade, use só os slides necessários. Um carrossel enxuto de 6 vale mais que um de 10 com enchimento.

## Estruturas

Escolha pela natureza do conteúdo e adapte; não são fórmulas.

| O conteúdo é                               | Estrutura                                                                                                             | Slides                                      |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| Uma lista de dicas, itens ou recursos      | Lista com número: a capa promete a contagem exata ("5 cortes para o verão"), um item por slide, fechamento com ação   | capa → itens → ação                         |
| Um resultado real com um método por trás   | Problema e prova: a capa afirma o resultado, o meio mostra o método com passos nomeados, o último mostra a prova real | resultado → problema → método → prova       |
| Técnicas com nome sobre um tema            | Truques numerados: a capa diz o que quase todo mundo erra, cada slide um truque com nome e o certo contra o errado    | gancho → por que falha → truques → síntese  |
| Uma opinião forte sobre um hábito comum    | Opinião: tese clara, razões concretas, conclusão com posição                                                          | tese → razões → posição                     |
| Um produto ou processo que dá para mostrar | Demonstração: cada slide um passo visível do uso, na ordem                                                            | o que é → passos → resultado → onde comprar |

Prova, resultado e número só se forem reais e confirmados (purposes.md, Fatos necessários).

## Produção

1. Planeje a função e o texto de cada slide antes do primeiro paint.
2. Format: o MESMO em todos os slides (o Instagram recorta a série pela proporção do primeiro), passado em `aspectRatio` em cada paint.
3. Gere a capa primeiro, inspecione e só siga quando ela estiver aprovada: ela fixa paleta, família tipográfica, assinatura e acabamento da série.
4. Nos slides seguintes, passe o imageId da capa (ou de outro slide aprovado) em `referenceImageIds` como referência de estilo, com as referências de identidade necessárias. Repita o estilo, não a copy nem a composição da capa. Faça o mesmo ao refazer um único slide numa revisão.
5. Um modelo visual para os slides internos (mesmo layout, mesma escala de texto); a variedade vem do conteúdo. A capa e o fechamento podem ser diferentes.
6. Revisão: a série inteira, com identidade, ordem, ritmo, ausência de repetição acidental e o mesmo format. Corrija só o slide com defeito.
7. create_post: type carousel, o format usado e 2 a 10 imageIds na ordem dos slides.
