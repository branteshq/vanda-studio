---
name: instagram-market-research
description: Investigue concorrentes, criadores, tendências, referências, desempenho e oportunidades no Instagram compondo leituras públicas/conectadas com análise Python. Use quando o dono pedir pesquisa de mercado, benchmark, análise de concorrentes, ideias baseadas em tendências, comparação de perfis ou diagnóstico de desempenho.
allowed-tools: list read write search_instagram_profiles read_instagram_profile read_instagram_posts read_instagram_post read_instagram_comments read_instagram_metrics run_code
---

# Pesquisa de mercado no Instagram

Investigue com ferramentas primitivas. Não acione uma varredura opaca e não preencha uma cota de concorrentes fracos.

## Procedimento

1. Leia `/brand/memory.md` e notas relevantes para entender categoria, público, localização e oferta.
2. Se o pedido envolver o desempenho do dono, leia o perfil conectado, posts e métricas privadas antes de buscar referências externas.
3. Faça até 3 buscas específicas com `search_instagram_profiles`. Prefira categoria + localidade ou especialidade; não busque usernames inventados.
4. Leia os perfis dos candidatos e descarte contas privadas, agregadores, mercados errados e perfis sem atividade recente.
5. Leia posts somente dos 3–5 candidatos mais relevantes. Comece com 10–25 posts por perfil.
6. Use `read_instagram_post` com transcrição apenas nos reels que realmente merecem análise detalhada.
7. Leia comentários somente nos posts finalistas. Comentários públicos podem ser parciais; não os apresente como amostra completa.
8. Passe os caminhos JSON em `/instagram` para `run_code` quando houver comparação, ranking, tendência ou volume que se beneficie de cálculo. Salve resultados estruturados em `/home/user/out/`.
9. Explique a conclusão com URLs, números, fonte e horário de observação. Diferencie evidência observada de hipótese criativa.

## Regras de métricas

- Contadores públicos: likes, comentários, views, plays e às vezes shares.
- Insights privados conectados: reach, impressions, saves, accounts engaged e demografia.
- Nunca compare reach próprio com views público como se fossem a mesma métrica.
- Para benchmark entre contas, use apenas o subconjunto público comum.
- Calcule taxas com denominador explícito. Exemplo: `(likes + comments) / followers`.
- Trate campo ausente como desconhecido, nunca como zero.

## Uso de Python

Use Python para trabalho mecânico que o modelo faria pior manualmente:

- taxas de engajamento e medianas;
- frequência de publicação;
- detecção de outliers por perfil;
- comparação de formatos;
- agrupamento de hashtags, temas e chamadas;
- tabelas e gráficos de benchmark.

O sandbox não tem internet. Primeiro adquira os dados com as ferramentas Instagram; depois passe os caminhos em `inputPaths`.

## Saída

Entregue uma resposta curta com:

1. o que foi observado;
2. o que está funcionando e para quem;
3. o que é transferível para a marca sem copiar;
4. a próxima ação concreta;
5. os caminhos em `/instagram` e `/runs` usados como evidência.
