# Content Aiviary

**Multi-tenant social media intelligence and automation platform for Meta/Instagram**

Built for agencies and consultants managing multiple clients with complete data isolation.

---

## 🎯 Overview

This platform enables you to provide **Instagram analytics** and **Meta Ads intelligence** to clients through isolated VM deployments. Each client gets their own complete stack with n8n workflows, AI agents, and data storage - all powered by a centralized OAuth broker.

### Key Features

- 📊 **Instagram Organic Analytics** - Post performance, engagement, follower insights
- 💰 **Meta Ads Intelligence** - Campaign performance, ad creative analysis
- 🔍 **Competitor Analysis** - Track competitor ads and strategies
- 🤖 **AI-Powered Recommendations** - Content and campaign suggestions
- 🔐 **Complete Data Isolation** - Each client on separate VM
- 🚀 **Scalable Architecture** - Up to 500 clients (Development Mode)

---

## 🏗️ Architecture

```
                    ┌────────────────────┐
                    │   Meta App         │
                    │ (Development Mode) │
                    └─────────┬──────────┘
                              │
                    ┌─────────▼──────────┐
                    │ Central OAuth      │
                    │ Broker (ONE)       │
                    │ - Routes tokens    │
                    │ - Client registry  │
                    └─────────┬──────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
    ┌────────┐            ┌────────┐          ┌────────┐
    │Client A│            │Client B│          │Client C│
    │  VM    │            │  VM    │          │  VM    │
    │        │            │        │          │        │
    │ n8n    │            │ n8n    │          │ n8n    │
    │ NocoDB │            │ NocoDB │          │ NocoDB │
    │ MCP    │            │ MCP    │          │ MCP    │
    └────────┘            └────────┘          └────────┘
```

---

## 📦 Project Structure

```
content-aiviary/
├── README.md                           ← You are here
├── PROJECT-STATUS.md                   ← Current implementation status
├── ARCHITECTURE.md                     ← Detailed architecture
├── DEPLOYMENT-GUIDE.md                 ← Complete deployment instructions
│
├── nest-keeper/          ← Central OAuth service (ONE instance)
│   ├── README.md
│   ├── app/
│   │   ├── docker-compose.yml
│   │   ├── nest-keeper/
│   │   ├── database/
│   │   └── DEPLOYMENT.md
│   └── [future: separate git repo]
│
└── content-nest/        ← Client VM template (deployed per client)
    ├── README.md
    ├── app/
    │   ├── docker-compose.yml
    │   ├── credential-receiver/
    │   ├── n8n/
    │   ├── nocodb-mcp/
    │   └── CLIENT-VM-SETUP.md
    └── [future: separate git repo]
```

---

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- Domain with HTTPS (for OAuth)
- Meta Developer Account
- 2-3 hours for initial setup

### Step 1: Create Meta Developer App

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Create new app (Business type)
3. Add use cases:
   - ✅ Create & manage ads with Marketing API
   - ✅ Manage messaging & content on Instagram
   - ✅ Facebook Login for Business (auto-activated)
4. Note your App ID and App Secret

### Step 2: Deploy Central OAuth Broker

```bash
cd nest-keeper/app
cp .env.example .env
# Edit .env with your Meta App credentials
docker compose up -d
```

See: `nest-keeper/app/DEPLOYMENT.md`

### Step 3: Deploy First Client VM

```bash
cd content-nest/app
cp .env.EXAMPLE .env
# Edit .env with client-specific settings
docker compose up -d
```

See: `content-nest/app/CLIENT-VM-SETUP.md`

### Step 4: Test OAuth Flow

1. Register client in central broker
2. Add yourself as Meta app tester
3. Visit: `https://oauth.yourdomain.com/auth/meta?client_id=test-client`
4. Complete authorization
5. Verify credentials in client VM's NocoDB

---

## 📚 Documentation

