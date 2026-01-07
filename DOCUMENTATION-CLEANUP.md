# Documentation Cleanup Summary

**Date**: 2026-01-06
**Action**: Archived outdated/redundant documentation

---

## What Was Archived

The following files were moved to `.archived-docs/`:

1. ✅ **ARCHITECTURE.md** → Superseded by STAGE-1-ARCHITECTURE-BLUEPRINT.md
2. ✅ **MULTI_PLATFORM_OAUTH_IMPLEMENTATION.md** → Covered in blueprint
3. ✅ **content-nest/app/COMMENT_FEATURE.md** → Unimplemented feature proposal
4. ✅ **content-nest/app/IMPLEMENTATION_PLAN.md** → Completed implementation
5. ✅ **content-nest/app/SETUP_FIXES.md** → Resolved temporary issues
6. ✅ **content-nest/app/database/nocodb-meta-credentials-schema.md** → NocoDB no longer used

---

## Current Active Documentation Structure

```
content-aiviary/
├── CLAUDE.md                         ✅ Project instructions for Claude
├── README.md                         ✅ Main project overview
├── STAGE-1-ARCHITECTURE-BLUEPRINT.md ✅ Complete Stage 1 architecture
├── SEPARATION-STATUS.md              ✅ Migration progress tracking
├── CREDENTIALS-FLOW.md               ✅ OAuth and credential flow
├── DOCUMENTATION-CLEANUP.md          ✅ This file
│
├── .archived-docs/                   📦 Outdated/superseded docs
│   ├── README.md                     (explains archive)
│   ├── ARCHITECTURE.md
│   ├── MULTI_PLATFORM_OAUTH_IMPLEMENTATION.md
│   ├── COMMENT_FEATURE.md
│   ├── IMPLEMENTATION_PLAN.md
│   ├── SETUP_FIXES.md
│   └── nocodb-meta-credentials-schema.md
│
├── aiviary-core/                     ✅ Layer 2: Core services
│   └── README.md                     (comprehensive documentation)
│
├── nest-keeper/                      ✅ Layer 1: OAuth broker
│   ├── README.md
│   └── app/DEPLOYMENT.md
│
└── content-nest/                     ✅ Will become meta-nest
    ├── README.md
    └── app/docs/                     ✅ Active operational docs
        ├── ANALYTICS_AGENT_PROMPT.md (will convert to Skills)
        ├── BRAND_GUIDE.md
        ├── CLIENT-VM-SETUP.md
        ├── MCP-SERVICES-DOCUMENTATION.md
        ├── N8N-QUICK-START.md
        └── README.md
```

---

## Documentation Hierarchy

### Architecture & Planning (Top Level)
- **STAGE-1-ARCHITECTURE-BLUEPRINT.md** - Source of truth for architecture
- **SEPARATION-STATUS.md** - Migration roadmap and progress
- **CREDENTIALS-FLOW.md** - Technical flow documentation
- **CLAUDE.md** - AI assistant project instructions

### Service-Level Documentation
- **aiviary-core/README.md** - Layer 2 core services (platform-agnostic)
- **nest-keeper/README.md** - Layer 1 OAuth broker
- **content-nest/README.md** - Meta nest (Instagram/Ads)

