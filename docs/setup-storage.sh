#!/bin/bash

# ============================================================================
# Storage Module Quick Start Script
# ============================================================================

set -e

echo "🚀 Multi-tenant SaaS Backend Blueprint - Storage Module Setup"
echo "======================================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Functions
success() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

error() {
    echo -e "${RED}❌ $1${NC}"
    exit 1
}

# Step 1: Check Node.js version
echo "Step 1: Checking Node.js version..."
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    error "Node.js 18+ required. Current: $(node -v)"
fi
success "Node.js version OK: $(node -v)"
echo ""

# Step 2: Install dependencies
echo "Step 2: Installing dependencies..."
npm install
success "Dependencies installed"
echo ""

# Step 3: Generate Prisma Client
echo "Step 3: Generating Prisma client..."
npx prisma generate
success "Prisma client generated"
echo ""

# Step 4: Run database migration
echo "Step 4: Running database migration..."
read -p "Run database migration? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npx prisma migrate dev --name add_storage_tables
    success "Database migration completed"
else
    warning "Skipped database migration"
fi
echo ""

# Step 5: Seed storage permissions
echo "Step 5: Seeding storage permissions..."
read -p "Seed storage permissions? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npx ts-node prisma/seeds/storage.seed.ts
    success "Storage permissions seeded"
else
    warning "Skipped permission seeding"
fi
echo ""

# Step 6: Environment variables
echo "Step 6: Checking environment variables..."
if [ ! -f .env ]; then
    warning ".env file not found"
    echo "Creating .env from .env.example..."
    cp .env.example .env
    warning "Please edit .env with your actual credentials"
else
    success ".env file exists"
    
    # Check for required variables
    if ! grep -q "AWS_ACCESS_KEY_ID" .env && ! grep -q "AZURE_STORAGE_ACCOUNT" .env; then
        warning "No storage provider credentials found in .env"
        echo "Add either AWS S3 or Azure Blob Storage credentials"
    else
        success "Storage provider credentials configured"
    fi
fi
echo ""

# Step 7: Validate setup
echo "Step 7: Validating setup..."

# Check if storage module files exist
if [ -f "src/modules/storage/storage.module.ts" ]; then
    success "Storage module files present"
else
    error "Storage module files not found"
fi

# Check if app.module imports storage
if grep -q "StorageModule" src/app.module.ts; then
    success "StorageModule registered in AppModule"
else
    error "StorageModule not registered in AppModule"
fi

# Check if schedule module is imported
if grep -q "@nestjs/schedule" src/app.module.ts; then
    success "ScheduleModule registered"
else
    error "ScheduleModule not registered"
fi

echo ""
echo "======================================================"
echo "✅ Storage Module Setup Complete!"
echo "======================================================"
echo ""
echo "Next steps:"
echo "1. Edit .env with your storage provider credentials"
echo "2. Configure AWS S3 or Azure Blob Storage"
echo "3. Start the application: npm run start:dev"
echo "4. Test the API: POST /storage/upload-session"
echo ""
echo "Documentation:"
echo "- README: src/modules/storage/README.md"
echo "- Installation: src/modules/storage/INSTALLATION.md"
echo "- Summary: STORAGE_IMPLEMENTATION_SUMMARY.md"
echo ""
echo "🎉 Happy coding!"
