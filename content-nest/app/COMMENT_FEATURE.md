# Instagram Comments Feature Implementation Plan

**Status:** Proposed Feature (Not Yet Implemented)
**Created:** 2026-01-04
**Architecture:** Additive Only - No Breaking Changes

---

## Executive Summary

Add support for fetching, storing, and analyzing Instagram post comments via the Graph API. This feature will enable sentiment analysis, community engagement insights, and FAQ identification without modifying any existing functionality.

**Key Principle:** All changes are ADDITIVE ONLY. No existing tables, functions, or workflows will be modified.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│ EXISTING FLOW (UNCHANGED)                                           │
│ OAuth → Sync Posts → Sync Insights → Enrich Embeddings             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│ NEW COMMENT FLOW (PARALLEL)                                         │
│ After Posts Sync → Fetch Comments → Store → Analyze                │
└─────────────────────────────────────────────────────────────────────┘
```

**Integration Point:** Comments are fetched AFTER posts are synced, as a separate parallel operation.

---

## Database Schema Changes

### New Table: `instagram_post_comments`

```sql
-- Migration: 005_add_comments_support.sql

CREATE TABLE IF NOT EXISTS instagram_post_comments (
  id VARCHAR(255) PRIMARY KEY,              -- Instagram comment ID
  post_id VARCHAR(255) NOT NULL,            -- Foreign key to instagram_posts.id
  client_id VARCHAR(255) NOT NULL,          -- For multi-tenant support
  username VARCHAR(255),                    -- Comment author username
  text TEXT,                                -- Comment content
  like_count INTEGER DEFAULT 0,             -- Likes on this comment
  timestamp TIMESTAMP WITH TIME ZONE,       -- When comment was posted
  is_hidden BOOLEAN DEFAULT FALSE,          -- Hidden by post owner
  parent_comment_id VARCHAR(255),           -- For nested replies (NULL if top-level)
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  FOREIGN KEY (post_id, client_id) REFERENCES instagram_posts(id, client_id) ON DELETE CASCADE,
  UNIQUE(id, client_id)
);

-- Indexes for fast queries
CREATE INDEX idx_comments_post_id ON instagram_post_comments(post_id, client_id);
CREATE INDEX idx_comments_timestamp ON instagram_post_comments(timestamp DESC);
CREATE INDEX idx_comments_parent ON instagram_post_comments(parent_comment_id) WHERE parent_comment_id IS NOT NULL;

-- Full-text search on comment text
CREATE INDEX idx_comments_text_search ON instagram_post_comments USING gin(to_tsvector('english', text));

-- Comment metadata
COMMENT ON TABLE instagram_post_comments IS 'Instagram comments and replies fetched via Graph API';
COMMENT ON COLUMN instagram_post_comments.parent_comment_id IS 'NULL for top-level comments, comment_id for replies';
COMMENT ON COLUMN instagram_post_comments.is_hidden IS 'True if comment was hidden by post owner';
```

### New Table: `comment_sync_status`

```sql
-- Track which posts have had comments synced

CREATE TABLE IF NOT EXISTS comment_sync_status (
  post_id VARCHAR(255) NOT NULL,
  client_id VARCHAR(255) NOT NULL,
  last_comment_sync TIMESTAMP WITH TIME ZONE,
  total_comments_synced INTEGER DEFAULT 0,
  has_more_comments BOOLEAN DEFAULT FALSE,  -- Pagination indicator
  next_cursor VARCHAR(255),                  -- Pagination cursor
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  PRIMARY KEY (post_id, client_id),
  FOREIGN KEY (post_id, client_id) REFERENCES instagram_posts(id, client_id) ON DELETE CASCADE
);

CREATE INDEX idx_comment_sync_status_last_sync ON comment_sync_status(last_comment_sync);
```

### No Changes to Existing Tables

✅ `instagram_posts` - UNCHANGED (already has `comments_count`)
✅ `instagram_post_insights` - UNCHANGED
✅ `sync_jobs` - UNCHANGED (will reuse for comment sync jobs)
✅ All other tables - UNCHANGED

---

## Instagram Graph API Integration

### New API Endpoint

```javascript
// sync-worker/lib/instagram.js - ADD NEW FUNCTION

/**
 * Get comments for a specific Instagram media post
 *
 * @param {string} clientId - Client identifier
 * @param {string} mediaId - Instagram media ID
 * @param {string} cursor - Pagination cursor (optional)
 * @returns {Promise<Object>} Comments data with pagination
 */
async function getPostComments(clientId, mediaId, cursor = null) {
  const credentials = await getClientCredentials(clientId);

  const params = {
    fields: 'id,username,text,timestamp,like_count,hidden,replies{id,username,text,timestamp,like_count}',
    limit: 100  // Max per request
  };

  if (cursor) {
    params.after = cursor;  // Pagination
  }

  return await callInstagramAPI(`/${mediaId}/comments`, params, credentials.access_token);
}

// Export the new function
module.exports = {
  // ... existing exports
  getPostComments,  // NEW
};
```

**API Rate Limits:**
- Same 200 requests/hour limit as other endpoints
- Uses existing rate limiter in `sync-worker/lib/rateLimiter.js`

---

## Sync Worker Implementation

### 1. Backfill Comments (Historical Data)

```javascript
// sync-worker/jobs/backfill.js - ADD NEW FUNCTION

/**
 * Backfill comments for all posts
 * Runs once after initial OAuth setup
 */
async function backfillComments(clientId) {
  logger.sync(clientId, 'Backfilling post comments');

  // Get all posts with comments_count > 0
  const result = await db.query(
    `
    SELECT id, comments_count
    FROM instagram_posts
    WHERE client_id = $1
      AND comments_count > 0
      AND is_deleted = FALSE
    ORDER BY timestamp DESC
  `,
    [clientId]
  );

  let totalCommentsFetched = 0;

  for (const post of result.rows) {
    try {
      let hasMore = true;
      let cursor = null;
      let postCommentCount = 0;

      while (hasMore) {
        const commentsResponse = await instagram.getPostComments(clientId, post.id, cursor);
        const comments = commentsResponse.data || [];

        // Store comments
        for (const comment of comments) {
          await storeComment(clientId, post.id, comment);
          postCommentCount++;

          // Store replies (nested comments)
          if (comment.replies && comment.replies.data) {
            for (const reply of comment.replies.data) {
              await storeComment(clientId, post.id, reply, comment.id);  // parent_comment_id
              postCommentCount++;
            }
          }
        }

        // Check pagination
        hasMore = commentsResponse.paging && commentsResponse.paging.next;
        cursor = commentsResponse.paging?.cursors?.after || null;

        totalCommentsFetched += comments.length;
      }

      // Update sync status
      await db.query(
        `
        INSERT INTO comment_sync_status (post_id, client_id, last_comment_sync, total_comments_synced)
        VALUES ($1, $2, NOW(), $3)
        ON CONFLICT (post_id, client_id)
        DO UPDATE SET
          last_comment_sync = NOW(),
          total_comments_synced = $3,
          updated_at = NOW()
      `,
        [post.id, clientId, postCommentCount]
      );

      logger.sync(clientId, `Fetched ${postCommentCount} comments for post ${post.id}`);

    } catch (error) {
      logger.warn(`Failed to fetch comments for post ${post.id}`, { error: error.message });
      // Continue with other posts
    }
  }

  logger.sync(clientId, 'Comments backfill complete', { total: totalCommentsFetched });
  return totalCommentsFetched;
}

/**
 * Store a single comment in the database
 */
async function storeComment(clientId, postId, comment, parentCommentId = null) {
  await db.query(
    `
    INSERT INTO instagram_post_comments (
      id, post_id, client_id, username, text, like_count,
      timestamp, is_hidden, parent_comment_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (id, client_id)
    DO UPDATE SET
      text = EXCLUDED.text,
      like_count = EXCLUDED.like_count,
      is_hidden = EXCLUDED.is_hidden,
      updated_at = NOW()
  `,
    [
      comment.id,
      postId,
      clientId,
      comment.username || 'unknown',
      comment.text || '',
      comment.like_count || 0,
      comment.timestamp || null,
      comment.hidden || false,
      parentCommentId
    ]
  );
}

