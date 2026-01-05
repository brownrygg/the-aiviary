#!/bin/bash

# Token Usage Analytics Script
# Provides easy access to Claude API token usage statistics

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Function to execute postgres query
run_query() {
    docker compose exec -T postgres psql -U postgres-non-root -d analytics -c "$1"
}

# Function to display header
show_header() {
    echo -e "${CYAN}"
    echo "╔════════════════════════════════════════════════════════╗"
    echo "║         Claude API Token Usage Analytics              ║"
    echo "╚════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Function to view recent usage
view_recent() {
    echo -e "${YELLOW}Recent Token Usage (Last 10 Queries)${NC}\n"
    run_query "
    SELECT
        TO_CHAR(timestamp, 'MM-DD HH24:MI') as time,
        model_name,
        input_tokens as input,
        output_tokens as output,
        total_tokens as total,
        cache_read_input_tokens as cache_hits,
        tool_calls_count as tools,
        CONCAT('$', ROUND(estimated_cost_usd::numeric, 4)) as cost,
        LEFT(user_message_preview, 40) as query
    FROM token_usage_log
    ORDER BY timestamp DESC
    LIMIT 10;
    "
}

# Function to view daily summary
view_daily() {
    local days=${1:-7}
    echo -e "${YELLOW}Daily Token Usage Summary (Last $days Days)${NC}\n"
    run_query "
    SELECT
        TO_CHAR(usage_date, 'Mon DD') as date,
        request_count as requests,
        total_input_tokens as input,
        total_output_tokens as output,
        total_tokens as total,
        total_cache_read_tokens as cache_hits,
        total_tool_calls as tools,
        CONCAT('$', ROUND(estimated_daily_cost_usd::numeric, 2)) as cost
    FROM daily_token_usage
    ORDER BY usage_date DESC
    LIMIT $days;
    "
}

# Function to view stats
view_stats() {
    local days=${1:-30}
    echo -e "${YELLOW}Token Usage Statistics (Last $days Days)${NC}\n"
    run_query "
    SELECT * FROM get_token_usage_stats('client', $days);
    "
}

# Function to view top queries by cost
view_top_queries() {
    local limit=${1:-10}
    echo -e "${YELLOW}Top $limit Most Expensive Queries${NC}\n"
    run_query "
    SELECT
        TO_CHAR(timestamp, 'Mon DD HH24:MI') as time,
        total_tokens,
        tool_calls_count as tools,
        CONCAT('$', ROUND(estimated_cost_usd::numeric, 4)) as cost,
        LEFT(user_message_preview, 50) as query
    FROM token_usage_log
    ORDER BY estimated_cost_usd DESC
    LIMIT $limit;
    "
}

# Function to view cache performance
view_cache_stats() {
    echo -e "${YELLOW}Prompt Caching Performance${NC}\n"
    run_query "
    SELECT
        COUNT(*) as total_requests,
        COUNT(*) FILTER (WHERE cache_read_input_tokens > 0) as cache_hits,
        ROUND((COUNT(*) FILTER (WHERE cache_read_input_tokens > 0)::numeric / COUNT(*)::numeric * 100), 2) as hit_rate_pct,
        SUM(cache_read_input_tokens) as total_cache_tokens,
        CONCAT('$', ROUND(SUM(cache_read_input_tokens / 1000000.0 * 2.7)::numeric, 4)) as savings
    FROM token_usage_log
    WHERE timestamp >= CURRENT_DATE - INTERVAL '30 days';
    "
}

# Function to view hourly breakdown
view_hourly() {
    echo -e "${YELLOW}Token Usage by Hour (Today)${NC}\n"
    run_query "
    SELECT
        EXTRACT(HOUR FROM timestamp) as hour,
        COUNT(*) as requests,
        SUM(total_tokens) as total_tokens,
        ROUND(AVG(total_tokens)::numeric, 0) as avg_tokens,
        CONCAT('$', ROUND(SUM(estimated_cost_usd)::numeric, 4)) as cost
    FROM token_usage_log
    WHERE DATE(timestamp) = CURRENT_DATE
    GROUP BY EXTRACT(HOUR FROM timestamp)
    ORDER BY hour DESC;
    "
}

# Function to export to CSV
export_csv() {
    local filename=${1:-token_usage_export.csv}
    echo -e "${YELLOW}Exporting token usage to $filename...${NC}"

    docker compose exec -T postgres psql -U postgres-non-root -d analytics -c "
    COPY (
        SELECT
            timestamp,
            model_name,
            input_tokens,
            output_tokens,
            total_tokens,
            cache_creation_input_tokens,
            cache_read_input_tokens,
            tool_calls_count,
            stop_reason,
            estimated_cost_usd,
            user_message_preview
        FROM token_usage_log
        ORDER BY timestamp DESC
    ) TO STDOUT WITH CSV HEADER;
    " > "$filename"

    echo -e "${GREEN}✓ Exported to $filename${NC}"
}

# Main menu
show_menu() {
    clear
    show_header
    echo -e "${BLUE}Select an option:${NC}\n"
    echo "  1) Recent Usage (Last 10 queries)"
    echo "  2) Daily Summary (Last 7 days)"
    echo "  3) Daily Summary (Last 30 days)"
    echo "  4) Monthly Stats (Last 30 days)"
    echo "  5) Top 10 Most Expensive Queries"
    echo "  6) Prompt Caching Performance"
    echo "  7) Hourly Breakdown (Today)"
    echo "  8) Export to CSV"
    echo "  9) Custom Query"
    echo "  0) Exit"
    echo ""
}

# Custom query mode
custom_query() {
    echo -e "${YELLOW}Enter number of days to analyze (default: 30):${NC}"
    read -r days
    days=${days:-30}

    echo -e "${YELLOW}Enter limit for results (default: 20):${NC}"
    read -r limit
    limit=${limit:-20}

    echo -e "\n${YELLOW}Token Usage - Last $days Days (Limit: $limit)${NC}\n"
    run_query "
    SELECT
        TO_CHAR(timestamp, 'YYYY-MM-DD HH24:MI') as time,
        input_tokens,
        output_tokens,
        total_tokens,
        cache_read_input_tokens as cache,
        tool_calls_count as tools,
        CONCAT('$', ROUND(estimated_cost_usd::numeric, 4)) as cost,
        LEFT(user_message_preview, 60) as query
    FROM token_usage_log
    WHERE timestamp >= CURRENT_DATE - INTERVAL '$days days'
    ORDER BY timestamp DESC
    LIMIT $limit;
    "
}

# Main loop
main() {
    while true; do
        show_menu
        read -r -p "Enter choice [0-9]: " choice
        echo ""

        case $choice in
            1)
                view_recent
                ;;
            2)
                view_daily 7
                ;;
            3)
                view_daily 30
                ;;
            4)
                view_stats 30
                ;;
            5)
                view_top_queries 10
                ;;
            6)
                view_cache_stats
                ;;
            7)
                view_hourly
                ;;
            8)
                echo -e "${YELLOW}Enter filename (default: token_usage_export.csv):${NC}"
                read -r filename
                filename=${filename:-token_usage_export.csv}
                export_csv "$filename"
                ;;
            9)
                custom_query
                ;;
            0)
                echo -e "${GREEN}Goodbye!${NC}"
                exit 0
                ;;
            *)
                echo -e "${RED}Invalid option. Please try again.${NC}"
                ;;
        esac

        echo ""
        read -r -p "Press Enter to continue..."
    done
}

# Check if running from correct directory
if [ ! -f "docker-compose.yml" ]; then
    echo -e "${RED}Error: Must run from the directory containing docker-compose.yml${NC}"
    echo "Current directory: $(pwd)"
    exit 1
fi

# Run main menu
main
