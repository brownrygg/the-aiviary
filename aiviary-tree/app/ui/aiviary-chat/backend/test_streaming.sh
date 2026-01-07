#!/bin/bash

# Quick test script for the streaming chat API
# Usage: ./test_streaming.sh

set -e

BASE_URL="http://localhost:8000"
COOKIES_FILE="/tmp/chat_cookies.txt"

echo "========================================="
echo "Chat Streaming API Test Script"
echo "========================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Step 1: Check if server is running
echo -e "${YELLOW}Step 1: Checking if server is running...${NC}"
if ! curl -s -f "${BASE_URL}/health" > /dev/null; then
    echo -e "${RED}Error: Server is not running at ${BASE_URL}${NC}"
    echo "Please start the server with: python main.py"
    exit 1
fi
echo -e "${GREEN}✓ Server is running${NC}"
echo ""

# Step 2: Get team ID (you need to create a team first)
echo -e "${YELLOW}Step 2: Team Setup${NC}"
echo "You need a team UUID. Create one with psql:"
echo "  psql -U user -d database -c \"INSERT INTO teams (name, slug) VALUES ('Test Team', 'test-team') RETURNING id;\""
echo ""
read -p "Enter team UUID: " TEAM_ID

if [ -z "$TEAM_ID" ]; then
    echo -e "${RED}Error: Team ID is required${NC}"
    exit 1
fi
echo ""

# Step 3: Register user
echo -e "${YELLOW}Step 3: Register a test user${NC}"
read -p "Email (default: test@example.com): " USER_EMAIL
USER_EMAIL=${USER_EMAIL:-test@example.com}
read -s -p "Password (default: SecurePass123): " USER_PASSWORD
USER_PASSWORD=${USER_PASSWORD:-SecurePass123}
echo ""

REGISTER_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"${USER_EMAIL}\",
    \"password\": \"${USER_PASSWORD}\",
    \"full_name\": \"Test User\",
    \"team_id\": \"${TEAM_ID}\"
  }")

USER_ID=$(echo "$REGISTER_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$USER_ID" ]; then
    echo -e "${RED}Registration failed. Response:${NC}"
    echo "$REGISTER_RESPONSE"
    echo ""
    echo "User might already exist. Trying to login instead..."
else
    echo -e "${GREEN}✓ User registered: ${USER_ID}${NC}"
fi
echo ""

# Step 4: Login
echo -e "${YELLOW}Step 4: Login${NC}"
LOGIN_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -c "${COOKIES_FILE}" \
  -d "{
    \"email\": \"${USER_EMAIL}\",
    \"password\": \"${USER_PASSWORD}\"
  }")

if echo "$LOGIN_RESPONSE" | grep -q "Login successful"; then
    echo -e "${GREEN}✓ Login successful${NC}"
else
    echo -e "${RED}Login failed. Response:${NC}"
    echo "$LOGIN_RESPONSE"
    exit 1
fi
echo ""

# Step 5: Get current user
echo -e "${YELLOW}Step 5: Get current user info${NC}"
ME_RESPONSE=$(curl -s -X GET "${BASE_URL}/api/auth/me" \
  -b "${COOKIES_FILE}")

echo "$ME_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$ME_RESPONSE"
echo ""

# Step 6: Set user as admin (manual step)
echo -e "${YELLOW}Step 6: Set user as admin (required for creating agents)${NC}"
echo "Run this SQL command:"
echo "  psql -U user -d database -c \"UPDATE users SET role = 'admin' WHERE email = '${USER_EMAIL}';\""
echo ""
read -p "Press Enter after running the SQL command..."
echo ""

# Step 7: Create an agent
echo -e "${YELLOW}Step 7: Create a test agent${NC}"
read -p "n8n Webhook URL (default: http://podcast-n8n:5678/webhook/test): " WEBHOOK_URL
WEBHOOK_URL=${WEBHOOK_URL:-http://podcast-n8n:5678/webhook/test}

AGENT_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/agents" \
  -H "Content-Type: application/json" \
  -b "${COOKIES_FILE}" \
  -d "{
    \"name\": \"Test Assistant\",
    \"description\": \"A test AI assistant\",
    \"webhook_url\": \"${WEBHOOK_URL}\",
    \"system_prompt\": \"You are a helpful AI assistant.\",
    \"config\": {
      \"model\": \"gpt-4\",
      \"temperature\": 0.7
    }
  }")

AGENT_ID=$(echo "$AGENT_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$AGENT_ID" ]; then
    echo -e "${RED}Agent creation failed. Response:${NC}"
    echo "$AGENT_RESPONSE"
    echo ""
    echo "Make sure you set the user as admin in the database."
    exit 1
