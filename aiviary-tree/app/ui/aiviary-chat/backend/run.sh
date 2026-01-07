#!/bin/bash

# FastAPI Authentication System - Quick Start Script
# This script helps you get started quickly

set -e  # Exit on error

echo "================================="
echo "FastAPI Authentication System"
echo "================================="
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if .env exists
if [ ! -f .env ]; then
    echo -e "${YELLOW}⚠ .env file not found${NC}"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    echo -e "${GREEN}✓ Created .env file${NC}"
    echo ""
    echo -e "${YELLOW}IMPORTANT: Please edit .env and configure:${NC}"
    echo "  - DATABASE_URL (PostgreSQL connection)"
    echo "  - JWT_SECRET_KEY (generate with: openssl rand -hex 32)"
    echo "  - ALLOWED_ORIGINS (your frontend URLs)"
    echo ""
    read -p "Press Enter after you've configured .env..."
fi

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo -e "${YELLOW}⚠ Virtual environment not found${NC}"
    echo "Creating virtual environment..."
    python3 -m venv venv
    echo -e "${GREEN}✓ Virtual environment created${NC}"
fi

# Activate virtual environment
echo "Activating virtual environment..."
source venv/bin/activate

# Check if dependencies are installed
if ! python -c "import fastapi" 2>/dev/null; then
    echo -e "${YELLOW}⚠ Dependencies not installed${NC}"
    echo "Installing dependencies..."
    pip install -r requirements.txt
    echo -e "${GREEN}✓ Dependencies installed${NC}"
fi

# Run setup verification
echo ""
echo "Running setup verification..."
python test_setup.py

# Check if verification passed
if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}✓ Setup verification passed${NC}"
    echo ""
    echo "================================="
    echo "Starting FastAPI server..."
    echo "================================="
    echo ""
    echo "Server will be available at:"
    echo "  - API: http://localhost:8000"
    echo "  - Docs: http://localhost:8000/docs"
    echo "  - ReDoc: http://localhost:8000/redoc"
    echo ""
    echo "Press Ctrl+C to stop the server"
    echo ""

    # Start server
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
else
    echo ""
    echo -e "${RED}✗ Setup verification failed${NC}"
    echo "Please fix the issues above before starting the server."
    exit 1
fi
