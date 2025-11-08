#!/bin/bash

# Initialize user counter for market creation
# Run this once before creating your first market

echo "🔧 Initializing User Counter"
echo "============================="
echo ""

# Get wallet address
WALLET=$(solana address)
echo "Wallet: $WALLET"
echo ""

# Run the initialization through anchor
echo "Initializing counter..."

anchor run init-counter || {
    echo ""
    echo "Note: If you see 'already in use' error, your counter is already initialized!"
    echo "You can proceed to create markets."
}

echo ""
echo "✅ Setup complete! You can now create markets."
