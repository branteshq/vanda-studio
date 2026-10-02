# Documentação do produto

Fonte da página `/docs` do aplicativo e do que a Vanda e o Caetano leem com `product_help` e em `/docs` no workspace. Cada página é um arquivo `.md` com frontmatter (`title`, `description`, `order`, `keywords` opcional).

- Depois de editar, rode `pnpm docs:build` em `apps/vanda`. `pnpm typecheck` falha se o módulo gerado estiver desatualizado.
- A página **Configurações** não fica aqui: ela é gerada do registro em `src/convex/settings/catalog.ts`.
- Escreva para o dono do negócio, em português do Brasil. Descreva o que existe hoje; não documente planos futuros.
