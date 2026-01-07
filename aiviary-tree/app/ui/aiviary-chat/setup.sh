#!/bin/bash

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Get the directory where the script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo -e "${BLUE}================================================${NC}"
echo -e "${BLUE}   Agent Chat UI - Complete Setup Script${NC}"
echo -e "${BLUE}================================================${NC}"
echo ""

# Function to print status
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check if running from correct directory
cd "$SCRIPT_DIR" || exit 1

# Step 1: Backend Python Dependencies
echo ""
print_status "Step 1: Installing Backend Python Dependencies..."
echo ""

if [ ! -d "backend" ]; then
    print_error "Backend directory not found!"
    exit 1
fi

cd backend || exit 1

# Check if we should use a virtual environment
if [ ! -d "venv" ]; then
    print_status "Creating Python virtual environment..."
    python3 -m venv venv
    if [ $? -eq 0 ]; then
        print_success "Virtual environment created"
    else
        print_error "Failed to create virtual environment"
        exit 1
    fi
fi

print_status "Activating virtual environment..."
source venv/bin/activate

print_status "Installing Python packages..."
pip install --upgrade pip
pip install -r requirements.txt

if [ $? -eq 0 ]; then
    print_success "Backend dependencies installed"
else
    print_error "Failed to install backend dependencies"
    exit 1
fi

# Deactivate venv temporarily
deactivate

cd "$SCRIPT_DIR" || exit 1

# Step 2: Frontend Node Dependencies
echo ""
print_status "Step 2: Installing Frontend Dependencies..."
echo ""

if [ ! -d "frontend" ]; then
    print_error "Frontend directory not found!"
    exit 1
fi

cd frontend || exit 1

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_error "npm is not installed. Please install Node.js and npm first."
    exit 1
fi

print_status "Installing npm packages (this may take a minute)..."
npm install

if [ $? -eq 0 ]; then
    print_success "Frontend dependencies installed"
else
    print_error "Failed to install frontend dependencies"
    exit 1
fi

cd "$SCRIPT_DIR" || exit 1

# Step 3: Database Setup
echo ""
print_status "Step 3: Database Setup..."
echo ""

if [ ! -f "setup_database.sh" ]; then
    print_error "Database setup script not found!"
    exit 1
fi

# Make sure the database setup script is executable
chmod +x setup_database.sh

print_status "Running database setup script..."
./setup_database.sh

if [ $? -eq 0 ]; then
    print_success "Database setup completed"
else
    print_warning "Database setup encountered issues (may already be configured)"
fi

# Step 4: Create .env file if it doesn't exist
echo ""
print_status "Step 4: Checking environment configuration..."
echo ""

cd backend || exit 1

if [ ! -f ".env" ]; then
    if [ -f ".env.example" ]; then
        print_status "Creating .env file from .env.example..."
        cp .env.example .env
        print_success ".env file created"
        print_warning "Please edit backend/.env with your configuration before running the app"
    else
        print_warning "No .env.example found. You may need to create a .env file manually"
    fi
else
    print_success ".env file already exists"
fi

cd "$SCRIPT_DIR" || exit 1

# Final Summary
echo ""
echo -e "${GREEN}================================================${NC}"
echo -e "${GREEN}   Setup Complete!${NC}"
echo -e "${GREEN}================================================${NC}"
echo ""
echo -e "${BLUE}Next steps:${NC}"
echo ""
echo "1. Configure your environment:"
echo "   - Edit backend/.env with your database credentials and settings"
echo ""
echo "2. Start the backend server:"
echo "   cd backend"
echo "   source venv/bin/activate"
echo "   python main.py"
echo "   (or use: ./run.sh)"
echo ""
echo "3. In a new terminal, start the frontend dev server:"
echo "   cd frontend"
echo "   npm run dev"
echo ""
echo "4. Access the application:"
echo "   - Frontend: http://localhost:3000"
echo "   - Backend API: http://localhost:8000"
echo "   - API Docs: http://localhost:8000/docs"
echo ""
echo -e "${YELLOW}Note:${NC} Make sure PostgreSQL is running before starting the backend!"
echo ""
