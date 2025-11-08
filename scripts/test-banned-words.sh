#!/bin/bash

# Test banned words filter
# This script tests that all banned words are properly blocked

echo "🧪 Testing Banned Words Filter"
echo "==============================="
echo ""

BANNED_WORDS=(
    "pedo" "child" "rape" "suicide" "kill" "porn" "dick" "cock"
    "pussy" "fuck" "nigger" "hitler" "terror" "bomb" "isis"
    "murder" "death" "underage" "minor" "assault"
)

echo "Testing ${#BANNED_WORDS[@]} banned words..."
echo ""

PASSED=0
FAILED=0

for word in "${BANNED_WORDS[@]}"; do
    # Test in question
    QUESTION="Will $word be banned?"

    # You can extend this to actually call the contract
    # For now, just check if word exists in validation
    if grep -q "$word" app/src/utils/bannedWords.ts && grep -q "$word" programs/funmarket-pump/src/lib.rs; then
        echo "✓ '$word' - Found in both contract and UI"
        ((PASSED++))
    else
        echo "✗ '$word' - MISSING from contract or UI"
        ((FAILED++))
    fi
done

echo ""
echo "=============================="
echo "Results: $PASSED passed, $FAILED failed"
echo ""

if [ $FAILED -eq 0 ]; then
    echo "🎉 All banned words are properly configured!"
    exit 0
else
    echo "❌ Some banned words are missing. Please review."
    exit 1
fi
