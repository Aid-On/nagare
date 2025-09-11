#!/bin/bash

set -e

echo "🚀 Building @aid-on/nagare"
echo "========================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Build WASM with SIMD enabled
echo -e "${YELLOW}📦 Building WASM module with SIMD...${NC}"
RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target web --out-dir pkg --features simd

# Build for Node.js as well
echo -e "${YELLOW}📦 Building WASM module for Node.js...${NC}"
RUSTFLAGS="-C target-feature=+simd128" wasm-pack build --target nodejs --out-dir pkg-node --features simd

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}📥 Installing dependencies...${NC}"
    npm install
fi

# Build TypeScript
echo -e "${YELLOW}🔨 Building TypeScript...${NC}"
npm run build:ts

# Run tests
echo -e "${YELLOW}🧪 Running tests...${NC}"
npm test

echo -e "${GREEN}✅ Build complete!${NC}"
echo ""
echo "Next steps:"
echo "  - Run benchmarks: npm run bench"
echo "  - Deploy to Cloudflare: wrangler publish"
echo "  - Publish to npm: npm publish"