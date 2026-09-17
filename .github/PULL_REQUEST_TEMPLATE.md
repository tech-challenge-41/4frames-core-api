<!--
Base: develop. Só o PR de release usa main.
Título no formato de commit, por exemplo: feat(api): download pré-assinado do zip
Regras completas em CONTRIBUTING.md.
-->

## O que muda

<!-- Uma a três frases. Cite o card, se houver. -->

## Por que

<!-- O problema ou requisito que motivou a mudança. -->

## Como testar

<!-- Passos para quem revisa reproduzir: comandos, rotas, payloads, usuário de teste. -->

## Checklist do autor

- [ ] A base do PR é `develop`
- [ ] Título e commits seguem Conventional Commits
- [ ] `pnpm lint`, `pnpm format:check`, `pnpm type-check`, `pnpm test` e `pnpm build` passam localmente
- [ ] CI verde, quando o workflow existir
- [ ] Testes novos ou atualizados cobrem a mudança
- [ ] Migration gerada e commitada, se o schema do Prisma mudou
- [ ] OpenAPI, `README.md`, `CLAUDE.md` e `.env.example` atualizados, se aplicável
- [ ] Nenhum `.env`, token ou senha real no diff
- [ ] Li o diff inteiro e fiz os commits à mão, inclusive onde a IA escreveu código

## Checklist de revisão

- [ ] Revisado e aprovado por outra pessoa
- [ ] "Como testar" executado por quem revisou, quando a mudança altera comportamento
- [ ] Merge feito por quem aprovou, com merge commit
