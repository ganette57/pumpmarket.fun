#!/bin/bash

# Funmarket.pump Deployment Script
# This script automates the deployment process

set -e

echo "🚀 Funmarket.pump Deployment Script"
echo "===================================="
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check if Solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Solana CLI not found. Please install it first.${NC}"
    echo "Visit: https://docs.solana.com/cli/install-solana-cli-tools"
    exit 1
fi

# Check if Anchor CLI is installed
if ! command -v anchor &> /dev/null; then
    echo -e "${RED}❌ Anchor CLI not found. Please install it first.${NC}"
    echo "Visit: https://www.anchor-lang.com/docs/installation"
    exit 1
fi

echo -e "${GREEN}✓ Prerequisites check passed${NC}"
echo ""

# Check Solana config
echo "📍 Current Solana Configuration:"
solana config get
echo ""

# Confirm cluster
read -p "Deploy to devnet? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 0
fi

# Check balance
BALANCE=$(solana balance | awk '{print $1}')
echo "💰 Wallet balance: $BALANCE SOL"

if (( $(echo "$BALANCE < 2" | bc -l) )); then
    echo -e "${YELLOW}⚠️  Low balance. Getting airdrop...${NC}"
    solana airdrop 5
fi

echo ""
echo "🔨 Building program..."
anchor build

echo ""
echo "🔑 Getting Program ID..."
PROGRAM_ID=$(solana address -k target/deploy/funmarket_pump-keypair.json)
echo -e "${GREEN}Program ID: $PROGRAM_ID${NC}"
echo ""

echo -e "${YELLOW}⚠️  IMPORTANT: Update the following files with this Program ID:${NC}"
echo "1. Anchor.toml (line 9 & 12)"
echo "2. programs/funmarket-pump/src/lib.rs (line 4)"
echo "3. app/src/utils/solana.ts (line 5)"
echo ""

read -p "Have you updated all files with the Program ID? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Please update the files and run this script again."
    exit 0
fi

echo ""
echo "🔨 Rebuilding with correct Program ID..."
anchor build

echo ""
echo "🚀 Deploying to devnet..."
anchor deploy --provider.cluster devnet

echo ""
echo -e "${GREEN}✅ Smart contract deployed successfully!${NC}"
echo ""
echo "📋 Deployment Summary:"
echo "  Program ID: $PROGRAM_ID"
echo "  Cluster: devnet"
echo "  Explorer: https://explorer.solana.com/address/$PROGRAM_ID?cluster=devnet"
echo ""

# Verify deployment
echo "🔍 Verifying deployment..."
solana program show $PROGRAM_ID --url devnet

echo ""
echo -e "${GREEN}🎉 Deployment complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Update app/src/utils/solana.ts with Program ID: $PROGRAM_ID"
echo "2. Deploy frontend: cd app && npm install && vercel --prod"
echo "3. Test on devnet"
echo ""
