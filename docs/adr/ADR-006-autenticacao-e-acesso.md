# ADR-006: Autenticação, autorização por dono e segredos

## Status

Aceito.

## Data

2026-08-24, quando o login com bcrypt, JWT e limite de requisições entrou no projeto. O token do SSE na query string
entrou em 2026-09-18, a sessão tolerante a storage indisponível em 2026-09-24, o log sem JWT em 2026-09-25, e o
`/auth/login` e o logout no 401 em 2026-09-28. Registrado em 2026-09-28.

## 1. Contexto

O enunciado pede que o sistema seja protegido por usuário e senha. O ADR-001 decidiu login com bcrypt e JWT, JWT em
todas as rotas, autorização por dono, URLs pré-assinadas com escopo e validade curta, e segredos no Kubernetes. A
implementação precisou decidir o que o ADR-001 não detalhava:

- como os usuários passam a existir;
- quanto tempo vale o token e o que acontece quando ele vence;
- como o stream de progresso se autentica, já que o `EventSource` do navegador não envia header;
- como o JWT fica fora dos logs;
- de onde vêm os segredos no cluster, sem IRSA e sem cofre de segredos.

## 2. Decisão

### 2.1. Usuários só pelo seed

Não há rota de cadastro. Os usuários são criados pelo seed do banco (`admin@admin.com` e `user@user.com`), com a senha
guardada em hash bcrypt. O seed roda no Job de migrations do cluster e no serviço `migrate` do Compose, e usa `upsert`.

### 2.2. Login e token

- `POST /auth/login` recebe e-mail e senha, compara com o hash e devolve um JWT HS256 assinado com `JWT_SECRET_KEY`,
  com o `userId` no payload. `POST /auth` responde igual e fica marcado como _deprecated_ no OpenAPI.
- O token vale `JWT_EXPIRES_IN` segundos, 6 horas por padrão. Não há refresh token nem revogação: sair é apagar o token
  no navegador.
- As rotas de autenticação têm limite de 100 requisições a cada 15 min por IP. A API confia em um proxy
  (`trust proxy = 1`), o Ingress, então o limite vale por cliente, não para o Ingress inteiro.

### 2.3. Autorização por dono

- Todas as rotas de `/videos` exigem `Authorization: Bearer <token>`, exceto o SSE (ver 2.4).
- Um job que não existe e um job de outro usuário recebem a mesma resposta, 404 com a mesma mensagem. A API não revela
  que um id existe.
- O id do job é um UUID gerado pelo Postgres (ADR-002), que não dá para enumerar.

### 2.4. O stream de progresso aceita o token na query string

`GET /videos/:jobId/events` aceita o token em `?token=`, porque o `EventSource` não envia header. O header
`Authorization` continua sendo tentado primeiro. A exceção vale só para essa rota, por um middleware próprio
(`sseAuthMiddleware`), e a autorização por dono roda antes de abrir o stream.

Para o token não ficar gravado:

- o log de acesso da API mascara `?token=` e os headers `Authorization` e `Cookie`;
- o log de acesso do ingress-nginx grava o caminho sem a query string.

### 2.5. Bytes por URL pré-assinada

- A URL de upload é um `PUT` restrito à chave `videos/{userId}/{jobId}/source.{ext}` e ao `Content-Type` declarado,
  válida por `UPLOAD_URL_TTL_SECONDS` (5 min). A API aceita só `video/mp4` e `video/quicktime`, até 500 MB.
- A URL de download é um `GET` do `zips/{userId}/{jobId}.zip`, válida por 5 min, e só sai para o dono de um job `DONE`.
- O bucket é privado. A CloudFront do ADR-001 não existe no ambiente local (ADR-002).

### 2.6. Sessão no front

- O front guarda a sessão no `localStorage` (`4frames.session`), compartilhada entre abas. Sem storage disponível
  (navegação privada, cookies bloqueados), a sessão vale só em memória e não sobrevive a um reload.
- Um 401 numa chamada com token encerra a sessão e leva ao login com "Sua sessão expirou". Depois do login, o usuário
  volta à página que pediu, como a do link do e-mail. Uma senha errada no login não dispara esse fluxo.

### 2.7. Segredos

- O `.env` nunca entra no git. No cluster local, o script gera o Secret `4frames-secret` a partir dele.
- O `base/secret.yaml` tem valores de desenvolvimento, e só o overlay do CD o usa, num cluster efêmero sem dados.
- No lugar do IRSA, API, worker e KEDA usam as credenciais fixas do LocalStack. O KEDA as recebe no próprio operator,
  porque sem elas o scaler tenta o IMDS da EC2.

## 3. Consequências

### 3.1. Positivas

- Nenhuma rota de vídeo responde sem token, e nenhuma revela dados de outro usuário. Os testes HTTP de `/videos`
  conferem o 401 em cada rota existente (ver [ADR-007](./ADR-007-qualidade-testes-e-entrega.md)). Uma rota nova
  precisa entrar na lista desses testes.
- Os bytes do vídeo e do zip nunca passam pela API, e cada URL só serve a um objeto, por 5 min.
- O token não fica nos logs de acesso da API nem do Ingress.

### 3.2. Negativas e trade-offs

- **Sem cadastro, só existem os usuários do seed.** Serve à demonstração. Um produto precisaria de cadastro e de
  recuperação de senha.
- **Sem revogação**, um token vazado vale até vencer, por até 6 horas.
- **O token na query string** pode aparecer em histórico do navegador, em proxies e no log de erro do ingress-nginx, que
  ainda grava a requisição inteira quando a chamada à API falha. A alternativa, um cookie `HttpOnly`, exigiria proteção
  contra CSRF e mudaria a autenticação de todas as rotas.
- **O `localStorage` é legível por JavaScript.** Um XSS no front leria o token. Um cookie `HttpOnly` evitaria isso, com
  o mesmo custo acima.
- O LocalStack não valida a assinatura das URLs pré-assinadas (ADR-002), e o CORS do bucket local aceita qualquer
  origem. O ambiente local não prova essas garantias, que dependem do S3 real.
- As credenciais do LocalStack são fixas e conhecidas. Na AWS, elas dão lugar ao IRSA com menor privilégio do ADR-001.

## 4. Relação com outros ADRs

- Implementa a garantia de segurança da seção 2.3 do ADR-001, com as substituições do ADR-002 (sem CloudFront, OAC nem
  IRSA).
- O Ingress e o log de acesso sem query string estão no [ADR-003](./ADR-003-cluster-local-kind-compose-kustomize.md).