// Add to backfill workflow (AFTER existing steps)
async function run(job) {
  // ... existing backfill steps (posts, insights, etc.)

  // NEW: Backfill comments (runs AFTER posts are synced)
  const commentsCount = await backfillComments(client_id);
  stats.instagram_comments = commentsCount;  // Add to stats

  // ... rest of backfill
}
```

### 2. Daily Comment Sync (Incremental Updates)

```javascript
// sync-worker/jobs/dailySync.js - ADD NEW FUNCTION

/**
 * Sync new comments on recent posts
 * Runs daily to catch new comments
 */
async function syncRecentComments(clientId) {
  logger.sync(clientId, 'Syncing recent comments');

  // Get posts from last 30 days that might have new comments
  const result = await db.query(
    `
    SELECT p.id, p.comments_count, cs.total_comments_synced
    FROM instagram_posts p
    LEFT JOIN comment_sync_status cs ON p.id = cs.post_id AND p.client_id = cs.client_id
    WHERE p.client_id = $1
      AND p.timestamp >= NOW() - INTERVAL '30 days'
      AND p.is_deleted = FALSE
      AND (
        p.comments_count > COALESCE(cs.total_comments_synced, 0)  -- New comments detected
        OR cs.last_comment_sync IS NULL                            -- Never synced
        OR cs.last_comment_sync < NOW() - INTERVAL '7 days'       -- Resync weekly
      )
    ORDER BY p.timestamp DESC
  `,
    [clientId]
  );

  let newCommentsFetched = 0;

  for (const post of result.rows) {
    try {
      const commentsResponse = await instagram.getPostComments(clientId, post.id);
      const comments = commentsResponse.data || [];

      for (const comment of comments) {
        await storeComment(clientId, post.id, comment);

        if (comment.replies && comment.replies.data) {
          for (const reply of comment.replies.data) {
            await storeComment(clientId, post.id, reply, comment.id);
          }
        }
      }

      newCommentsFetched += comments.length;

      // Update sync status
      await db.query(
        `
        INSERT INTO comment_sync_status (post_id, client_id, last_comment_sync, total_comments_synced)
        VALUES ($1, $2, NOW(), $3)
        ON CONFLICT (post_id, client_id)
        DO UPDATE SET
          last_comment_sync = NOW(),
          total_comments_synced = $3,
          updated_at = NOW()
      `,
        [post.id, clientId, comments.length]
      );

    } catch (error) {
      logger.warn(`Failed to sync comments for post ${post.id}`, { error: error.message });
    }
  }

  logger.sync(clientId, 'Comment sync complete', { newComments: newCommentsFetched });
  return newCommentsFetched;
}

// Add to daily sync workflow (AFTER existing steps)
async function run(job) {
  // ... existing daily sync steps

  // NEW: Sync recent comments
  await syncRecentComments(client_id);

  // ... rest of daily sync
}
```

---

## Analytics Agent Integration

### Option 1: Add to Existing `hybrid_search` Tool

Update the tool description to mention comments are available:

```javascript
// analytics-agent/agent.py - UPDATE tool description

"description": """Searches and analyzes the user's private Instagram content...

AVAILABLE METRICS (Instagram Graph API):
- views, reach, engagement, saved, shares, likes, comments (count)
- transcript: Audio transcript for videos
- comment_text: Full comment text and replies (NEW)
- comment_authors: Who's commenting on posts (NEW)
- comment_sentiment: Analyze comment sentiment (NEW)
...
"""
```

### Option 2: Add New Tool `get_post_comments`

```python
# analytics-agent/agent.py - ADD NEW TOOL