| Document | Purpose | Location |
|----------|---------|----------|
| **Project Status** | Current implementation status, what's built, what's TODO | [`PROJECT-STATUS.md`](./PROJECT-STATUS.md) |
| **Architecture Guide** | Detailed technical architecture | [`ARCHITECTURE.md`](./ARCHITECTURE.md) |
| **Deployment Guide** | Complete deployment instructions | [`DEPLOYMENT-GUIDE.md`](./DEPLOYMENT-GUIDE.md) |
| **OAuth Broker Docs** | Central OAuth service setup | [`nest-keeper/`](./nest-keeper/) |
| **Client VM Docs** | Per-client VM setup | [`content-nest/`](./content-nest/) |

---

## 🎯 Use Cases

### For Agencies

- Manage 50+ client Instagram accounts
- Provide monthly analytics reports
- AI-powered content recommendations
- Competitor intelligence dashboards

### For Consultants

- White-label social media intelligence
- Automated client onboarding
- Self-service analytics portals
- Usage-based pricing models

### For SaaS Builders

- Multi-tenant infrastructure template
- OAuth architecture reference
- Scalable VM deployment pattern
- Development Mode → Live Mode transition path

---

## 🔐 Security & Compliance

### Development Mode (Current)

- ✅ Up to 500 clients as "App Testers"
- ✅ Full API access
- ✅ No business verification required
- ✅ Perfect for MVP and beta testing

### Live Mode (Future)

- Requires business verification
- Requires Tech Provider status
- Public app (anyone can authorize)
- See transition guide in docs

### Data Security

- ✅ Complete client data isolation
- ✅ Encrypted credential storage (AES-256)
- ✅ VM-to-VM authentication via API keys
- ✅ OAuth event logging and audit trails
- ✅ No central storage of client tokens

---

## 🛠️ Technology Stack

### Central OAuth Broker

- Node.js (Express)
- PostgreSQL
- Redis
- Docker

### Client VMs

- n8n (workflow automation)
- NocoDB (database & API)
- OpenWebUI (AI interface)
- MCP Servers (Meta Ads, Instagram)
- PostgreSQL, Redis

---

## 📈 Roadmap

### ✅ Phase 1: OAuth Infrastructure (COMPLETE)

- [x] Central OAuth broker
- [x] Client VM credential receiver
- [x] Multi-tenant architecture
- [x] Documentation

### 🚧 Phase 2: Data Integration (IN PROGRESS)

- [ ] Meta Ads MCP server
- [ ] Instagram Analytics MCP server
- [ ] n8n workflow templates
- [ ] Data models in NocoDB

### 📋 Phase 3: Client Experience (PLANNED)

- [ ] Onboarding pages
- [ ] Analytics dashboards
- [ ] AI recommendation engine
- [ ] Email reporting

### 🚀 Phase 4: Scale & Polish (FUTURE)

- [ ] Automated VM provisioning
- [ ] Billing integration
- [ ] Admin dashboard
- [ ] Client portal

---

## 🤝 Contributing

This platform consists of two separate repositories:

1. **nest-keeper** - OAuth infrastructure
2. **content-nest** - Client VM template

Each will have its own GitHub repo with:
- Independent version control
- Separate issue tracking
- Individual contribution guidelines

---

## 📄 License

[Choose appropriate license]

---

## 🆘 Support & Documentation

- **Getting Started**: See [`DEPLOYMENT-GUIDE.md`](./DEPLOYMENT-GUIDE.md)
- **Current Status**: See [`PROJECT-STATUS.md`](./PROJECT-STATUS.md)
- **Architecture**: See [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **Issues**: Create issue in respective repo

---

## 🎓 Learning Resources

This project demonstrates:

- Multi-tenant SaaS architecture
- OAuth 2.0 token brokering
- Distributed systems design
- Docker-based isolation
- MCP (Model Context Protocol) integration
- n8n workflow automation
- AI agent orchestration

Perfect for learning modern cloud-native architecture patterns!

---

**Built with ❤️ for agencies and consultants who love automation**