else
    echo -e "${GREEN}✓ Agent created: ${AGENT_ID}${NC}"
fi
echo ""

# Step 8: List agents
echo -e "${YELLOW}Step 8: List all agents${NC}"
AGENTS_RESPONSE=$(curl -s -X GET "${BASE_URL}/api/agents" \
  -b "${COOKIES_FILE}")

echo "$AGENTS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$AGENTS_RESPONSE"
echo ""

# Step 9: Create a chat
echo -e "${YELLOW}Step 9: Create a chat${NC}"
CHAT_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/chats" \
  -H "Content-Type: application/json" \
  -b "${COOKIES_FILE}" \
  -d "{
    \"agent_id\": \"${AGENT_ID}\",
    \"title\": \"Test Conversation\",
    \"metadata\": {\"tags\": [\"test\"]}
  }")

CHAT_ID=$(echo "$CHAT_RESPONSE" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)

if [ -z "$CHAT_ID" ]; then
    echo -e "${RED}Chat creation failed. Response:${NC}"
    echo "$CHAT_RESPONSE"
    exit 1
else
    echo -e "${GREEN}✓ Chat created: ${CHAT_ID}${NC}"
fi
echo ""

# Step 10: Send a message (streaming)
echo -e "${YELLOW}Step 10: Send a message and stream response${NC}"
read -p "Enter your message (default: Hello, how are you?): " MESSAGE
MESSAGE=${MESSAGE:-Hello, how are you?}
echo ""

echo -e "${GREEN}Streaming response:${NC}"
echo "-----------------------------------"

curl -X POST "${BASE_URL}/api/chats/${CHAT_ID}/messages" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -b "${COOKIES_FILE}" \
  -N \
  -d "{\"content\": \"${MESSAGE}\"}" 2>/dev/null | while IFS= read -r line; do
    if [[ $line == data:* ]]; then
        # Extract JSON after "data: "
        json_data="${line#data: }"

        # Try to parse with python if available
        if command -v python3 &> /dev/null; then
            event_type=$(echo "$json_data" | python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(data.get('type', ''))" 2>/dev/null)

            if [ "$event_type" = "message" ]; then
                content=$(echo "$json_data" | python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(data['data']['content'], end='')" 2>/dev/null)
                echo -n "$content"
            elif [ "$event_type" = "status" ]; then
                description=$(echo "$json_data" | python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(data['data']['description'])" 2>/dev/null)
                echo -e "\n${YELLOW}[Status: $description]${NC}"
            elif [ "$event_type" = "done" ]; then
                echo ""
                echo -e "\n${GREEN}[Stream completed]${NC}"
                break
            elif [ "$event_type" = "error" ]; then
                error_msg=$(echo "$json_data" | python3 -c "import sys, json; data=json.loads(sys.stdin.read()); print(data['data']['message'])" 2>/dev/null)
                echo -e "\n${RED}[Error: $error_msg]${NC}"
                break
            fi
        else
            # Fallback if python not available
            echo "$line"
        fi
    fi
done

echo ""
echo "-----------------------------------"
echo ""

# Step 11: Get chat with messages
echo -e "${YELLOW}Step 11: Retrieve chat with all messages${NC}"
CHAT_FULL=$(curl -s -X GET "${BASE_URL}/api/chats/${CHAT_ID}" \
  -b "${COOKIES_FILE}")

echo "$CHAT_FULL" | python3 -m json.tool 2>/dev/null || echo "$CHAT_FULL"
echo ""

# Step 12: List all chats
echo -e "${YELLOW}Step 12: List all chats${NC}"
CHATS_RESPONSE=$(curl -s -X GET "${BASE_URL}/api/chats" \
  -b "${COOKIES_FILE}")

echo "$CHATS_RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$CHATS_RESPONSE"
echo ""

# Summary
echo "========================================="
echo -e "${GREEN}Test completed successfully!${NC}"
echo "========================================="
echo ""
echo "Created resources:"
echo "  User ID:  ${USER_ID}"
echo "  Agent ID: ${AGENT_ID}"
echo "  Chat ID:  ${CHAT_ID}"
echo ""
echo "You can now:"
echo "  - View API docs: ${BASE_URL}/docs"
echo "  - Test more endpoints"
echo "  - Build your frontend"
echo ""
echo "Cookies saved to: ${COOKIES_FILE}"
echo "You can use them for subsequent requests:"
echo "  curl -b ${COOKIES_FILE} ${BASE_URL}/api/chats"
echo ""
