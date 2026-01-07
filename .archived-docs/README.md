# Archived Documentation

**Date Archived**: 2026-01-06
**Reason**: Stage 1 architecture separation and reorganization

This directory contains documentation that is no longer relevant or has been superseded by newer, more comprehensive documents.

---

## Archived Files

### 1. ARCHITECTURE.md
**Reason**: Superseded by `STAGE-1-ARCHITECTURE-BLUEPRINT.md`

Old architecture documentation describing the centralized OAuth broker pattern. While the concepts are still valid, the Stage 1 Blueprint provides much more comprehensive and up-to-date architectural guidance.

**Status**: Outdated
**Replacement**: `/STAGE-1-ARCHITECTURE-BLUEPRINT.md`

---

### 2. MULTI_PLATFORM_OAUTH_IMPLEMENTATION.md
**Reason**: Covered in Stage 1 Blueprint (Section I, II, IV)

Implementation plan for multi-platform OAuth (Meta, Asana, Google). This was a planning document that has been absorbed into the comprehensive blueprint.

**Status**: Superseded
**Replacement**: `/STAGE-1-ARCHITECTURE-BLUEPRINT.md` (OAuth flows described in detail)

---

### 3. COMMENT_FEATURE.md
**Reason**: Unimplemented feature proposal

Proposed feature for fetching and analyzing Instagram comments. This was never implemented and is not part of Stage 1 scope.

**Status**: Proposed (not implemented)
**Future**: May be revisited in Stage 2 or later

---

### 4. IMPLEMENTATION_PLAN.md
**Reason**: Completed implementation (Phase 5 complete)

Implementation plan for multimodal embeddings and audio transcription. This work has been completed - all posts now have embeddings, videos are transcribed, and the enrichment pipeline is operational.

**Status**: Completed ✅
**Outcome**: Successfully implemented as documented

---

### 5. SETUP_FIXES.md
**Reason**: Temporary troubleshooting doc for resolved issues

Document tracking setup issues and fixes from January 2, 2026. These were temporary problems that have been resolved and incorporated into the main setup scripts.

**Status**: Resolved
**Replacement**: Issues fixed in `setup.sh` and deployment scripts

---

### 6. nocodb-meta-credentials-schema.md
**Reason**: NocoDB no longer used for credentials

Schema documentation for NocoDB meta_credentials table. The system now uses PostgreSQL directly via credential-receiver service, storing credentials in the `analytics` database.

**Status**: Outdated (architecture changed)
**Replacement**: PostgreSQL schema in `content-nest/app/database/migrations/`

---

## Current Active Documentation

For up-to-date information, refer to:

**Architecture & Planning:**
- `/STAGE-1-ARCHITECTURE-BLUEPRINT.md` - Complete Stage 1 architecture
- `/SEPARATION-STATUS.md` - Current migration progress
- `/CREDENTIALS-FLOW.md` - How OAuth and credentials work

**Core Services:**
- `/aiviary-core/README.md` - Layer 2 core services
- `/nest-keeper/README.md` - Layer 1 OAuth broker
- `/content-nest/README.md` - Meta nest (becoming meta-nest)

**Operational Docs:**
- `/content-nest/app/docs/` - Current implementation docs
  - `ANALYTICS_AGENT_PROMPT.md` - Agent instructions (will become Skills)
  - `CLIENT-VM-SETUP.md` - VM setup guide
  - `MCP-SERVICES-DOCUMENTATION.md` - MCP server API reference
  - `N8N-QUICK-START.md` - n8n workflow guide

---

## Restoration

If you need any of these archived documents for reference:
```bash
# View archived files
ls -la /home/rikk/services/content-aiviary/.archived-docs/

# Restore a specific file
cp .archived-docs/ARCHITECTURE.md ./ARCHITECTURE.md.backup
```

---

## Cleanup Policy

These archived files can be safely deleted after:
1. Stage 1 architecture is fully deployed and validated
2. All migration steps are complete
3. New documentation is proven comprehensive

**Earliest safe deletion**: After successful youtube-nest deployment (Week 4-5 of migration)
