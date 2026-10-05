---
name: instagram-weekly-plan
description: Planeja a semana de posts de feed (imagem e carrossel) — quantos, em que dias e horários, quantos slides, propósito, tema, ângulo e gancho de cada um. Use para "planeje minha semana", "o que postar", "cronograma", "programação" ou piloto automático.
allowed-tools: list read write read_instagram_metrics autopilot_read autopilot_update_cadence autopilot_update_slot
---

# Plano semanal de feed

O plano decide o que é produzido. Ele parte do diagnóstico da conta (`instagram-account-audit`, ou `/autopilot/audit.md`): a evidência da própria conta vale mais que qualquer regra abaixo.

## Entradas

1. `/brand/memory.md`: o que a marca vende, para quem, tom e o que é proibido.
2. Diagnóstico mais recente: o que funciona (PARE / FAÇA MAIS), melhores horários com evidência.
3. As duas últimas semanas planejadas: não repita tema nem ângulo.
4. Resultados dos posts do piloto da semana anterior: reforce o que superou a mediana e corte o que ficou abaixo.

## Cadência

- 3 a 5 posts de feed por semana. Para manter a conta ativa, 3 bem feitos valem mais que 5 fracos.
- Imagem única quando a ideia é uma afirmação só. Carrossel (2 a 10 slides) quando a ideia tem sequência ou merece ser revista: passos, lista, antes e depois, comparação.
- Horário: público consumidor → início da noite; público B2B → início da manhã; sábado → meio-dia. Ajuste ao melhor horário com evidência do diagnóstico. O horário pesa muito menos que a capa e a primeira linha.
- Fuso sempre America/Sao_Paulo.

Exemplo de cadência inicial:

```
Terça   18h · carrossel 2 slides
Quinta  18h · imagem 1 slide
Sábado  12h · carrossel 3 slides
```

## Mistura de propósitos

Nunca dois posts seguidos com o mesmo propósito.

| papel | propósito no Vanda | frequência | função |
| --- | --- | --- | --- |
| Prova | prova_social / dados | 1 por semana | algo que aconteceu, com número |
| Ensinar | educacional | 1 a 2 por semana | uma coisa que o público pode fazer hoje |
| Opinião | editorial | 1 por semana | uma posição clara da marca |
| História | storytelling / bastidores | 1 a cada 2 semanas | uma cena real, com custo ou virada |
| Oferta | produto / promocional | 1 a cada 2 semanas | o que a marca vende, dito sem rodeio |
| Comunidade | comunidade | quando fizer sentido | convite para responder ou participar |

## Cada slot leva

- dia e hora, tipo (image ou carousel) e número de slides;
- propósito (um dos ids acima);
- tema e **ângulo** — ângulo, não assunto. "Bolo" não é plano; "o bolo que voltou porque o recheio vazou na entrega" é;
- gancho da capa (até 6 palavras) e da primeira linha da legenda;
- roteiro curto por slide (função de cada slide);
- briefing da legenda (pedido único, termos de busca).

Use fatos reais da marca. Quando faltar um número ou fato, escreva `{{dado do dono}}` em vez de inventar.

## Saída

```
SEMANA DE 15/09 · 3 posts · sugerido pelo diagnóstico de 14/09

TER 18h  CARROSSEL 2  EDUCACIONAL  "3 erros no orçamento"   — o erro que custou R$ 2 mil
QUI 18h  IMAGEM 1     PROVA SOCIAL "120 entregas em agosto" — print do cliente
SÁB 12h  CARROSSEL 3  BASTIDORES   "Como sai uma encomenda" — da massa à entrega
```

Explique em uma frase por que essa cadência e essa mistura. Na conversa, mostre o plano com `autopilot_read` e altere só quando o dono pedir.
