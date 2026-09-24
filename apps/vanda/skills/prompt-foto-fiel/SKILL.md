---
name: prompt-foto-fiel
description: Gera prompts de retrato ultra-realista e fiel à pessoa real, sem embelezamento ou aparência de IA. Use quando um template de post precisar de uma nova foto profissional ou casual baseada em referências da pessoa.
allowed-tools: list read paint
---

# Prompt de foto fiel

Gera o prompt de um retrato de pessoa real que não pareça IA e não embeleze ninguém.

`/skills/prompt-foto-fiel/references/contextos.md` tem a transcrição integral da página "Prompts de foto" do canvas: bloco fixo, os dois modos, os 10 contextos prontos (economista, dentista, advogado, médico, engenheiro civil, arquiteto, executivo, contador, founder/dev, consultor/palestrante), o checklist antes de gerar e o que fazer quando ainda fica com cara de IA. Quando a profissão pedida estiver na lista, use o contexto pronto de lá.

## Processo

1. Colete o que falta. Gerador de imagem não pergunta, ele inventa, e campo vazio vira a versão "mais bonita". Pergunte numa mensagem só: foto de referência do rosto, altura, peso, % de gordura, profissão ou contexto, modo (profissional ou casual), roupa e enquadramento.
2. Monte o prompt em três partes, nesta ordem: bloco fixo, bloco do modo, contexto.
3. Rode a checagem dos padrões abaixo no prompt montado.
4. Autoauditoria: "o que nesta imagem entregaria que é IA?" Corrija o que sobrar.
5. Entregue num bloco de código pronto para colar. Diga quais placeholders ficaram abertos.

## Bloco fixo

Sempre igual, sempre no topo.

```
Fotografia ultra-realista tirada por um fotógrafo terceiro. NUNCA selfie, mesmo em enquadramento só de rosto ou busto, a não ser que seja pedido explicitamente.

FIDELIDADE FACIAL: manter exatamente o rosto da imagem de referência: formato e proporção do nariz, formato dos olhos e distância entre eles, boca e lábios, queixo, maçãs do rosto, linha do maxilar, assimetrias naturais, textura e tom de pele (manchas, olheiras, rugas, poros, marcas), tipo e volume de cabelo. Não idealizar, não corrigir, não simetrizar, não embelezar. Sem pele suavizada, sem olhos aumentados, sem nariz afinado, sem maxilar marcado artificialmente, sem filtro de beleza, sem aparência de modelo ou influenciador. Fidelidade acima de estética.

FIDELIDADE CORPORAL: altura [ALTURA] m, peso [PESO] kg, gordura corporal aproximada de [BF]%. Não aumentar massa muscular, não alargar ombros, sem V-shape exagerado, sem hipertrofia, sem aparência de fisiculturista. A roupa veste o corpo real informado, sem estufar peito, ombros ou braços.

POSE E ÂNGULO: podem variar (frontal, 3/4, perfil leve, corpo rotacionado, braços cruzados, mão no queixo), desde que identidade facial e corporal permaneçam idênticas. Câmera na altura dos olhos ou levemente acima, distância de foto tirada por outra pessoa. Nunca braço estendido, nunca perspectiva de câmera frontal de celular, nunca grande angular distorcendo o rosto.

EXPRESSÃO: expressão, olhar e pose podem variar livremente entre as imagens. Sorriso leve, olhar sério, falando, pensativo ou relaxado, tudo é permitido. Não repetir a mesma expressão neutra. Identidade fixa: formato do nariz, formato e distância dos olhos, formato dos lábios, maxilar, maçãs do rosto e textura de pele não mudam. Só se movem os músculos de expressão, boca, olhos e sobrancelhas, de forma natural.

ROUPA: tecido com peso físico real, amassados naturais em cotovelos, ombros e dobras do corpo, costuras levemente irregulares, trama visível, reflexos de luz não uniformes, sombra própria da roupa no corpo. Nada de tecido liso de render 3D ou plástico.

CENÁRIO SIMPLES E CRÍVEL: um lugar comum que existe de verdade no Brasil, com poucos objetos e todos plausíveis. Sem cenografia elaborada, sem arquitetura de revista, sem luz cinematográfica, sem excesso de decoração.

CAPTURA ÚNICA: rosto, roupa e fundo na mesma exposição, mesma câmera, mesmo instante. Mesmo grão, mesma nitidez relativa, mesma temperatura de cor e mesma direção e dureza de sombra em toda a imagem, sem exceção de área. Sem halo em volta do cabelo, sem recorte colado, sem aparência de composição em camadas, sem transição abrupta de luz entre rosto e pescoço. Sombra de contato onde o corpo encosta em mesa, cadeira ou parede.

AMBIGUIDADE: se faltar informação sobre corpo, pele, cabelo ou proporções, não completar com a versão mais bonita. Manter o mais literal possível à referência, mesmo que a imagem fique menos impressionante.
```

## Bloco do modo

