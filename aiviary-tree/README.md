# Rikk Consulting automation platform
---
A template for a potential "one stop deployment" for everything a client might need to start automating.


- [x] Docker
- [ ] Webserver
- [ ] Server Setup
- [ ] New services?

#### How to...
You will need:
- Docker
- A browser

Open a terminal and:
```bash
git clone https://github.com/f0rg3t3ch/Rikk-consulting-automation-platform.git \
  && cp app/.env.EXAMPLE app/.env \
  && cd app \
  && docker compose up -d
```
N8N: http://localhost:5678
OpenWebUI: http://localhost:3000