#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Starting Agent Chat UI in Development Mode${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Function to cleanup on exit
cleanup() {
    echo ""
    echo -e "${YELLOW}Shutting down servers...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

trap cleanup SIGINT SIGTERM

cd "$SCRIPT_DIR" || exit 1

# Check if setup has been run
if [ ! -d "backend/venv" ] || [ ! -d "frontend/node_modules" ]; then
    echo -e "${YELLOW}Warning: Dependencies not installed. Running setup first...${NC}"
    ./setup.sh
    if [ $? -ne 0 ]; then
        echo -e "${RED}Setup failed. Please fix errors and try again.${NC}"
        exit 1
    fi
fi

# Start backend
echo -e "${BLUE}Starting backend server...${NC}"
cd backend || exit 1

source venv/bin/activate
python main.py &
BACKEND_PID=$!

echo -e "${GREEN}Backend started (PID: $BACKEND_PID)${NC}"
echo -e "${BLUE}Backend API: http://localhost:8000${NC}"
echo -e "${BLUE}API Docs: http://localhost:8000/docs${NC}"

cd "$SCRIPT_DIR" || exit 1

# Wait a moment for backend to start
sleep 2

# Start frontend
echo ""
echo -e "${BLUE}Starting frontend dev server...${NC}"
cd frontend || exit 1

npm run dev &
FRONTEND_PID=$!

echo -e "${GREEN}Frontend started (PID: $FRONTEND_PID)${NC}"
echo -e "${BLUE}Frontend: http://localhost:3000${NC}"

echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   Both servers are running!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${BLUE}Access your app at: http://localhost:3000${NC}"
echo ""
echo -e "${YELLOW}Press Ctrl+C to stop both servers${NC}"
echo ""

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID
