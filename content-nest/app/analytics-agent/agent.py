import os
import json
from typing import List, Dict, Any, Optional

import anthropic
import vertexai
from vertexai.vision_models import MultiModalEmbeddingModel
from psycopg2.pool import SimpleConnectionPool
from pgvector.psycopg2 import register_vector

# ============================================================================
# AGENT CONFIGURATION
# ============================================================================

class AgentConfig:
    def __init__(self, path: str = 'agent_config.json'):
        with open(path, 'r') as f:
            config = json.load(f)
        self.model_name: str = config['model_name']
        self.max_tokens: int = config.get('max_tokens', 4096)
        self.system_prompt: str = config['system_prompt']

# ============================================================================
# DATABASE CONNECTION
# ============================================================================

class Database:
    def __init__(self):
        self.pool = SimpleConnectionPool(
            minconn=1,
            maxconn=5,
            host=os.getenv("POSTGRES_HOST", "postgres"),
            port=os.getenv("POSTGRES_PORT", "5432"),
            dbname=os.getenv("POSTGRES_DB", "analytics"),
            user=os.getenv("POSTGRES_USER"),
            password=os.getenv("POSTGRES_PASSWORD")
        )

    def get_conn(self):
        return self.pool.getconn()

    def put_conn(self, conn):
        self.pool.putconn(conn)

# ============================================================================
# CORE AGENT LOGIC
# ============================================================================

class AnalyticsAgent:
    def __init__(self, config: AgentConfig, db: Database):
        self.config = config
        self.db = db
        # Use AsyncAnthropic for async operations
        self.anthropic_client = anthropic.AsyncAnthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

        # Initialize Vertex AI for embeddings
        vertexai.init(
            project=os.getenv("GOOGLE_CLOUD_PROJECT"),
            location=os.getenv("VERTEX_AI_LOCATION", "us-central1")
        )
        self.embedding_model = MultiModalEmbeddingModel.from_pretrained("multimodalembedding@001")

    def get_tools(self) -> List[Dict[str, Any]]:
        """Defines the tools available to the Claude model."""
        return [
            {
                "name": "hybrid_search",
                "description": """Searches and analyzes the user's private Instagram content using multimodal embeddings. Use this to answer ANY question about their posts, performance, content strategy, or visual themes.

HOW IT WORKS:
- total_counts: Total number of posts in the date range, broken down by type (videos, images, carousels). Use this for answering "how many posts" questions.
- semantic_matches: Posts that are VISUALLY and contextually similar to your query (based on multimodal embeddings of images/videos + captions + audio transcripts)
- top_performers: Posts ranked by performance metrics (views, reach, engagement, etc.)

IMPORTANT: Always check total_counts first when answering questions about post quantity or volume. The semantic_matches and top_performers are SAMPLES, not the complete list.

VISUAL UNDERSTANDING:
All posts have multimodal embeddings that capture visual content (actual images/video frames), text (captions), and audio (transcripts). When you search for "workout videos" or "beach photos", the semantic matches will be visually similar posts. You CAN describe visual themes, settings, subjects, and patterns based on the matched posts and their captions.

AVAILABLE METRICS (Instagram Graph API):
- views: Total views on the post
- reach: Unique accounts who saw the post
- engagement: Total likes + comments
- saved: Number of saves
- shares: Number of shares
- likes: Individual like count
- comments: Individual comment count
- transcript: Audio transcript for videos (if video has audio)

UNAVAILABLE METRICS (NOT provided by Instagram Graph API):
- Video retention/drop-off rates (where viewers stop watching)
- Completion rate (% who watch to end)
- Average watch time
- Skip rate (% who leave in first 3 seconds)
- Audience retention graphs/charts
- Video watch time breakdowns

IMPORTANT: If the user asks about retention, drop-off, completion, or watch time metrics, you MUST clearly state that this data is not available via Instagram's API. These metrics only exist in Instagram's native app and cannot be accessed programmatically. DO NOT make up or estimate these statistics.""",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "query": {
                            "type": "string",
                            "description": "A natural language query describing the user's request. E.g., 'posts about our new product launch' or 'top performing content this month'."
                        },
                        "date_range": {
                            "type": "string",
                            "description": "Optional RELATIVE date range for the search. Options: '7d' (week), '30d' (month), '90d' (quarter), '365d' (year), '730d' (2 years), '1095d' (3 years), 'all' (all-time). Use this for recent/rolling windows like 'last week', 'this year', or 'last two years'. Defaults to '30d'. NOTE: Do NOT use this for specific months/quarters - use start_date/end_date instead.",
                            "default": "30d"
                        },
                        "start_date": {
                            "type": "string",
                            "description": "Optional ABSOLUTE start date in YYYY-MM-DD format. Use this for specific time periods like 'July 2025' (start_date='2025-07-01'), 'Q3' (start_date='2025-07-01'), or 'between Jan and March' (start_date='2025-01-01'). If provided, end_date must also be provided."
                        },
                        "end_date": {
                            "type": "string",
                            "description": "Optional ABSOLUTE end date in YYYY-MM-DD format. Use this with start_date for specific time periods like 'July 2025' (end_date='2025-07-31'), 'Q3' (end_date='2025-09-30'), or 'between Jan and March' (end_date='2025-03-31'). If provided, start_date must also be provided."
                        },
                        "metric": {
                            "type": "string",
                            "description": "Optional metric to prioritize for performance search. E.g., 'reach', 'engagement', 'saves', 'views'. Inferred if not provided.",
                            "default": None
                        }
                    },
                    "required": ["query"]
                }
            },
            {
                "name": "analyze_visual_patterns",
                "description": """Discovers visual themes and patterns in the user's content by clustering posts based on multimodal embeddings (visual similarity + captions + audio). Use this to answer questions about what types of content perform best, visual trends, and content strategy insights.

USE THIS TOOL WHEN:
- User asks about visual patterns, themes, or content types that work best
- Comparing performance across different visual styles or content categories
- Finding correlations between visual elements and engagement metrics
- User asks "what kind of content performs best" or "what visual themes work"
- Analyzing content strategy effectiveness

HOW IT WORKS:
1. Clusters posts by visual similarity using multimodal embeddings
2. Calculates average performance metrics for each cluster (reach, saves, engagement)
3. Identifies which visual themes correlate with high/low performance
4. Returns actionable insights about what content works

RETURNS:
- visual_clusters: Groups of similar posts with performance stats
- top_performing_themes: Visual themes with highest metrics
- underperforming_themes: Visual themes with lowest metrics
- insights: Actionable recommendations based on data

EXAMPLE QUERY: "What visual elements correlate with high engagement this month?"
RESULT: "Outdoor settings with bright lighting have 2.3x higher saves than indoor posts"

NOTE: This analyzes AVAILABLE metrics (reach, saves, engagement, views). Completion rate and retention are NOT available via Instagram's API.""",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "date_range": {
                            "type": "string",
                            "description": "RELATIVE date range. Options: '7d' (week), '30d' (month), '90d' (quarter), '365d' (year), '730d' (2 years), '1095d' (3 years), 'all' (all-time). Defaults to '30d'.",
                            "default": "30d"
                        },
                        "start_date": {
                            "type": "string",
                            "description": "Optional ABSOLUTE start date in YYYY-MM-DD format for specific time periods."
                        },
                        "end_date": {
                            "type": "string",
                            "description": "Optional ABSOLUTE end date in YYYY-MM-DD format. Must be used with start_date."
                        },
                        "metric": {
                            "type": "string",
                            "description": "Metric to analyze patterns for: 'reach', 'engagement', 'saved', 'views', 'total_interactions'. Defaults to 'saved' (best proxy for valuable content).",
                            "default": "saved"
                        },
                        "min_cluster_size": {
                            "type": "integer",
                            "description": "Minimum posts required per cluster to be considered significant. Defaults to 2.",
                            "default": 2
                        },
                        "num_clusters": {
                            "type": "integer",
                            "description": "Number of visual theme clusters to identify. Defaults to 5.",
                            "default": 5
                        }
                    },
                    "required": []
                }
            },
            {
                "name": "compare_periods",
                "description": """Compares two time periods to analyze growth, performance changes, and visual content evolution. Use this when the user wants to compare different time periods (e.g., "January 2024 vs January 2025", "Q1 vs Q2", "this month vs last month").

UNIQUE FEATURE: This tool analyzes BOTH metrics AND visual content themes between periods, showing how content strategy evolved.

RETURNS:
- period1_stats: Metrics for first period (post count, avg reach, engagement, saves, etc.)
- period2_stats: Metrics for second period
- growth_metrics: Percentage changes (post volume, reach growth, engagement delta)
- visual_analysis: How visual themes/content style changed between periods
- insights: Actionable recommendations based on what worked better

EXAMPLE QUERY: "Compare my performance from January 2024 to January 2025"
RESULT: "Jan 2025 had 45% more posts and 78% higher avg reach. Visual analysis shows Period 1 focused on indoor studio content, while Period 2 shifted to outdoor natural lighting themes (which correlated with the higher engagement)."

USE THIS INSTEAD OF making two separate hybrid_search calls when user asks to compare periods.""",
                "input_schema": {
                    "type": "object",
                    "properties": {
                        "period1_start": {
                            "type": "string",
                            "description": "Start date of first period in YYYY-MM-DD format. E.g., '2024-01-01' for January 2024."
                        },
                        "period1_end": {
                            "type": "string",
                            "description": "End date of first period in YYYY-MM-DD format. E.g., '2024-01-31' for January 2024."
                        },
                        "period2_start": {
                            "type": "string",
                            "description": "Start date of second period in YYYY-MM-DD format. E.g., '2025-01-01' for January 2025."
                        },
                        "period2_end": {
                            "type": "string",
                            "description": "End date of second period in YYYY-MM-DD format. E.g., '2025-01-31' for January 2025."
                        },
                        "metrics": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "Metrics to compare. Options: 'reach', 'saved', 'engagement', 'views', 'total_interactions'. Defaults to ['reach', 'saved', 'total_interactions'].",
                            "default": ["reach", "saved", "total_interactions"]
                        }
                    },
                    "required": ["period1_start", "period1_end", "period2_start", "period2_end"]
                }
            }
        ]

    def _generate_query_embedding(self, query: str) -> List[float]:
        """
        Generates a 1408-dimension text embedding for a user query using Vertex AI.
        This is compatible with the multimodal embeddings stored in the database.
        """
        # Use multimodal model with text-only input to get 1408-dimension embedding
        embeddings = self.embedding_model.get_embeddings(
            contextual_text=query[:1024],  # Limit to 1024 characters
            dimension=1408
        )
        return embeddings.text_embedding

    def _hybrid_search(self, query: str, date_range: str = '30d', start_date: Optional[str] = None, end_date: Optional[str] = None, metric: Optional[str] = None) -> Dict[str, Any]:
        """
        Hybrid search combining:
        1. Semantic search (pgvector similarity)
        2. Performance search (SQL helper functions)

        Supports two modes:
        - Relative: date_range='30d' (rolling window from today)
        - Absolute: start_date='2025-07-01', end_date='2025-07-31' (specific period)
        """
        print(f"[Analytics Agent] Executing hybrid search for query: '{query}', date_range: '{date_range}', start_date: '{start_date}', end_date: '{end_date}', metric: '{metric}'")

        # Determine date filtering mode
        if start_date and end_date:
            # Absolute date range mode
            date_filter_mode = "absolute"
            date_where_clause = "AND timestamp BETWEEN %s::date AND %s::date"
            date_params = (start_date, end_date)
            print(f"[Analytics Agent] Using ABSOLUTE date range: {start_date} to {end_date}")
        else:
            # Relative date range mode (rolling window)
            date_filter_mode = "relative"
            days_map = {
                '7d': 7,
                '30d': 30,
                '90d': 90,
                '365d': 365,
                '730d': 730,    # 2 years
                '1095d': 1095,  # 3 years
                'all': 10000    # All-time (effectively unlimited)
            }
            days = days_map.get(date_range, 30)
            date_where_clause = "AND timestamp >= CURRENT_DATE - INTERVAL '%s days'"
            date_params = (days,)
            print(f"[Analytics Agent] Using RELATIVE date range: {days} days ('{date_range}')")

        # Default metric
        metric = metric or 'reach'

        conn = self.db.get_conn()
        try:
            # 1. Generate query embedding
            print(f"[Analytics Agent] Generating query embedding...")
            query_embedding = self._generate_query_embedding(query)
            print(f"[Analytics Agent] Query embedding generated: {len(query_embedding)} dimensions")

            # 2. Semantic search (pgvector cosine similarity)
            print(f"[Analytics Agent] Running semantic search...")
            with conn.cursor() as cur:
                # Register vector type for this cursor
                register_vector(conn)

                # Build dynamic query with date filtering
                semantic_query = f"""
                    SELECT
                        id,
                        caption,
                        media_type,
                        permalink,
                        timestamp,
                        transcript,
                        1 - (embedding <=> %s::vector) as similarity
                    FROM instagram_posts
                    WHERE client_id = 'client'
                      AND embedding IS NOT NULL
                      {date_where_clause}
                      AND is_deleted = FALSE
                    ORDER BY embedding <=> %s::vector
                    LIMIT 5
                """

                cur.execute(semantic_query, (query_embedding, *date_params, query_embedding))

                semantic_results = []
                for row in cur.fetchall():
                    semantic_results.append({
                        "post_id": row[0],
                        "caption": row[1][:200] if row[1] else "",  # Truncate for token efficiency
                        "media_type": row[2],
                        "permalink": row[3],
                        "timestamp": row[4].isoformat() if row[4] else None,
                        "transcript": row[5],  # Full transcript
                        "similarity_score": float(row[6]) if row[6] else 0
                    })

                print(f"[Analytics Agent] Found {len(semantic_results)} semantically similar posts")

            # 3. Performance search
            print(f"[Analytics Agent] Running performance search for metric: {metric}")
            with conn.cursor() as cur:
                if date_filter_mode == "relative":
                    # Custom query instead of helper function to get permalink, caption, transcript
                    performance_query = f"""
                        SELECT
                            p.id as post_id,
                            p.media_type,
                            p.timestamp as post_timestamp,
                            i.{metric} as metric_value,
                            CASE
                                WHEN (i.reach > 0)
                                THEN ((i.total_interactions::float / i.reach) * 100)
                                ELSE 0
                            END as engagement_rate,
                            p.permalink,
                            p.caption,
                            p.transcript
                        FROM instagram_posts p
                        LEFT JOIN instagram_post_insights i ON p.id = i.post_id
                        WHERE p.client_id = 'client'
                          AND p.is_deleted = FALSE
                          {date_where_clause}
                        ORDER BY i.{metric} DESC NULLS LAST
                        LIMIT 10
                    """
                    cur.execute(performance_query, date_params)
                else:
                    # Custom query for absolute date ranges
                    performance_query = f"""
                        SELECT
                            p.id as post_id,
                            p.media_type,
                            p.timestamp as post_timestamp,
                            i.{metric} as metric_value,
                            CASE
                                WHEN (i.reach > 0)
                                THEN ((i.total_interactions::float / i.reach) * 100)
                                ELSE 0
                            END as engagement_rate,
                            p.permalink,
                            p.caption,
                            p.transcript
                        FROM instagram_posts p
                        LEFT JOIN instagram_post_insights i ON p.id = i.post_id
                        WHERE p.client_id = 'client'
                          AND p.is_deleted = FALSE
                          {date_where_clause}
                        ORDER BY i.{metric} DESC NULLS LAST
                        LIMIT 10
                    """
                    cur.execute(performance_query, date_params)

                performance_results = []
                for row in cur.fetchall():
                    performance_results.append({
                        "post_id": row[0],
                        "media_type": row[1],
                        "timestamp": row[2].isoformat() if row[2] else None,
                        "metric_value": int(row[3]) if row[3] else 0,
                        "engagement_rate": float(row[4]) if row[4] else 0,
                        "permalink": row[5],
                        "caption": row[6][:200] if row[6] else "",  # Truncate caption for token efficiency
                        "transcript": row[7]  # Full transcript
                    })

                print(f"[Analytics Agent] Found {len(performance_results)} top performing posts")

            # 4. Get total post counts (for accurate statistics)
            print(f"[Analytics Agent] Counting total posts in date range...")
            with conn.cursor() as cur:
                counts_query = f"""
                    SELECT
                        COUNT(*) as total_posts,
                        COUNT(CASE WHEN media_type = 'VIDEO' THEN 1 END) as videos,
                        COUNT(CASE WHEN media_type = 'IMAGE' THEN 1 END) as images,
                        COUNT(CASE WHEN media_type = 'CAROUSEL_ALBUM' THEN 1 END) as carousels
                    FROM instagram_posts
                    WHERE client_id = 'client'
                      AND is_deleted = FALSE
                      {date_where_clause}
                """
                cur.execute(counts_query, date_params)

                counts = cur.fetchone()
                total_counts = {
                    "total_posts": counts[0] if counts else 0,
                    "by_type": {
                        "videos": counts[1] if counts else 0,
                        "images": counts[2] if counts else 0,
                        "carousels": counts[3] if counts else 0
                    }
                }
                print(f"[Analytics Agent] Total posts in date range: {total_counts['total_posts']} (videos: {total_counts['by_type']['videos']}, images: {total_counts['by_type']['images']}, carousels: {total_counts['by_type']['carousels']})")

            # Build query details based on date mode
            query_details = {
                "query": query,
                "metric": metric,
                "date_filter_mode": date_filter_mode
            }
            if date_filter_mode == "absolute":
                query_details["start_date"] = start_date
                query_details["end_date"] = end_date
            else:
                query_details["date_range"] = date_range
                query_details["days"] = days

            result = {
                "query_details": query_details,
                "total_counts": total_counts,
                "data_availability": {
                    "available_metrics": [
                        "views", "reach", "engagement", "saved", "shares",
                        "likes", "comments", "transcript (for videos with audio)"
                    ],
                    "unavailable_metrics": [
                        "video retention/drop-off rates",
                        "completion rate",
                        "average watch time",
                        "skip rate",
                        "audience retention graphs",
                        "video watch time breakdowns"
                    ],
                    "important_note": "Retention, drop-off, completion, and watch time metrics are ONLY available in Instagram's native app and CANNOT be accessed via the Instagram Graph API. If the user asks about these metrics, you must clearly state they are not available."
                },
                "semantic_matches": semantic_results,
                "top_performers": performance_results
            }

            print(f"[Analytics Agent] Hybrid search complete")
            return result

        except Exception as e:
            print(f"[Analytics Agent] Error in hybrid search: {e}")
            import traceback
            traceback.print_exc()
            # Return partial results or error
            return {
                "query_details": {"query": query, "date_range": date_range, "error": str(e)},
                "semantic_matches": [],
                "top_performers": []
            }
        finally:
            self.db.put_conn(conn)

    def _analyze_visual_patterns(self, date_range: str = '30d', start_date: Optional[str] = None, end_date: Optional[str] = None, metric: str = 'saved', min_cluster_size: int = 2, num_clusters: int = 5) -> Dict[str, Any]:
        """
        Analyzes visual patterns by clustering posts based on embedding similarity
        and calculating performance metrics for each cluster.
        """
        print(f"[Analytics Agent] Analyzing visual patterns for metric: '{metric}'")
        print(f"[Analytics Agent] Parameters: date_range={date_range}, start_date={start_date}, end_date={end_date}, min_cluster_size={min_cluster_size}, num_clusters={num_clusters}")

        # Determine date filtering mode (same as hybrid_search)
        if start_date and end_date:
            date_filter_mode = "absolute"
            date_where_clause = "AND timestamp BETWEEN %s::date AND %s::date"
            date_params = (start_date, end_date)
            print(f"[Analytics Agent] Using ABSOLUTE date range: {start_date} to {end_date}")
        else:
            date_filter_mode = "relative"
            days_map = {
                '7d': 7,
                '30d': 30,
                '90d': 90,
                '365d': 365,
                '730d': 730,    # 2 years
                '1095d': 1095,  # 3 years
                'all': 10000    # All-time (effectively unlimited)
            }
            days = days_map.get(date_range, 30)
            date_where_clause = "AND timestamp >= CURRENT_DATE - INTERVAL '%s days'"
            date_params = (days,)
            print(f"[Analytics Agent] Using RELATIVE date range: {days} days ('{date_range}')")

        conn = self.db.get_conn()
        try:
            # 1. Fetch all posts with embeddings and performance metrics
            print(f"[Analytics Agent] Fetching posts with embeddings and metrics...")
            with conn.cursor() as cur:
                register_vector(conn)

                fetch_query = f"""
                    SELECT
                        p.id,
                        p.caption,
                        p.media_type,
                        p.timestamp,
                        p.embedding,
                        COALESCE(i.reach, 0) as reach,
                        COALESCE(i.saved, 0) as saved,
                        COALESCE(i.total_interactions, 0) as total_interactions,
                        COALESCE(i.views, 0) as views,
                        CASE
                            WHEN i.reach > 0 THEN ((i.total_interactions::float / i.reach) * 100)
                            ELSE 0
                        END as engagement_rate
                    FROM instagram_posts p
                    LEFT JOIN instagram_post_insights i ON p.id = i.post_id
                    WHERE p.client_id = 'client'
                      AND p.embedding IS NOT NULL
                      AND p.is_deleted = FALSE
                      {date_where_clause}
                    ORDER BY p.timestamp DESC
                """

                cur.execute(fetch_query, date_params)
                posts = cur.fetchall()

                if not posts or len(posts) < min_cluster_size:
                    return {
                        "error": f"Insufficient posts for analysis. Found {len(posts) if posts else 0} posts, need at least {min_cluster_size}.",
                        "visual_clusters": [],
                        "insights": []
                    }

                print(f"[Analytics Agent] Found {len(posts)} posts with embeddings")

            # 2. Simple clustering using embedding similarity
            # We'll use a greedy approach: find most representative posts as cluster centers
            print(f"[Analytics Agent] Clustering posts into {num_clusters} visual themes...")

            import numpy as np
            from sklearn.cluster import KMeans

            # Extract embeddings and data
            post_data = []
            embeddings = []
            for row in posts:
                post_data.append({
                    'id': row[0],
                    'caption': row[1][:200] if row[1] else "",  # Truncate for efficiency
                    'media_type': row[2],
                    'timestamp': row[3],
                    'reach': int(row[5]),
                    'saved': int(row[6]),
                    'total_interactions': int(row[7]),
                    'views': int(row[8]),
                    'engagement_rate': float(row[9])
                })
                # Convert pgvector to numpy array
                embeddings.append(np.array(row[4]))

            embeddings_array = np.array(embeddings)

            # Adjust num_clusters if we have fewer posts
            actual_num_clusters = min(num_clusters, len(posts))

            # Perform K-means clustering
            kmeans = KMeans(n_clusters=actual_num_clusters, random_state=42, n_init=10)
            cluster_labels = kmeans.fit_predict(embeddings_array)

            # 3. Group posts by cluster and calculate metrics
            print(f"[Analytics Agent] Calculating metrics per cluster...")
            clusters = {}
            for idx, label in enumerate(cluster_labels):
                if label not in clusters:
                    clusters[label] = []
                clusters[label].append(post_data[idx])

            # Filter out small clusters
            clusters = {k: v for k, v in clusters.items() if len(v) >= min_cluster_size}

            if not clusters:
                return {
                    "error": f"No clusters with at least {min_cluster_size} posts found.",
                    "visual_clusters": [],
                    "insights": []
                }

            # 4. Calculate statistics for each cluster
            cluster_stats = []
            for cluster_id, cluster_posts in clusters.items():
                avg_metrics = {
                    'reach': np.mean([p['reach'] for p in cluster_posts]),
                    'saved': np.mean([p['saved'] for p in cluster_posts]),
                    'total_interactions': np.mean([p['total_interactions'] for p in cluster_posts]),
                    'views': np.mean([p['views'] for p in cluster_posts]),
                    'engagement_rate': np.mean([p['engagement_rate'] for p in cluster_posts])
                }

                # Get sample captions for theme description
                sample_captions = [p['caption'] for p in cluster_posts[:5] if p['caption']]
                sample_post_ids = [p['id'] for p in cluster_posts[:3]]

                cluster_stats.append({
                    'cluster_id': int(cluster_id),
                    'post_count': len(cluster_posts),
                    'avg_metrics': avg_metrics,
                    'sample_captions': sample_captions,
                    'sample_post_ids': sample_post_ids,
                    'media_types': {
                        'VIDEO': len([p for p in cluster_posts if p['media_type'] == 'VIDEO']),
                        'IMAGE': len([p for p in cluster_posts if p['media_type'] == 'IMAGE']),
                        'CAROUSEL_ALBUM': len([p for p in cluster_posts if p['media_type'] == 'CAROUSEL_ALBUM'])
                    }
                })

            # 5. Sort clusters by the selected metric
            metric_key = 'saved' if metric in ['saves', 'saved'] else metric
            if metric == 'engagement':
                metric_key = 'engagement_rate'
            elif metric == 'total_interactions':
                metric_key = 'total_interactions'

            cluster_stats.sort(key=lambda x: x['avg_metrics'].get(metric_key, 0), reverse=True)

            # 6. Format results
            visual_clusters = []
            for stat in cluster_stats:
                # Generate a simple theme description based on captions
                theme_preview = " | ".join(stat['sample_captions'][:2]) if stat['sample_captions'] else "No captions available"

                visual_clusters.append({
                    'cluster_id': stat['cluster_id'],
                    'post_count': stat['post_count'],
                    'theme_preview': theme_preview[:300],  # Truncate
                    'media_type_breakdown': stat['media_types'],
                    'avg_reach': round(stat['avg_metrics']['reach'], 1),
                    'avg_saved': round(stat['avg_metrics']['saved'], 1),
                    'avg_engagement_rate': round(stat['avg_metrics']['engagement_rate'], 2),
                    'avg_total_interactions': round(stat['avg_metrics']['total_interactions'], 1),
                    'avg_views': round(stat['avg_metrics']['views'], 1),
                    'sample_post_ids': stat['sample_post_ids']
                })

            # 7. Generate insights
            top_cluster = visual_clusters[0] if visual_clusters else None
            bottom_cluster = visual_clusters[-1] if len(visual_clusters) > 1 else None

            insights = []
            if top_cluster and bottom_cluster:
                top_metric_value = top_cluster[f'avg_{metric_key}']
                bottom_metric_value = bottom_cluster[f'avg_{metric_key}']

                if bottom_metric_value > 0:
                    performance_ratio = top_metric_value / bottom_metric_value
                    insights.append(f"Top visual theme performs {performance_ratio:.1f}x better than lowest theme on {metric}")

            print(f"[Analytics Agent] Visual pattern analysis complete: {len(visual_clusters)} clusters identified")

            return {
                "date_filter_mode": date_filter_mode,
                "analyzed_metric": metric,
                "total_posts_analyzed": len(posts),
                "num_clusters_found": len(visual_clusters),
                "visual_clusters": visual_clusters,
                "insights": insights,
                "note": "Theme descriptions are based on sample captions. Use sample_post_ids to inspect specific posts in each cluster."
            }

        except Exception as e:
            print(f"[Analytics Agent] Error in visual pattern analysis: {e}")
            import traceback
            traceback.print_exc()
            return {
                "error": str(e),
                "visual_clusters": [],
                "insights": []
            }
        finally:
            self.db.put_conn(conn)

    def _compare_periods(self, period1_start: str, period1_end: str, period2_start: str, period2_end: str, metrics: List[str] = None) -> Dict[str, Any]:
        """
        Compares two time periods including both metrics AND visual content analysis.
        """
        if metrics is None:
            metrics = ['reach', 'saved', 'total_interactions']

        print(f"[Analytics Agent] Comparing periods: {period1_start} to {period1_end} vs {period2_start} to {period2_end}")
        print(f"[Analytics Agent] Metrics to compare: {metrics}")

        conn = self.db.get_conn()
        try:
            import numpy as np
            from sklearn.cluster import KMeans

            # Helper function to fetch period data
            def fetch_period_data(start_date, end_date, period_name):
                with conn.cursor() as cur:
                    register_vector(conn)

                    query = """
                        SELECT
                            p.id,
                            p.caption,
                            p.media_type,
                            p.timestamp,
                            p.embedding,
                            COALESCE(i.reach, 0) as reach,
                            COALESCE(i.saved, 0) as saved,
                            COALESCE(i.total_interactions, 0) as total_interactions,
                            COALESCE(i.views, 0) as views,
                            CASE
                                WHEN i.reach > 0 THEN ((i.total_interactions::float / i.reach) * 100)
                                ELSE 0
                            END as engagement_rate
                        FROM instagram_posts p
                        LEFT JOIN instagram_post_insights i ON p.id = i.post_id
                        WHERE p.client_id = 'client'
                          AND p.is_deleted = FALSE
                          AND p.timestamp BETWEEN %s::date AND %s::date
                        ORDER BY p.timestamp
                    """

                    cur.execute(query, (start_date, end_date))
                    rows = cur.fetchall()

                    if not rows:
                        return None

                    posts = []
                    embeddings = []
                    for row in rows:
                        posts.append({
                            'id': row[0],
                            'caption': row[1][:200] if row[1] else "",
                            'media_type': row[2],
                            'timestamp': row[3],
                            'reach': int(row[5]),
                            'saved': int(row[6]),
                            'total_interactions': int(row[7]),
                            'views': int(row[8]),
                            'engagement_rate': float(row[9])
                        })
                        if row[4] is not None:  # embedding
                            embeddings.append(np.array(row[4]))

                    return {
                        'posts': posts,
                        'embeddings': embeddings if embeddings else None
                    }

            # Fetch data for both periods
            print(f"[Analytics Agent] Fetching Period 1 data ({period1_start} to {period1_end})...")
            period1_data = fetch_period_data(period1_start, period1_end, "Period 1")

            print(f"[Analytics Agent] Fetching Period 2 data ({period2_start} to {period2_end})...")
            period2_data = fetch_period_data(period2_start, period2_end, "Period 2")

            if not period1_data or not period2_data:
                return {
                    "error": f"Insufficient data. Period 1: {len(period1_data['posts']) if period1_data else 0} posts, Period 2: {len(period2_data['posts']) if period2_data else 0} posts",
                    "period1_stats": {},
                    "period2_stats": {},
                    "growth_metrics": {},
                    "visual_analysis": {}
                }

            print(f"[Analytics Agent] Period 1: {len(period1_data['posts'])} posts, Period 2: {len(period2_data['posts'])} posts")

            # Calculate statistics for each period
            def calc_stats(posts, period_name):
                stats = {
                    'post_count': len(posts),
                    'media_types': {
                        'VIDEO': len([p for p in posts if p['media_type'] == 'VIDEO']),
                        'IMAGE': len([p for p in posts if p['media_type'] == 'IMAGE']),
                        'CAROUSEL_ALBUM': len([p for p in posts if p['media_type'] == 'CAROUSEL_ALBUM'])
                    }
                }

                for metric in metrics:
                    if metric == 'engagement':
                        metric_key = 'engagement_rate'
                    else:
                        metric_key = metric

                    values = [p[metric_key] for p in posts if metric_key in p]
                    if values:
                        stats[f'avg_{metric}'] = round(np.mean(values), 2)
                        stats[f'total_{metric}'] = round(np.sum(values), 2)

                return stats

            period1_stats = calc_stats(period1_data['posts'], "Period 1")
            period2_stats = calc_stats(period2_data['posts'], "Period 2")

            # Calculate growth metrics
            growth_metrics = {}

            # Post volume growth
            if period1_stats['post_count'] > 0:
                growth_metrics['post_volume_change'] = round(
                    ((period2_stats['post_count'] - period1_stats['post_count']) / period1_stats['post_count']) * 100, 1
                )

            # Metric growth
            for metric in metrics:
                p1_key = f'avg_{metric}'
                p2_key = f'avg_{metric}'

                if p1_key in period1_stats and p2_key in period2_stats and period1_stats[p1_key] > 0:
                    growth_metrics[f'{metric}_growth'] = round(
                        ((period2_stats[p2_key] - period1_stats[p1_key]) / period1_stats[p1_key]) * 100, 1
                    )

            # Visual content analysis (if embeddings available)
            visual_analysis = {}

            if period1_data['embeddings'] and period2_data['embeddings']:
                print(f"[Analytics Agent] Analyzing visual themes for both periods...")

                # Cluster each period separately (2 clusters per period for simplicity)
                def analyze_visual_themes(posts, embeddings, period_name):
                    if len(embeddings) < 2:
                        return {"theme": "Insufficient data for clustering"}

                    num_clusters = min(2, len(embeddings))
                    embeddings_array = np.array(embeddings)

                    kmeans = KMeans(n_clusters=num_clusters, random_state=42, n_init=10)
                    labels = kmeans.fit_predict(embeddings_array)

                    # Group posts by cluster
                    clusters = {}
                    for idx, label in enumerate(labels):
                        if label not in clusters:
                            clusters[label] = []
                        clusters[label].append(posts[idx])

                    # Describe themes
                    themes = []
                    for cluster_id, cluster_posts in clusters.items():
                        sample_captions = [p['caption'] for p in cluster_posts[:3] if p['caption']]
                        theme_desc = " | ".join(sample_captions) if sample_captions else "No captions"

                        # Calculate avg performance for this theme
                        avg_reach = np.mean([p['reach'] for p in cluster_posts])
                        avg_saved = np.mean([p['saved'] for p in cluster_posts])

                        themes.append({
                            'cluster_id': int(cluster_id),
                            'post_count': len(cluster_posts),
                            'theme_preview': theme_desc[:200],
                            'avg_reach': round(avg_reach, 1),
                            'avg_saved': round(avg_saved, 1),
                            'media_types': {
                                'VIDEO': len([p for p in cluster_posts if p['media_type'] == 'VIDEO']),
                                'IMAGE': len([p for p in cluster_posts if p['media_type'] == 'IMAGE']),
                                'CAROUSEL_ALBUM': len([p for p in cluster_posts if p['media_type'] == 'CAROUSEL_ALBUM'])
                            }
                        })

                    # Sort by avg_reach descending
                    themes.sort(key=lambda x: x['avg_reach'], reverse=True)
                    return themes

                visual_analysis['period1_themes'] = analyze_visual_themes(
                    period1_data['posts'],
                    period1_data['embeddings'],
                    "Period 1"
                )
                visual_analysis['period2_themes'] = analyze_visual_themes(
                    period2_data['posts'],
                    period2_data['embeddings'],
                    "Period 2"
                )

            # Generate insights
            insights = []

            # Post volume insight
            if 'post_volume_change' in growth_metrics:
                change = growth_metrics['post_volume_change']
                if change > 0:
                    insights.append(f"Period 2 had {change}% more posts than Period 1 ({period2_stats['post_count']} vs {period1_stats['post_count']})")
                elif change < 0:
                    insights.append(f"Period 2 had {abs(change)}% fewer posts than Period 1 ({period2_stats['post_count']} vs {period1_stats['post_count']})")

            # Metric insights
            for metric in metrics:
                if f'{metric}_growth' in growth_metrics:
                    growth = growth_metrics[f'{metric}_growth']
                    if abs(growth) > 5:  # Only mention if >5% change
                        direction = "increased" if growth > 0 else "decreased"
                        insights.append(f"Average {metric} {direction} by {abs(growth)}%")

            # Visual insights
            if visual_analysis:
                if 'period1_themes' in visual_analysis and 'period2_themes' in visual_analysis:
                    p1_top = visual_analysis['period1_themes'][0] if visual_analysis['period1_themes'] else None
                    p2_top = visual_analysis['period2_themes'][0] if visual_analysis['period2_themes'] else None

                    if p1_top and p2_top:
                        insights.append(f"Visual content shifted from Period 1 themes to Period 2 themes (see visual_analysis for details)")

            print(f"[Analytics Agent] Period comparison complete")

            return {
                "comparison_details": {
                    "period1": f"{period1_start} to {period1_end}",
                    "period2": f"{period2_start} to {period2_end}",
                    "metrics_analyzed": metrics
                },
                "period1_stats": period1_stats,
                "period2_stats": period2_stats,
                "growth_metrics": growth_metrics,
                "visual_analysis": visual_analysis,
                "insights": insights
            }

        except Exception as e:
            print(f"[Analytics Agent] Error in period comparison: {e}")
            import traceback
            traceback.print_exc()
            return {
                "error": str(e),
                "period1_stats": {},
                "period2_stats": {},
                "growth_metrics": {},
                "visual_analysis": {}
            }
        finally:
            self.db.put_conn(conn)

    async def chat(self, messages: List[Dict[str, str]]) -> anthropic.types.Message:
        """Main chat function that orchestrates the tool-use loop with Claude."""

        # System prompt with prompt caching enabled
        system_prompts = [
            {
                "type": "text",
                "text": self.config.system_prompt,
                "cache_control": {"type": "ephemeral"}
            }
        ]

        # Make a mutable copy of messages for the conversation loop
        conversation_messages = list(messages)

        # Initial API call with tools
        response = await self.anthropic_client.messages.create(
            model=self.config.model_name,
            max_tokens=self.config.max_tokens,
            system=system_prompts,
            messages=conversation_messages,
            tools=self.get_tools()
        )

        # Tool use loop - keep calling tools until Claude returns end_turn
        iteration = 0
        max_iterations = 10  # Safety limit to prevent infinite loops

        while response.stop_reason == "tool_use" and iteration < max_iterations:
            iteration += 1
            print(f"[Analytics Agent] Tool use iteration {iteration}, stop_reason: {response.stop_reason}")

            # Find the tool_use block
            tool_use_block = next((block for block in response.content if block.type == "tool_use"), None)

            if not tool_use_block:
                print("[Analytics Agent] WARNING: stop_reason is tool_use but no tool_use block found!")
                break

            print(f"[Analytics Agent] Tool to execute: {tool_use_block.name}")
            tool_name = tool_use_block.name
            tool_input = tool_use_block.input

            # Execute the tool
            tool_result = None
            if tool_name == "hybrid_search":
                tool_result = self._hybrid_search(**tool_input)
            elif tool_name == "analyze_visual_patterns":
                tool_result = self._analyze_visual_patterns(**tool_input)
            elif tool_name == "compare_periods":
                tool_result = self._compare_periods(**tool_input)

            if tool_result is None:
                print(f"[Analytics Agent] WARNING: Tool {tool_name} returned None!")
                break

            # Append assistant's response (with tool use) to conversation
            conversation_messages.append({
                "role": "assistant",
                "content": response.content
            })

            # Append tool result to conversation
            conversation_messages.append({
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_use_block.id,
                        "content": json.dumps(tool_result)
                    }
                ]
            })

            # Call Claude again with the updated conversation
            print(f"[Analytics Agent] Calling Claude with tool result (iteration {iteration})...")
            response = await self.anthropic_client.messages.create(
                model=self.config.model_name,
                max_tokens=self.config.max_tokens,
                system=system_prompts,
                messages=conversation_messages,
                tools=self.get_tools()
            )

        # Log final response details
        print(f"[Analytics Agent] Final response after {iteration} iterations. Stop reason: {response.stop_reason}")
        print(f"[Analytics Agent] Final response has {len(response.content)} content blocks")
        for i, block in enumerate(response.content):
            print(f"[Analytics Agent] Block {i}: type={block.type}")
            if block.type == 'text':
                print(f"[Analytics Agent] Text length: {len(block.text)}")

        # Log token usage to database
        user_message_preview = messages[0].get('content', '')[:200] if messages else ''
        self._log_token_usage(
            response=response,
            tool_calls_count=iteration,
            user_message_preview=user_message_preview
        )

        return response

    def _log_token_usage(self, response: anthropic.types.Message, tool_calls_count: int = 0, user_message_preview: str = "", session_id: str = None):
        """Log token usage to database for cost tracking and optimization."""
        try:
            conn = self.db.get_conn()
            with conn.cursor() as cur:
                # Extract token usage from response
                usage = response.usage
                input_tokens = usage.input_tokens
                output_tokens = usage.output_tokens
                total_tokens = input_tokens + output_tokens

                # Check for cache usage (prompt caching)
                cache_creation_tokens = getattr(usage, 'cache_creation_input_tokens', 0) or 0
                cache_read_tokens = getattr(usage, 'cache_read_input_tokens', 0) or 0

                # Estimate cost based on Claude Sonnet 4 pricing (as of Jan 2025)
                # Input: $3 per million tokens
                # Output: $15 per million tokens
                # Cache writes: $3.75 per million tokens
                # Cache reads: $0.30 per million tokens
                input_cost = (input_tokens / 1_000_000) * 3.0
                output_cost = (output_tokens / 1_000_000) * 15.0
                cache_write_cost = (cache_creation_tokens / 1_000_000) * 3.75
                cache_read_cost = (cache_read_tokens / 1_000_000) * 0.30
                estimated_cost = input_cost + output_cost + cache_write_cost + cache_read_cost

                # Insert into token_usage_log
                cur.execute("""
                    INSERT INTO token_usage_log (
                        client_id,
                        session_id,
                        model_name,
                        input_tokens,
                        output_tokens,
                        total_tokens,
                        cache_creation_input_tokens,
                        cache_read_input_tokens,
                        tool_calls_count,
                        stop_reason,
                        user_message_preview,
                        estimated_cost_usd
                    ) VALUES (
                        'client',
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s,
                        %s
                    )
                """, (
                    session_id,
                    self.config.model_name,
                    input_tokens,
                    output_tokens,
                    total_tokens,
                    cache_creation_tokens,
                    cache_read_tokens,
                    tool_calls_count,
                    response.stop_reason,
                    user_message_preview,
                    estimated_cost
                ))
                conn.commit()

                print(f"[Token Usage] Logged: {total_tokens} tokens (in: {input_tokens}, out: {output_tokens}, cost: ${estimated_cost:.4f})")
                if cache_read_tokens > 0:
                    print(f"[Token Usage] Cache hit: {cache_read_tokens} tokens read from cache (saved ${(cache_read_tokens / 1_000_000) * 2.7:.4f})")

            self.db.put_conn(conn)
        except Exception as e:
            print(f"[Token Usage] ERROR logging token usage: {e}")
            import traceback
            traceback.print_exc()
