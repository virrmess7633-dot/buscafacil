# Radar de Imóveis — OLX + Bot Telegram

Sistema que busca imóveis para locação na OLX, avalia cada anúncio contra
critérios configuráveis (preço, localização, quartos, m², etc.) e:

1. Mostra os resultados em um **painel web** ordenado por nota de aderência,
   com atalhos para o anúncio original e para o WhatsApp do anunciante.
2. Publica automaticamente **novidades** em grupos do **Telegram** via um
   bot, através de um worker que roda em segundo plano.

App web e bot compartilham exatamente a mesma lógica de busca, filtragem e
avaliação (`backend/src/services/searchService.js`) — não há duplicação de
regras de negócio entre as duas partes.

---

## Estrutura do projeto

```
olx-imoveis-bot/
├── backend/
│   ├── src/
│   │   ├── config/        # env.js (variáveis) e jsonStore.js (persistência)
│   │   ├── models/        # perfis de busca, imóveis coletados, logs
│   │   ├── services/      # scraper OLX, motor de scoring, orquestração
│   │   ├── routes/        # API REST (Express)
│   │   ├── telegram/      # bot.js — publicação e comandos administrativos
│   │   ├── app.js         # monta o Express (API + frontend estático)
│   │   ├── server.js      # processo da API web
│   │   └── worker.js      # processo separado: varredura agendada + bot
│   ├── package.json
│   └── .env.example
├── frontend/               # HTML/CSS/JS puro, servido estaticamente pela API
│   ├── index.html
│   ├── style.css
│   └── app.js
├── data/                    # arquivos .json com perfis/imóveis/logs (gerados em runtime)
└── README.md
```

**Por que dois processos (`server.js` e `worker.js`)?** Seguindo a
arquitetura sugerida no prompt original: a API web deve responder rápido a
requisições do painel, enquanto o worker faz scraping periódico (que é
lento e não deve travar a API). Rodando como processos separados, um
travamento do scraper nunca derruba o painel, e vice-versa.

---

## 1. Instalação

Pré-requisitos: Node.js 18+.

```bash
cd backend
npm install
cp .env.example .env
```

Edite o `.env` conforme a seção 4 abaixo (Telegram é opcional para rodar
só o painel web).

## 2. Rodando localmente

Em dois terminais separados:

```bash
# Terminal 1 — API + painel web
cd backend
npm start
# abre em http://localhost:3000

# Terminal 2 — worker (scraping periódico + bot Telegram)
cd backend
npm run worker
```

Sem rodar o worker, o painel web ainda funciona: você pode disparar uma
varredura manual pelo botão "Rodar varredura agora" no painel (chama
`POST /api/listings/scan`), que usa a mesma lógica do worker.

## 3. Como configurar um novo perfil de busca

Um "perfil de busca" é a configuração de especificações — cidade, faixa de
preço, quartos, m², etc. Você pode ter vários perfis simultâneos (ex.: um
para você, outro para um cliente).

**Pelo painel web:** clique em "+ novo" na barra lateral, preencha o
formulário e salve. Campos deixados em branco significam "sem restrição".

**Pela API diretamente** (útil para automatizar):

```bash
curl -X POST http://localhost:3000/api/profiles \
  -H "Content-Type: application/json" \
  -d '{
    "nome": "Apê até R$1.500 — Manaíra",
    "localizacao": { "cidade": "João Pessoa", "uf": "PB", "bairros": ["Manaíra", "Tambaú"] },
    "precoMin": 800,
    "precoMax": 1500,
    "tipoImovel": ["apartamento"],
    "quartosMin": 2,
    "vagasMin": 1,
    "areaMin": 50,
    "condominioMax": 400,
    "mobiliado": "nao",
    "aceitaPets": "sim",
    "palavrasExcluir": ["reformar", "sem laje"],
    "plataformas": ["olx", "zap"],
    "notificacao": {
      "scoreMinimo": 70,
      "telegramChatIds": ["-1001234567890"]
    }
  }'
```

O campo `"uf"` (sigla do estado) é opcional para a OLX, mas necessário
para o adaptador do ZAP Imóveis funcionar corretamente — sem ele, essa
plataforma pode não retornar resultados. O campo `"plataformas"` controla
quais fontes esse perfil consulta; omitir o campo busca em todas
(atualmente `["olx", "zap"]`).

Campos aceitos e seus significados estão documentados como comentário no
topo de `backend/src/models/profileModel.js`.

**Pesos de avaliação:** por padrão, preço 30%, localização 25%, quartos
15%, área 15%, extras 15% (mobiliado/pet/condomínio/palavras-chave/andar).
Para customizar, envie um campo `"pesos"` no perfil — os 5 valores devem
somar 1.0. Exemplo: `"pesos": {"preco":0.4,"localizacao":0.3,"quartos":0.1,"area":0.1,"extras":0.1}`.

## 4. Variáveis de ambiente (`.env`)

| Variável | Descrição | Padrão |
|---|---|---|
| `PORT` | Porta da API web | `3000` |
| `DATA_DIR` | Pasta onde os `.json` de dados ficam salvos | `./data` |
| `OLX_BASE_URL` | Base da OLX (para trocar de região, se necessário) | `https://www.olx.com.br` |
| `SCRAPER_REQUEST_DELAY_MS` | Intervalo entre requisições ao site (rate limit) | `2500` |
| `SCRAPER_MAX_PAGES_PER_RUN` | Máximo de páginas de resultado por varredura/perfil | `3` |
| `SCAN_CRON` | Expressão cron da frequência do worker | `*/10 * * * *` (a cada 10 min) |
| `NOTIFY_MIN_SCORE` | Nota mínima padrão para notificar (perfil pode sobrescrever) | `70` |
| `TELEGRAM_BOT_TOKEN` | Token do bot (ver seção 5) | — |
| `TELEGRAM_ADMIN_CHAT_IDS` | Chat IDs com permissão para `/pausar` e `/retomar` | vazio = sem restrição |

## 5. Configurando o bot do Telegram

1. Fale com **@BotFather** no Telegram.
2. Envie `/newbot` e siga as instruções (nome + username do bot).
3. O BotFather devolve um **token** — copie para `TELEGRAM_BOT_TOKEN` no `.env`.
4. Adicione o bot ao grupo/comunidade onde os imóveis devem ser publicados,
   e dê a ele permissão para enviar mensagens.
5. Para descobrir o `chat_id` do grupo: adicione o bot
   [@RawDataBot](https://t.me/RawDataBot) temporariamente ao grupo, ele
   responde com o `chat.id` (grupos costumam ter IDs negativos, ex.:
   `-1001234567890`). Remova o RawDataBot depois.
6. Coloque esse `chat_id` no campo `notificacao.telegramChatIds` do(s)
   perfil(is) que devem publicar nesse grupo.
7. Rode `npm run worker` — o bot inicia junto e passa a escutar comandos
   (`/status`, `/config`, `/pausar`, `/retomar`).

Vários grupos podem ser associados a um mesmo perfil (array
`telegramChatIds`), e um perfil diferente pode ter seu próprio conjunto de
grupos e seu próprio `scoreMinimo` — por exemplo, um grupo só para imóveis
até R$1.500 e outro para até R$3.000, como sugerido no prompt original.

## 6. Buscando via Apify (recomendado — resolve bloqueio da OLX, e é obrigatório para ZAP Imóveis)

O sistema busca em duas plataformas: **OLX** e **ZAP Imóveis**. Cada perfil
de busca escolhe quais delas consultar (campo `plataformas`, padrão:
ambas).

### Por que Apify em vez de scraping direto?

Ao rodar o scraper direto da OLX a partir de um servidor de nuvem (Fly.io,
AWS, etc.), é comum receber **HTTP 403** — a OLX usa proteção Cloudflare
que bloqueia por reputação de IP de datacenter, independente de quão
"parecida com navegador" a requisição seja. Serviços de scraping como a
[Apify](https://apify.com) rodam por trás de **proxies residenciais
brasileiros**, contornando esse bloqueio sem que você precise manter sua
própria infraestrutura de proxy.

Para o **ZAP Imóveis**, esta versão do projeto só busca via Apify — não
existe um scraper direto próprio para essa plataforma.

### Como configurar

1. Crie uma conta gratuita em [apify.com](https://apify.com) (tem cota
   gratuita mensal, suficiente para uso pessoal com poucas buscas).
2. Pegue seu token de API em **Settings → Integrations** no Console da
   Apify.
3. Escolha um "ator" (scraper pronto) para cada plataforma no [Apify
   Store](https://apify.com/store). Alguns que encontrei funcionando ao
   escrever este documento (setembro/2026) — **confirme preço e
   disponibilidade atuais antes de usar, são mantidos por terceiros e
   podem mudar**:

   | Plataforma | Ator sugerido | Observação |
   |---|---|---|
   | OLX | `scrapers_lat/olx-scraper` | Aceita a URL de busca da OLX pronta (`startUrl`) — o projeto já monta essa URL automaticamente |
   | OLX (alternativa) | `autoscraping/olxbrazil-collect-by-url` | Cobra por URL de anúncio individual, útil para enriquecer detalhes |
   | ZAP Imóveis | `haketa/zapimoveis-scraper` | Aceita filtros ricos (cidade, bairro, preço, quartos) próximos aos do perfil de busca |

4. **Antes de configurar no projeto**, teste o ator escolhido direto no
   Apify Console: rode manualmente, confira o formato real da resposta.
   Scrapers de terceiros mudam nomes de campo sem aviso — se os resultados
   vierem vazios ou com dados faltando, o primeiro lugar a ajustar é a
   função `normalizarItemApify()` em `backend/src/services/platforms/olxPlatform.js`
   ou `zapPlatform.js`, comparando com o que o ator realmente devolveu.
5. Configure as variáveis (local: `.env`; produção: segredos do GitHub —
   ver seção 7.4):
   ```
   APIFY_API_TOKEN=seu_token_aqui
   APIFY_OLX_ACTOR_ID=scrapers_lat/olx-scraper
   APIFY_ZAP_ACTOR_ID=haketa/zapimoveis-scraper
   ```

Se `APIFY_API_TOKEN` ou `APIFY_OLX_ACTOR_ID` não estiverem configurados, a
OLX cai automaticamente para o scraper direto gratuito (sujeito ao bloqueio
403 descrito acima). Se `APIFY_ZAP_ACTOR_ID` não estiver configurado, a
plataforma ZAP Imóveis simplesmente não retorna resultados — não derruba a
varredura das outras plataformas/perfis.

### Custo aproximado

Os atores encontrados cobram na faixa de US$1–4 por 1.000 resultados, ou
uma assinatura mensal pequena (~US$10) mais uso. Para um uso pessoal
(algumas varreduras por dia, dezenas de resultados cada), o custo tende a
ficar em poucos dólares por mês ou menos — mas confirme o preço atual do
ator escolhido antes de deixar o worker rodando continuamente.

## 7. Deploy sem instalar nada além do git

Todo o trabalho pesado (`npm install`, criar o app no Fly, criar o volume,
configurar segredos e fazer o deploy) roda dentro do **GitHub Actions** —
não na sua máquina. Você só precisa de um navegador e do `git`, que você
já tem.

### 7.1 Criar o repositório no GitHub

1. No navegador, acesse **github.com/new** e crie um repositório vazio
   (sem README, sem .gitignore — o projeto já tem os seus).
2. Copie a URL do repositório (algo como
   `https://github.com/SEU-USUARIO/olx-imoveis-bot.git`).

### 7.2 Subir o código via PowerShell

Extraia o `.zip` que te enviei em uma pasta qualquer e, no PowerShell,
dentro dessa pasta:

```powershell
cd C:\caminho\para\olx-imoveis-bot
git init
git add .
git commit -m "Primeiro commit"
git branch -M main
git remote add origin https://github.com/SEU-USUARIO/olx-imoveis-bot.git
git push -u origin main
```

Na primeira vez, o Windows deve abrir uma janela do navegador pedindo para
você autorizar o git a acessar sua conta do GitHub — só confirmar.

### 7.3 Criar conta no Fly.io e gerar um token (só no navegador)

1. Crie uma conta gratuita em **fly.io** (não precisa instalar nada).
2. Gere um token de acesso em
   **fly.io/user/personal_access_tokens** → "Create token". Copie o valor.

### 7.4 Configurar os segredos no GitHub

No repositório: **Settings → Secrets and variables → Actions → New
repository secret**. Crie:

| Nome do segredo | Valor |
|---|---|
| `FLY_API_TOKEN` | o token gerado no passo 7.3 (obrigatório) |
| `TELEGRAM_BOT_TOKEN` | token do bot, se já tiver (opcional — pode configurar depois) |
| `TELEGRAM_ADMIN_CHAT_IDS` | chat IDs com permissão de admin (opcional) |
| `APIFY_API_TOKEN` | token da Apify (opcional — sem ele, cai no scraper direto da OLX; ZAP fica desativado) |
| `APIFY_OLX_ACTOR_ID` | ID do ator escolhido para OLX, ex. `scrapers_lat/olx-scraper` (opcional) |
| `APIFY_ZAP_ACTOR_ID` | ID do ator escolhido para ZAP, ex. `haketa/zapimoveis-scraper` (opcional) |

### 7.5 Escolher um nome único para o app

Nomes de app no Fly são globais. Abra o arquivo `fly.toml` **direto pela
interface web do GitHub** (ícone de lápis, sem precisar baixar nada),
troque a linha `app = "olx-imoveis-bot"` por um nome único seu (ex.:
`app = "olx-imoveis-seunome"`), e clique em "Commit changes" direto na
branch `main`.

### 7.6 Deploy automático

Esse commit no passo anterior já dispara o workflow. Acompanhe em
**Actions**, na aba do repositório — ele vai: instalar as dependências,
criar o app no Fly, criar o volume persistente `olx_data`, aplicar os
segredos e fazer o deploy dos dois processos (API + worker).

Quando o workflow terminar com ✅, o painel estará em
`https://<nome-do-app-que-voce-escolheu>.fly.dev`.

A partir daí, qualquer novo `git push` na `main` (inclusive editando
arquivos direto pela interface web do GitHub, sem PowerShell) já reaplica
o deploy automaticamente.

### 7.7 Configurar o Telegram depois (opcional, a qualquer momento)

Quando tiver o token do bot (veja seção 5), volte em **Settings → Secrets
and variables → Actions**, adicione/edite `TELEGRAM_BOT_TOKEN`, e dispare
o workflow de novo em **Actions → Deploy no Fly.io → Run workflow** (não
precisa esperar um push novo).

### 7.8 Outros hosts (alternativa ao Fly.io)

Qualquer host com Node.js 18+ ou suporte a Docker funciona (Railway,
Render, um VPS, etc.), mas nesses casos normalmente é necessário instalar
alguma CLI localmente ou configurar o deploy pela interface do próprio
provedor — o fluxo 100%-sem-instalar-nada descrito acima é específico da
combinação GitHub Actions + Fly.io.

## 8. Manutenção do scraper (leia antes de rodar em produção)

O módulo `backend/src/services/olxClient.js` depende da estrutura de
página da OLX, que pode mudar sem aviso. Ele tenta primeiro extrair os
anúncios de um JSON embutido na página (mais estável) e cai para
seletores CSS como plano B. Se as varreduras começarem a retornar `0`
imóveis mesmo com perfis ativos, esse é o primeiro arquivo a inspecionar —
abra uma página de busca da OLX no navegador, use "Inspecionar elemento"
e ajuste os seletores/nomes de campo conforme necessário. Falhas de
scraping são registradas em `/api/logs` e não derrubam o worker (ele
segue para o próximo perfil).

Antes de rodar isso continuamente em produção, revise os Termos de Uso e
o `robots.txt` da OLX (`https://www.olx.com.br/robots.txt`) para garantir
que a frequência e o escopo da coleta estão de acordo com as regras da
plataforma no momento do deploy.

## 9. API REST (resumo)

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/profiles` | Lista perfis de busca |
| POST | `/api/profiles` | Cria um perfil |
| PUT | `/api/profiles/:id` | Atualiza um perfil |
| PATCH | `/api/profiles/:id/ativo` | Ativa/desativa um perfil |
| DELETE | `/api/profiles/:id` | Remove um perfil |
| GET | `/api/listings?profileId=&minScore=` | Lista imóveis avaliados |
| PATCH | `/api/listings/:plataforma/:anuncioId/status` | Marca como favorito/descartado/visto |
| POST | `/api/listings/scan` | Dispara varredura manual (`{ profileId? }`) |
| GET | `/api/logs?limit=` | Histórico de varreduras |

## 10. Comandos do bot Telegram

| Comando | Descrição |
|---|---|
| `/status` | Resumo da última varredura e estado do bot |
| `/config` | Lista os perfis de busca configurados |
| `/pausar` | Pausa notificações (admin) |
| `/retomar` | Reativa notificações (admin) |
| `/ajuda` | Lista os comandos |