Escolha um. O modo é o único lugar que define luz e câmera.

**Profissional.** Qualidade de estúdio, ainda realista.

```
MODO PROFISSIONAL (qualidade de estúdio, ainda realista): ensaio corporativo feito por fotógrafo profissional no próprio local. Iluminação de estúdio controlada: luz principal suave com softbox grande a cerca de 45 graus, preenchimento leve do lado oposto, luz de recorte sutil separando cabelo e ombros do fundo. Exposição correta, sombras suaves e limpas, catchlight discreto nos olhos, cores neutras e fiéis. Câmera full-frame, lente 85mm f/2.8, ISO 100, nitidez alta no rosto, grão fino e uniforme na imagem inteira, profundidade de campo moderada. Mesmo com qualidade de estúdio, manter o realismo: poros e textura de pele visíveis, pequenas imperfeições reais (manchas leves, olheiras, linhas de expressão), fios de cabelo soltos, roupa com amassados sutis nas dobras de cotovelo, ombro e cintura. Sem retoque de beleza, sem pele de porcelana, sem aparência de foto de banco de imagens.
```

**Casual.** Foto espontânea, luz da esquerda, defeitos visíveis.

```
MODO CASUAL (foto espontânea, realismo cru): foto do dia a dia tirada por um colega, sem produção. Luz natural direcional vindo da ESQUERDA do enquadramento, como uma janela lateral: lado esquerdo do rosto e do corpo iluminado, lado direito claramente mais escuro, sombras marcadas com transição natural, sem luz de preenchimento, sem luz de recorte, sem softbox. Contraste médio a alto, realces levemente estourados onde a luz bate mais forte. Câmera full-frame ou mirrorless, lente 35mm ou 50mm f/2, ISO 800 a 1600, grão visível na imagem inteira, foco um pouco menos preciso fora do rosto, leve desfoque de movimento aceitável nas mãos. Defeitos bem mais visíveis: poros abertos, oleosidade leve na testa e no nariz, vermelhidão, olheiras marcadas, manchas e marcas de pele, fios de cabelo fora do lugar, barba ou pelos irregulares quando houver. Roupa com amassados evidentes, gola ou manga levemente torta, tecido com fiapos e marcas de uso. Enquadramento levemente imperfeito e não centralizado. Continua NÃO sendo selfie.
```

## Contexto

```
CONTEXTO: [profissão]
AMBIENTE: [lugar específico, poucos objetos reais e característicos]
ROUPA: [peça, cor, corte]
ENQUADRAMENTO: [busto, meio corpo, plano americano]
LUZ E CÂMERA: seguir o modo acima.
```

Não escreva luz nem lente aqui. Brigam com o modo.

## Padrões para detectar e corrigir

### Rosto

1. **Embelezamento.** Pele lisa, olhos maiores, nariz mais fino, maxilar marcado. Confirme que o bloco de fidelidade facial está inteiro. Cite defeitos reais da pessoa ("manter a assimetria do sorriso", "manter as olheiras").
2. **Expressão congelada.** Mesma cara neutra em todas as imagens. O bloco de expressão libera variação, mas só nos músculos de expressão.
3. **Rosto de outra pessoa.** Ângulo novo virou identidade nova. Reforce "identidade fixa em qualquer ângulo".

### Corpo

4. **Corpo inflado.** Ombros largos, peito estufado, braço de academia. Quase sempre faltou altura, peso ou % de gordura no pedido. Preencha antes de gerar.
5. **Roupa de render.** Tecido liso, sem dobra, com brilho uniforme. Peça amassados, costura irregular e trama.

### Cena

6. **Cenário de revista.** Escritório cinematográfico, arquitetura premiada, decoração demais. Troque por um lugar comum no Brasil com três ou quatro objetos plausíveis.
7. **Recorte colado.** Rosto fotográfico sobre fundo CG, halo no cabelo, luz diferente no rosto e no pescoço. O bloco de captura única resolve a maior parte.
8. **Luz contraditória.** Contexto pede "janela difusa" e modo pede "estúdio". Tire luz e lente do contexto.
9. **Selfie disfarçada.** Grande angular, braço fora do quadro, câmera baixa e próxima. Só aceite selfie se o usuário pediu com essa palavra.

### Pedido

10. **Campo vazio.** Qualquer dado não informado vira alucinação. Pergunte, ou deixe o placeholder e avise.
11. **Prompt gigante sem referência.** Texto longo sem foto de referência faz o modelo "trabalhar" a cena e se afastar da pessoa. A foto de referência vale mais que qualquer parágrafo.

## Quando o prompt bate no teto

Diga com honestidade que texto não desliga o viés de polimento do modelo. O que funciona depois disso:

- img2img com strength ou denoise entre 0,3 e 0,5
- pós-processamento com grão real e compressão JPEG leve
- trocar de modelo: Flux, ou Midjourney com `--style raw`

## Escrita

Português, direto. Sem travessão: use vírgula, dois pontos ou ponto.
