---
name: instagram-account-audit
description: Diagnóstico da própria conta do dono no Instagram — o que está funcionando, o que parar de fazer, nota do perfil (0–100) e do que a conta precisa. Use para "analise minha conta", "o que está funcionando", "por que esse post flopou", auditoria de conteúdo ou antes de planejar a semana do piloto automático.
allowed-tools: list read write read_instagram_profile read_instagram_posts read_instagram_post read_instagram_metrics
---

# Diagnóstico da conta

A única evidência honesta do que funciona para uma conta são os posts dela. Regras gerais são hipóteses; os últimos 30 posts do dono são o dado. Foco em posts de feed (imagem e carrossel).

## Leitura

1. Leia `/brand/memory.md` para saber o que a marca vende e para quem.
2. Leia o perfil conectado (`read_instagram_profile`, scope connected), os últimos posts (`read_instagram_posts`, até 30) e as métricas privadas (`read_instagram_metrics`).
3. Se existir `/autopilot/audit.md`, leia o diagnóstico anterior e compare.

## O que medir

Views e likes brutos dependem do tamanho da base; não ranqueie por eles. Calcule e mostre o denominador:

| métrica | conta | o que revela |
| --- | --- | --- |
| Múltiplo de desempenho | reach do post ÷ mediana de reach da conta | se foi acerto real ou um dia normal |
| Salvamentos por alcance | saves ÷ reach | se o conteúdo vale ser revisto |
| Envios por alcance | shares ÷ reach | o sinal mais forte: alguém recomendou |
| Seguidores por alcance | follows ÷ reach | se o perfil converteu a atenção |
| Alcance de não seguidores | % do reach fora da base | se o post viajou |
| Frequência | posts de feed por semana | se a conta parece ativa |

Ranqueie por múltiplo de desempenho e envios por alcance. Campo ausente é desconhecido, nunca zero.

## Encontre o padrão

Compare os 5 melhores com os 5 piores, nesta ordem: formato (imagem × carrossel e nº de slides) → propósito (educacional, prova social…) → tema → gancho da capa/primeira linha → se o dono respondeu comentários. Dia e horário por último: quase nunca são a causa.

Escreva cada conclusão como afirmação + evidência + n. Com 30 posts há padrão; com 6 não há — diga isso em vez de inventar.

## A distinção principal

- Alcance alto e poucos seguidores por alcance: problema de **perfil**, não de post. Recomende ajustes do perfil.
- Alcance baixo: problema de **gancho/capa**. A capa e a primeira linha precisam mudar.

## Nota do perfil

Pontue o perfil com `rubric.json` (12 itens, 100 pontos). Seja rigoroso: perfis sem trabalho ficam entre 30 e 50. Liste as correções por pontos perdidos.

## Saída

```
DIAGNÓSTICO · 28 posts · 12/jun – 05/set · mediana de alcance 4.100
NOTA DO PERFIL 46/100 (bio genérica −9, sem posts fixados −10, grade ilegível −5)

MELHORES (múltiplo)
  6,2×  carrossel 5 slides · educacional · "3 erros no orçamento"  · 4,1% envios
...
PIORES
  0,3×  imagem · promocional · "Promoção de setembro" · 0 envios
...
O QUE OS DADOS DIZEM
1. Carrosséis educacionais: média 3,8× contra 0,9× do resto. n=7.
2. ...
PARE: posts de promoção sem contexto.
FAÇA MAIS: passo a passo com número concreto na capa.
A CONTA PRECISA: ...
```

Salve o resultado em `/memory/diagnostico-instagram.md` quando o dono pedir em conversa. O piloto automático guarda o próprio diagnóstico em `/autopilot/audit.md`.
