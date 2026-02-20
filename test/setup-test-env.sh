#!/bin/bash

# Script per eseguire setup completo test environment

set -e

echo "🚀 Setting up test environment for Multi-tenant SaaS Backend Blueprint..."

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

echo -e "${GREEN}✓ Docker is running${NC}"

# Start PostgreSQL test database
echo -e "\n${YELLOW}📦 Starting PostgreSQL test database...${NC}"
if docker ps -a | grep -q sports-test-db; then
    echo "Stopping existing container..."
    docker stop sports-test-db > /dev/null 2>&1 || true
    docker rm sports-test-db > /dev/null 2>&1 || true
fi

docker run -d --name sports-test-db \
    -p 5433:5432 \
    -e POSTGRES_PASSWORD=test \
    -e POSTGRES_USER=test \
    -e POSTGRES_DB=sports_intelligence_test \
    postgres:16-alpine

echo "Waiting for PostgreSQL to be ready..."
sleep 3

# Check if PostgreSQL is ready
until docker exec sports-test-db pg_isready -U test > /dev/null 2>&1; do
    echo "Waiting for PostgreSQL..."
    sleep 1
done

echo -e "${GREEN}✓ PostgreSQL is ready on port 5433${NC}"

# Start Redis test instance
echo -e "\n${YELLOW}📦 Starting Redis test instance...${NC}"
if docker ps -a | grep -q sports-test-redis; then
    echo "Stopping existing container..."
    docker stop sports-test-redis > /dev/null 2>&1 || true
    docker rm sports-test-redis > /dev/null 2>&1 || true
fi

docker run -d --name sports-test-redis \
    -p 6380:6379 \
    redis:7-alpine

echo "Waiting for Redis to be ready..."
sleep 2

echo -e "${GREEN}✓ Redis is ready on port 6380${NC}"

# Run database migrations
echo -e "\n${YELLOW}🔄 Running Prisma migrations...${NC}"
DATABASE_URL="postgresql://test:test@localhost:5433/sports_intelligence_test?schema=public" \
    npx prisma migrate deploy

echo -e "${GREEN}✓ Migrations completed${NC}"

# Summary
echo -e "\n${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✅ Test environment setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "📊 Services:"
echo "  • PostgreSQL: localhost:5433 (user: test, db: sports_intelligence_test)"
echo "  • Redis:      localhost:6380"
echo ""
echo "🧪 Run tests:"
echo "  • Unit tests:        npm run test:unit"
echo "  • Integration tests: npm run test:integration"
echo "  • E2E tests:         npm run test:e2e"
echo "  • All tests:         npm test"
echo "  • Coverage:          npm run test:cov"
echo ""
echo "🛑 Stop test environment:"
echo "  docker stop sports-test-db sports-test-redis"
echo "  docker rm sports-test-db sports-test-redis"
echo ""
