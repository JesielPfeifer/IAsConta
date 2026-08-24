# IAsConta

<p align="center">
  <img src="frontend/public/mascote.svg" alt="Mascote do IAsConta — duas moedas e um robô sorridente" width="180" />
</p>
<h1 align="center">IAsConta</h1>
<p align="center"><em>"— E as conta?" "— A IA resolve." 💬</em></p>

Finanças pessoais para casais, com inteligência artificial integrada ao WhatsApp e Open Finance.

> O IAsConta nasceu como um experimento de **engenharia agêntica**: uma aplicação completa — do planejamento ao deploy — construída ponta a ponta por agentes de IA orquestrados pelo [Hermes Agent](https://hermes-agent.nousresearch.com), com revisão de código automatizada (CodeRabbit) e deploy contínuo num homelab exposto via Cloudflare Tunnel.

## Funcionalidades

- **Dashboard do casal** — saldo, receitas, despesas, comparação mensal e divisão por pessoa (marido/esposa/casal)
- **Transações** — categorias, métodos de pagamento configuráveis, parcelamento com propagação de edição/exclusão entre parcelas do mesmo grupo
- **Contas fixas (bills)** — recorrentes, com vencimento e controle de pagamento
- **Metas** — acompanhamento mensal com barra de progresso (ex.: reserva de emergência, viagem)
- **Investimentos** — reserva, renda fixa e renda variável por mês
- **Rendas fixas** — registro de salários e rendas recorrentes por pessoa
- **Saúde financeira** — indicador do mês atual + previsão do próximo + parcelas que terminam em até 3 meses
- **Bot WhatsApp** (Evolution API + Baileys) — NLP em 3 camadas: comandos explícitos → regex local (150+ mapeamentos) → Groq (Llama 3.3 70B), com estado de conversa para perguntas rápidas (conta fixa? parcelado?)
- **Chat IA** integrado no painel web (Groq)
- **Open Finance via Pluggy** — sincronização de contas bancárias, cartões de crédito, faturas e parcelas com dedupe por `externalId` e webhooks
- **Importação de planilha** (Nubank CSV, Caixa PDF, xlsx)
- **Vínculo de casal** — convite por token, despesas compartilhadas e detecção de pessoa por nome
- **Multi-instância WhatsApp** — cada usuário com sua própria instância Evolution API

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, Vite 6, TailwindCSS 4, Recharts |
| Backend | Node.js 22, Express 4, TypeScript, Prisma 6 |
| Banco de dados | PostgreSQL 16 |
| Cache | Redis 7 |
| IA | Groq (Llama 3.3 70B) — NLP do bot + chat |
| WhatsApp | Evolution API + Baileys |
| Open Finance | Pluggy (conta, cartão, transações, webhooks) |
| Infra | Docker Compose, Nginx, Cloudflare Tunnel + Traefik |

## Arquitetura

```
WhatsApp ──▶ Evolution API ──▶ API (Node/Express) ──▶ PostgreSQL + Redis
                                      ▲
Open Finance (Pluggy) ── webhook ────┤
                                      │
Painel web (React/Vite) ── nginx ─────┘
        │
        └── exposto via Cloudflare Tunnel → https://iasconta.jesielpfeifer.com
```

## Início rápido

```bash
# Subir tudo (PostgreSQL, Redis, API, Web, Evolution API)
docker compose up -d --build

# Acessar
# Web:        http://localhost:3002
# API:        http://localhost:3001
# Evolution:  http://localhost:8082/manager
```

> Os serviços escutam apenas em `127.0.0.1` no host; o acesso externo é feito pelo Cloudflare Tunnel (ver [Deploy](#deploy)).

## Variáveis de ambiente

Copie `backend/.env.example` para `backend/.env` e preencha. Secrets de integração (`JWT_SECRET`, `BOT_API_KEY`, `EVOLUTION_WEBHOOK_SECRET`, `PLUGGY_WEBHOOK_SECRET`, `CORS_ORIGINS`) são resolvidos via `${VAR}` no `docker-compose.yml` a partir do `.env` na raiz do projeto.

| Variável | Obrigatória | Descrição |
|---|---|---|
| `DATABASE_URL` | sim | Conexão PostgreSQL |
| `JWT_SECRET` | sim | Secret dos tokens JWT (`openssl rand -hex 32`) |
| `BOT_API_KEY` | sim | Chave interna de comunicação do bot |
| `EVOLUTION_WEBHOOK_SECRET` | sim | Valida webhooks da Evolution API (bot WhatsApp) |
| `PLUGGY_WEBHOOK_SECRET` | sim | Valida webhooks do Pluggy (Open Finance) |
| `GROQ_API_KEY` | não* | Chave Groq — NLP avançado e chat (*fallback: regex apenas) |
| `EVOLUTION_API_URL` / `EVOLUTION_API_KEY` | sim | Endpoint e chave da Evolution API |
| `CORS_ORIGINS` | não | Origens permitidas (separadas por vírgula) |
| `PLUGGY_CLIENT_ID` / `PLUGGY_CLIENT_SECRET` | não | Credenciais Pluggy globais — cada usuário pode usar as próprias via `/setup` |

Nomes de pessoas do casal (detecção no bot) são configurados **por usuário** no painel (`/setup`), não via env.

## Bot WhatsApp

Conecte pelo QR code em `/setup` (cada usuário ganha uma instância própria) e use o grupo ou número vinculado.

| Comando | Ação |
|---|---|
| `saldo` / `resumo` | Resumo do mês: receitas, despesas, saldo, por pessoa, top categorias |
| `gastos [categoria]` | Detalhamento por categoria (com %) ou filtro |
| `contas a vencer` | Contas em aberto com vencimento e total |
| `saude` | Indicador de saúde financeira do mês + previsão |
| `onde economizar` | Dica gerada por IA (Groq) a partir dos dados reais |
| `mes que mais gastei` | Melhor/pior mês, categoria top e média |
| `investimentos` | Portfólio: reserva, renda fixa, renda variável |
| `meta [nome]` | Progresso de meta com barra |
| `ajuda` | Lista de comandos |

Mensagens fora da lista passam por parser regex local (categorias, valores, pessoas, parcelas) e, se não reconhecidas, pela Groq.

## Open Finance (Pluggy)

- **Sync**: contas bancárias → transações (débito/crédito); cartões → faturas + parcelas (com `installmentGroupId` e `totalAmount`); dedupe por `@@unique([userId, externalId])`
- **Anti-dupla-contagem**: transações de fatura não entram duas vezes em resumos; faturas contam 1x
- **Webhooks**: `item/updated`, `transactions/created|updated|deleted` → sync automático (secret obrigatória)
- **Credenciais**: por usuário (Settings) ou globais (env); widget Pluggy Connect v2 no painel
- Sandbox de teste: connector Pluggy Bank (`user-ok` / `password-ok`) — apenas para validar o fluxo

## Segurança

- **Rate limit**: 20 req/min por IP em `/api/auth/*`
- **Lockout**: 5 tentativas de login falhas → bloqueio de 15 min (HTTP 423)
- **Webhooks**: secrets dedicados e obrigatórios (`EVOLUTION_WEBHOOK_SECRET`, `PLUGGY_WEBHOOK_SECRET`) — o servidor não inicia sem eles; validação com `timingSafeEqual`
- **CORS**: restrito às origens configuradas em `CORS_ORIGINS`
- **Rotas internas do bot**: protegidas por `BOT_API_KEY`

## Desenvolvimento local

```bash
# Infra
docker compose up -d postgres redis evolution-api

# Backend
cd backend
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev            # http://localhost:3001

# Frontend
cd frontend
npm install
npm run dev            # http://localhost:5173 (proxy para a API)
```

## Deploy

O app roda em Docker Compose num homelab e é exposto por **Cloudflare Tunnel** (nginx do container + Traefik no host):

```
Internet ──▶ Cloudflare Tunnel ──▶ Traefik ──▶ nginx (iasconta-web) ──▶ API
```

- Domínio: `https://iasconta.jesielpfeifer.com`
- O rebuild de imagem é feito com `docker compose up -d --build api web`; após recriar a API, recarregue o nginx (`docker exec iasconta-web nginx -s reload`) para evitar 502 por cache de DNS.

## Estrutura

```
IAsConta/
├── docker-compose.yml        # postgres, redis, api, web, evolution-api
├── backend/
│   ├── prisma/schema.prisma  # schema + migrations
│   └── src/
│       ├── api/              # rotas REST, middleware (auth, security), services
│       ├── bot/              # WhatsApp: nlp (commands, regex, groq), platforms
│       └── parsers/          # Nubank CSV, Caixa PDF
├── frontend/
│   └── src/
│       ├── components/       # Layout, ChatBot, TransactionForm, cards
│       ├── hooks/            # useAuth, useDashboard, useTransactions
│       └── pages/            # Dashboard, Transactions, Bills, Goals, Investments, Annual, Salary, Setup, Login
└── .env                      # secrets (não versionado)
```

## Como este projeto foi construído

Desenvolvimento orquestrado por agentes de IA (Hermes Agent) com fluxo de PRs no GitHub, revisão automatizada (CodeRabbit), correções guiadas e deploy contínuo no homelab — um case de "software house autônoma" aplicado a um produto real em uso.