def get_tools(self) -> List[Dict[str, Any]]:
    return [
        # ... existing hybrid_search tool

        # NEW TOOL
        {
            "name": "get_post_comments",
            "description": "Retrieves comments and replies for specific Instagram posts. Use this when the user asks about comments, community feedback, or what people are saying. Returns comment text, authors, timestamps, and like counts.",
            "input_schema": {
                "type": "object",
                "properties": {
                    "post_id": {
                        "type": "string",
                        "description": "Instagram post ID to get comments for. Use hybrid_search first to find relevant posts."
                    },
                    "limit": {
                        "type": "integer",
                        "description": "Maximum number of comments to return (default: 50)",
                        "default": 50
                    },
                    "sort_by": {
                        "type": "string",
                        "description": "Sort order: 'recent', 'likes', 'replies'",
                        "default": "recent"
                    }
                },
                "required": ["post_id"]
            }
        }
    ]

def _get_post_comments(self, post_id: str, limit: int = 50, sort_by: str = 'recent') -> Dict[str, Any]:
    """Fetch comments for a specific post"""
    conn = self.db.get_conn()
    try:
        # Determine sort order
        order_clause = {
            'recent': 'timestamp DESC',
            'likes': 'like_count DESC',
            'replies': 'parent_comment_id IS NOT NULL, timestamp DESC'
        }.get(sort_by, 'timestamp DESC')

        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT
                    id,
                    username,
                    text,
                    like_count,
                    timestamp,
                    is_hidden,
                    parent_comment_id
                FROM instagram_post_comments
                WHERE post_id = %s
                  AND client_id = 'client'
                  AND is_hidden = FALSE
                ORDER BY {order_clause}
                LIMIT %s
            """, (post_id, limit))

            comments = []
            for row in cur.fetchall():
                comments.append({
                    "id": row[0],
                    "username": row[1],
                    "text": row[2][:500],  # Truncate for token efficiency
                    "likes": row[3],
                    "timestamp": row[4].isoformat() if row[4] else None,
                    "is_reply": row[6] is not None
                })

            return {
                "post_id": post_id,
                "total_comments": len(comments),
                "comments": comments
            }
    finally:
        self.db.put_conn(conn)
```

### Option 3: Extend Helper Functions (SQL)

```sql
-- Add new SQL helper functions for comment analysis

-- Get most active commenters
CREATE OR REPLACE FUNCTION get_top_commenters(days_param INTEGER DEFAULT 30, limit_param INTEGER DEFAULT 10)
RETURNS TABLE (
  username VARCHAR,
  total_comments BIGINT,
  total_likes BIGINT,
  avg_likes_per_comment NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.username,
    COUNT(*) as total_comments,
    SUM(c.like_count) as total_likes,
    ROUND(AVG(c.like_count), 2) as avg_likes_per_comment
  FROM instagram_post_comments c
  JOIN instagram_posts p ON c.post_id = p.id AND c.client_id = p.client_id
  WHERE c.client_id = 'client'
    AND p.timestamp >= CURRENT_DATE - INTERVAL '1 day' * days_param
    AND c.is_hidden = FALSE
  GROUP BY c.username
  ORDER BY total_comments DESC
  LIMIT limit_param;
END;
$$ LANGUAGE plpgsql;

-- Find posts with most engaged comments
CREATE OR REPLACE FUNCTION get_posts_by_comment_engagement(limit_param INTEGER DEFAULT 10)
RETURNS TABLE (
  post_id VARCHAR,
  total_comments BIGINT,
  total_comment_likes BIGINT,
  unique_commenters BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.post_id,
    COUNT(*) as total_comments,
    SUM(c.like_count) as total_comment_likes,
    COUNT(DISTINCT c.username) as unique_commenters
  FROM instagram_post_comments c
  WHERE c.client_id = 'client'
    AND c.is_hidden = FALSE
  GROUP BY c.post_id
  ORDER BY total_comments DESC
  LIMIT limit_param;
END;
$$ LANGUAGE plpgsql;

-- Search comments by keyword
CREATE OR REPLACE FUNCTION search_comments(search_query TEXT, limit_param INTEGER DEFAULT 50)
RETURNS TABLE (
  comment_id VARCHAR,
  post_id VARCHAR,
  username VARCHAR,
  text TEXT,
  timestamp TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    c.id,
    c.post_id,
    c.username,
    c.text,
    c.timestamp
  FROM instagram_post_comments c
  WHERE c.client_id = 'client'
    AND c.is_hidden = FALSE
    AND to_tsvector('english', c.text) @@ plainto_tsquery('english', search_query)
  ORDER BY c.timestamp DESC
  LIMIT limit_param;
END;
$$ LANGUAGE plpgsql;
```

---

## Testing Plan

### Phase 1: Database Schema
```bash
# Apply migration
docker compose exec postgres psql -U postgres-non-root -d analytics -f /docker-entrypoint-initdb.d/005_add_comments_support.sql

# Verify tables created
docker compose exec postgres psql -U postgres-non-root -d analytics -c "\dt" | grep comment
```

### Phase 2: Sync Worker - Single Post Test
```javascript
// Test with one post manually
const testPostId = '18085691936090865';  // Post with 14 comments
const comments = await instagram.getPostComments('client', testPostId);
console.log(`Fetched ${comments.data.length} comments`);
```

### Phase 3: Backfill Test (Small Batch)
```bash
# Modify backfill to process only 5 posts for testing
# Run backfill
# Verify comments stored in database
docker compose exec postgres psql -U postgres-non-root -d analytics -c "
SELECT COUNT(*) FROM instagram_post_comments WHERE client_id = 'client';
"
```

### Phase 4: Analytics Agent Integration
```bash
# Test new tool in OpenWebUI
# Query: "What are people saying in the comments on my top post?"
# Verify comments are returned without hallucination
```

---

## Rollback Plan

If anything breaks:

```sql
-- Drop new tables (comments data is deleted)
DROP TABLE IF EXISTS comment_sync_status CASCADE;
DROP TABLE IF EXISTS instagram_post_comments CASCADE;

-- Drop new helper functions
DROP FUNCTION IF EXISTS get_top_commenters(INTEGER, INTEGER);
DROP FUNCTION IF EXISTS get_posts_by_comment_engagement(INTEGER);
DROP FUNCTION IF EXISTS search_comments(TEXT, INTEGER);
```

**No other rollback needed** - all changes are additive, existing functionality untouched.

---

## Performance Considerations

### Rate Limiting
- Comments API uses same 200 req/hour limit
- Backfill should process ~100 posts/hour max
- Daily sync targets only recent posts (30 days)

### Database Size
- Average comment: ~200 bytes
- 1000 posts × 10 comments = 10,000 rows = ~2 MB
- Minimal storage impact

### Query Performance
- Indexes on `post_id`, `timestamp`, `username`
- Full-text search index on comment text
- Should handle 100k+ comments efficiently

---

## Use Cases Enabled

1. **Sentiment Analysis**: "What's the overall sentiment in my comments?"
2. **FAQ Detection**: "What questions do people keep asking?"
3. **Community Insights**: "Who are my most engaged commenters?"
4. **Content Feedback**: "What do people say about my fitness videos?"
5. **Trend Detection**: "Are people mentioning specific products?"

---

## Cost Estimate

- **API Calls**: Same rate limit, no additional cost
- **Storage**: ~2 MB per 1000 posts (negligible)
- **Processing**: ~5 min for backfill of 100 posts

**Total Additional Cost**: ~$0 (uses existing infrastructure)

---

## Implementation Checklist

- [ ] Create migration `005_add_comments_support.sql`
- [ ] Add `getPostComments()` to `sync-worker/lib/instagram.js`
- [ ] Add `backfillComments()` to `sync-worker/jobs/backfill.js`
- [ ] Add `syncRecentComments()` to `sync-worker/jobs/dailySync.js`
- [ ] Add helper functions to database
- [ ] Update analytics-agent with new tool OR extend hybrid_search
- [ ] Test on single post
- [ ] Test backfill (small batch)
- [ ] Test daily sync
- [ ] Test analytics queries
- [ ] Document in ANALYTICS_AGENT_PROMPT.md

---

## Future Enhancements (Post-Implementation)

1. **Sentiment Scoring**: Use LLM to score comment sentiment (positive/negative/neutral)
2. **Auto-Reply Detection**: Track which comments were replied to by post owner
3. **Spam Detection**: Flag potential spam comments
4. **Keyword Alerts**: Notify when specific keywords appear in comments
5. **Comment Trends**: Track trending topics in comments over time

---

**End of Document**