### Operational Documentation
- **content-nest/app/docs/** - Implementation guides, MCP docs, setup guides

---

## What To Read First (Onboarding Guide)

**If you're new to the project:**
1. Start with `/README.md` - Project overview
2. Read `/STAGE-1-ARCHITECTURE-BLUEPRINT.md` - Understand the 3-layer architecture
3. Read `/SEPARATION-STATUS.md` - See current migration progress
4. Read `/aiviary-core/README.md` - Understand Layer 2
5. Read `/content-nest/app/docs/CLIENT-VM-SETUP.md` - Deployment guide

**If you're implementing a new nest:**
1. Read `/STAGE-1-ARCHITECTURE-BLUEPRINT.md` Section III or IV (YouTube/Asana examples)
2. Study `/content-nest/` structure (meta-nest reference implementation)
3. Follow pattern: sync-worker, enrichment-worker, MCP servers, skills

**If you're debugging:**
1. Check `/CREDENTIALS-FLOW.md` - How OAuth works
2. Check `/content-nest/app/docs/MCP-SERVICES-DOCUMENTATION.md` - MCP API reference
3. Check service-specific logs

---

## Cleanup Reasoning

### Why Archive Instead of Delete?

1. **Safety**: Easy to restore if needed
2. **History**: Preserves implementation decisions
3. **Learning**: Shows evolution of architecture
4. **Verification**: Can compare old vs new approaches

### When to Permanently Delete?

After:
- ✅ Stage 1 architecture fully deployed
- ✅ YouTube-nest successfully added (validates modularity)
- ✅ At least 1 month of production stability
- ✅ All information verified in new docs

**Earliest safe deletion**: March 2026

---

## Documentation Maintenance

### Adding New Documentation

**New architecture docs**: Add to top level
**New service docs**: Add to service's directory (e.g., `youtube-nest/README.md`)
**New operational guides**: Add to `content-nest/app/docs/` or new nest's `docs/`

### Updating Documentation

When architecture changes:
1. Update `/STAGE-1-ARCHITECTURE-BLUEPRINT.md` first (source of truth)
2. Update affected service READMEs
3. Update `/SEPARATION-STATUS.md` progress tracking

### Deprecating Documentation

When a doc becomes outdated:
1. Move to `.archived-docs/`
2. Update `.archived-docs/README.md` with reason
3. Update this file (DOCUMENTATION-CLEANUP.md)
4. Update references in other docs

---

## Quick Reference: Where to Find What

**"How does OAuth work?"**
→ `/CREDENTIALS-FLOW.md`

**"What's the overall architecture?"**
→ `/STAGE-1-ARCHITECTURE-BLUEPRINT.md`

**"How do I add a new platform nest?"**
→ `/STAGE-1-ARCHITECTURE-BLUEPRINT.md` Section III, IV, or V (examples)

**"How do I deploy a client VM?"**
→ `/content-nest/app/docs/CLIENT-VM-SETUP.md`

**"What are the MCP server endpoints?"**
→ `/content-nest/app/docs/MCP-SERVICES-DOCUMENTATION.md`

**"How do Skills work?"**
→ `/STAGE-1-ARCHITECTURE-BLUEPRINT.md` Section VI

**"How do I set up n8n workflows?"**
→ `/content-nest/app/docs/N8N-QUICK-START.md`

**"What's the current migration status?"**
→ `/SEPARATION-STATUS.md`

**"What's aiviary-core?"**
→ `/aiviary-core/README.md`

---

## Files NOT Archived (Still Active)

### Top Level
- ✅ `CLAUDE.md` - AI assistant instructions (actively used)
- ✅ `README.md` - Main project overview
- ✅ `STAGE-1-ARCHITECTURE-BLUEPRINT.md` - Current architecture
- ✅ `SEPARATION-STATUS.md` - Active migration tracking
- ✅ `CREDENTIALS-FLOW.md` - Still accurate technical doc

### Service Documentation
- ✅ All `nest-keeper/` docs (Layer 1 active)
- ✅ All `aiviary-core/` docs (Layer 2 active)
- ✅ All `content-nest/` docs (becoming meta-nest)

### Operational Guides
- ✅ `content-nest/app/docs/ANALYTICS_AGENT_PROMPT.md` - Will convert to Skills
- ✅ `content-nest/app/docs/CLIENT-VM-SETUP.md` - Active setup guide
- ✅ `content-nest/app/docs/MCP-SERVICES-DOCUMENTATION.md` - Active API reference
- ✅ `content-nest/app/docs/N8N-QUICK-START.md` - Active workflow guide
- ✅ `content-nest/app/docs/BRAND_GUIDE.md` - Marketing/brand guidelines

---

**Last Updated**: 2026-01-06
**Next Review**: After YouTube-nest deployment (Week 4-5)
