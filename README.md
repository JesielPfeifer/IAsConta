# Contas

Gestao financeira pessoal para casais com inteligencia artificial integrada ao WhatsApp.

## Recursos

- **Dashboard** com saldo, receitas, despesas e analise mensal
- **Transacoes** com categorias, metodo de pagamento e parcelamento
- **Contas Fixas** recorrentes (Bills)
- **Bot WhatsApp** via Evolution API com processamento NLP (regex + Groq IA)
- **Chat IA** integrado no painel web (Groq)
- **Importacao de planilha** Excel (Nubank CSV, Caixa PDF)
- **Dicas de economia** geradas por IA baseadas nos seus gastos

## Stack

| Camada | Tecnologia |
|---|---|
| Frontend | React 19, Vite, TailwindCSS, Recharts |
| Backend | Node.js 22, Express, TypeScript, Prisma |
| Banco | PostgreSQL 16 |
| Cache | Redis 7 |
| IA | Groq (Llama 3.3 70B) |
| WhatsApp | Evolution API + Baileys |
| Infra | Docker Compose |

## Inicio rapido

```bash
# Subir tudo
docker compose up -d

# Acessar
# Web: http://localhost:3000
# API: http://localhost:3001
# Evolution API Manager: http://localhost:8082/manager
```

## Desenvolvimento local

```bash
# Infra
docker compose up -d postgres redis evolution-api

# Backend
cd backend
cp .env.example .env  # ajuste as variaveis
npm install
npx prisma generate
npx prisma migrate deploy
npm run dev

# Frontend
cd frontend
npm install
npm run dev                           # http://localhost:5173
```

## Importar planilha

```bash
cd backend
npx tsx src/scripts/import-xlsx.ts
```

## Estrutura

```
contas/
├── backend/
│   ├── prisma/          # Schema e migrations
│   │   └── schema.prisma
│   └── src/
│       ├── api/
│       │   ├── middleware/    # Auth JWT e Bot API Key
│       │   ├── routes/        # REST endpoints
│       │   └── services/      # Email, Settings
│       ├── bot/
│       │   ├── nlp/           # Regex parser, Groq NLP
│       │   └── platforms/     # WhatsApp, Discord, Telegram
│       └── parsers/           # Nubank CSV, Caixa PDF
├── frontend/
│   └── src/
│       ├── components/        # Layout, ChatBot, TransactionForm
│       ├── hooks/             # useAuth, useDashboard, useTransactions
│       └── pages/             # Dashboard, Login, Transactions, Setup, Bills
└── docker-compose.yml
```

## Variaveis de ambiente

Configure via aba **Configuracao** no painel web (`/setup`) ou edite `backend/.env`:

| Variavel | Descricao |
|---|---|
| `DATABASE_URL` | Conexao PostgreSQL |
| `JWT_SECRET` | Secret para tokens JWT |
| `GROQ_API_KEY` | Chave da API Groq (NLP) |
| `EVOLUTION_API_KEY` | Chave da Evolution API |
| `BOT_API_KEY` | Chave interna do bot |
| `WHATSAPP_GROUP_ID` | ID do grupo WhatsApp monitorado |
| `WIFE_NAME` / `HUSBAND_NAME` | Nomes para deteccao de pessoa |
