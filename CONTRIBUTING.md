# Como contribuir

Guia de trabalho do grupo no `4frames-core-api`. Vale para todas as pessoas do grupo e para qualquer código escrito com ajuda de IA.

O front fica em [`4frames-web-app`](https://github.com/tech-challenge-41/4frames-web-app) e segue as mesmas regras. As convenções de código e arquitetura estão no [`CLAUDE.md`](./CLAUDE.md). Como subir o projeto está no [`README.md`](./README.md).

## Regras em resumo

1. Todo trabalho sai de `develop` em uma branch própria e volta para `develop` por pull request.
2. Ninguém commita direto em `develop` ou `main`.
3. Todo PR precisa da aprovação de outra pessoa, e quem mescla não é o autor.
4. Lint, type-check e testes passam antes de pedir revisão.
5. Commits seguem Conventional Commits e são sempre feitos por uma pessoa, nunca por IA.
6. `.env`, tokens e senhas reais nunca entram no git.

> O repositório é privado no plano GitHub Free, que não oferece branch protection. O GitHub não impede ninguém de quebrar essas regras: elas dependem de cada um.

## Ambiente

Pré-requisitos: Node.js 24 ou superior, pnpm 10, Docker Desktop e git.

No Windows, configure o git para manter os finais de linha em LF antes de trabalhar:

```bash
git config core.autocrlf input
```

Se o clone foi feito antes dessa configuração, os arquivos continuam com CRLF no disco e os scripts `.sh` montados nos containers quebram. Com a árvore de trabalho limpa, renormalize uma única vez. Arquivos fora do git, como o `.env`, não são afetados:

```bash
git rm -r --cached -q . && git reset --hard -q HEAD
```

Para confirmar, o comando abaixo deve imprimir `0`:

```bash
git ls-files --eol | grep -c "w/crlf"
```

## Branches

| Branch | Papel |
|---|---|
| `main` | Só versões fechadas. Recebe `develop` por PR a cada release e ganha uma tag `release-X.Y.Z`. |
| `develop` | Integração e branch padrão do repositório. Tudo entra aqui por PR. |
| `<tipo>/<descrição>` | Trabalho do dia a dia, criada a partir de `develop` atualizada. |

O nome da branch usa o mesmo tipo do commit, uma descrição curta em kebab-case e o número do card quando houver:

```text
feat/card-2-worker
fix/complete-video-job-content-length
docs/contributing
```

Fluxo básico:

```bash
git switch develop
git pull
git switch -c feat/card-2-worker
# trabalho e commits
git fetch origin
git rebase origin/develop
git push -u origin feat/card-2-worker
```

Depois que o PR recebeu revisão, atualize a branch com `git merge origin/develop` em vez de rebase, para não reescrever commits que alguém já leu. Nunca use `git push --force` em `develop` ou `main`. Na sua própria branch, se precisar, use `git push --force-with-lease`.

## Commits

Seguimos [Conventional Commits](https://www.conventionalcommits.org/pt-br/v1.0.0/):

```text
<tipo>(<escopo opcional>): <descrição no imperativo, minúscula, sem ponto final>

<corpo opcional: por que a mudança foi feita>

<rodapé opcional: BREAKING CHANGE, Co-Authored-By>
```

| Tipo | Quando usar |
|---|---|
| `feat` | Funcionalidade nova |
| `fix` | Correção de bug |
| `refactor` | Mudança de código sem mudar comportamento |
| `test` | Só testes |
| `docs` | Só documentação |
| `build` | Dockerfile, dependências, scripts de build |
| `ci` | GitHub Actions |
| `perf` | Melhoria de desempenho |
| `chore` | Manutenção que não se encaixa nos outros tipos |

Escopos usados neste repositório: `api`, `worker`, `notifier`, `shared`, `db`, `infra`, `auth`, `video`. Omita o escopo quando a mudança for transversal.

```text
feat(api): listagem paginada de jobs do usuário
fix(worker): renovar visibility timeout durante jobs longos
feat(db)!: trocar id de video_jobs para uuid

BREAKING CHANGE: jobId passa a ser string (uuid) em todas as rotas de /videos.
```

- Escreva em português, o idioma da documentação do projeto.
- A primeira linha tem no máximo 72 caracteres.
- Um commit, uma ideia. Não misture refatoração com funcionalidade nova.
- Use `!` depois do tipo e o rodapé `BREAKING CHANGE:` quando a mudança quebrar o contrato da API, o schema do banco ou as variáveis de ambiente.

## Uso de IA

A IA (Claude ou similar) pode escrever código, testes, documentação, descrições de PR e sugestões de mensagem de commit. Tudo que publica algo no repositório é feito por uma pessoa:

- **Nunca por IA:** `git commit`, `git push`, `git merge`, `git tag`, abrir, aprovar ou mesclar PR.
- Quem commita leu o diff inteiro com `git diff --staged` e rodou lint, type-check e testes.
- Quem commita responde pelo conteúdo como se tivesse escrito cada linha.
- Quando a IA escreveu parte relevante da mudança, registre isso no rodapé do commit:

```text
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## Pull requests

### Antes de abrir

```bash
pnpm lint
pnpm type-check
pnpm test
```

Quando se aplicar:

- **Mudou o schema do Prisma:** gere a migration com `pnpm db:migrate` e commite a pasta criada. Nunca edite uma migration que já está em `develop`; crie outra.
- **Criou ou mudou um endpoint:** atualize o OpenAPI e faça o smoke por curl descrito no `CLAUDE.md` (login, criar job, PUT no S3, complete, status).
- **Criou uma variável de ambiente:** adicione ao `.env.example` com um valor seguro para desenvolvimento e um comentário.
- **Fechou uma limitação conhecida:** atualize as seções de *known gaps* do `README.md` e do `CLAUDE.md`.

> Os caminhos de código citados no `CLAUDE.md` mudam quando o repositório virar monorepo (`apps/`, `packages/`). O PR dessa reestruturação atualiza este guia.

### Ao abrir

- A base é `develop`. Só o PR de release usa `main`.
- O título segue o formato de commit, por exemplo `feat(api): download pré-assinado do zip`.
- Preencha o template: o que muda, por que e como testar.
- Um assunto por PR. Acima de cerca de 400 linhas alteradas, sem contar renomeações, lockfile e arquivos gerados, considere dividir.
- Trabalho em andamento vai como *draft*.

### Revisão

- Pelo menos uma aprovação de outra pessoa.
- Quem revisa executa o "Como testar" quando a mudança altera comportamento. Ler o diff não basta.
- Marque cada comentário como **bloqueante**, quando precisa mudar antes do merge, ou **sugestão**, quando fica a critério do autor.
- O prazo é curto: responda revisões no mesmo dia.

### Merge

- Só com aprovação, sem conflitos e com CI verde. Enquanto o workflow de CI não existir, vale o checklist do template marcado pelo autor.
- Quem mescla é quem aprovou, nunca o autor.
- Use **Create a merge commit**, que preserva os commits feitos à mão. Não use *squash* nem *rebase and merge*.
- Apague a branch depois do merge.

## Releases

1. Abra um PR de `develop` para `main` com o título `chore(release): release-X.Y.Z` e a lista do que entra.
2. Revise e mescle como qualquer outro PR.
3. Crie a tag no `main` atualizado:

```bash
git switch main
git pull
git tag release-X.Y.Z
git push origin release-X.Y.Z
```

Use versões `0.x.y` durante o desenvolvimento. A `release-1.0.0` é a versão entregue no Hackathon.

## Segredos e arquivos fora do git

- O `.env` nunca é commitado. O modelo versionado é o `.env.example`.
- Nada de tokens, PATs ou senhas reais em código, testes, documentação ou prints. Os seeds usam só senhas de teste.
- Não versione `node_modules/`, `dist/`, `coverage/` nem o client gerado do Prisma (`generated/`).
- Se um segredo for commitado por engano, avise o grupo na hora e revogue a credencial. Reescrever o histórico exige `push --force` e é decidido em grupo.

## Mudanças neste guia

Converse com o grupo antes. Alterações neste arquivo seguem o mesmo fluxo de PR.
