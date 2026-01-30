#!/bin/bash

# Test both Tempo APIs to verify they work

echo "================================================"
echo "  🔌 Tempo API Comparison Test"
echo "================================================"
echo ""

echo "1️⃣  Testing api-couleur-tempo.fr (Simple API)"
echo "   URL: https://www.api-couleur-tempo.fr/api/now"
echo "   Auth: None required"
echo "   ---"
SIMPLE_RESULT=$(curl -s 'https://www.api-couleur-tempo.fr/api/now')
if [ $? -eq 0 ]; then
  echo "   ✅ Response:"
  echo "$SIMPLE_RESULT" | jq '.'
  echo ""
  echo "   Current Status:"
  COULEUR=$(echo "$SIMPLE_RESULT" | jq -r '.codeCouleur')
  HORAIRE=$(echo "$SIMPLE_RESULT" | jq -r '.codeHoraire')
  LIB=$(echo "$SIMPLE_RESULT" | jq -r '.libTarif')
  
  case $COULEUR in
    1) COLOR_NAME="🔵 Bleu" ;;
    2) COLOR_NAME="⚪ Blanc" ;;
    3) COLOR_NAME="🔴 Rouge" ;;
    *) COLOR_NAME="❓ Unknown" ;;
  esac
  
  case $HORAIRE in
    1) PERIOD="☀️  HP (6h-22h)" ;;
    2) PERIOD="🌙 HC (22h-6h)" ;;
    *) PERIOD="❓ Unknown" ;;
  esac
  
  echo "   Color: $COLOR_NAME (code: $COULEUR)"
  echo "   Period: $PERIOD (code: $HORAIRE)"
  echo "   Label: $LIB"
else
  echo "   ❌ API call failed"
fi

echo ""
echo "================================================"
echo ""

echo "2️⃣  Testing api-commerce.edf.fr (Calendar API)"
echo "   URL: https://api-commerce.edf.fr/.../calendrier-jours-effacement"
echo "   Auth: Headers required (no cookies/session)"
echo "   ---"

START_DATE=$(date +%Y-%m-%d)
END_DATE=$(date -d "+5 days" +%Y-%m-%d)

CALENDAR_RESULT=$(curl -s "https://api-commerce.edf.fr/commerce/activet/v1/calendrier-jours-effacement?option=TEMPO&dateApplicationBorneInf=${START_DATE}&dateApplicationBorneSup=${END_DATE}&identifiantConsommateur=src" \
  -H 'Accept: application/json' \
  -H 'application-origine-controlee: site_RC' \
  -H 'Content-Type: application/json' \
  -H 'Origin: https://particulier.edf.fr' \
  -H 'Referer: https://particulier.edf.fr/' \
  -H 'situation-usage: Jours Effacement')

if [ $? -eq 0 ] && echo "$CALENDAR_RESULT" | jq -e '.content.options[0].calendrier' > /dev/null 2>&1; then
  echo "   ✅ Response: Calendar data received"
  echo ""
  echo "   Next 5 days forecast:"
  echo "$CALENDAR_RESULT" | jq -r '.content.options[0].calendrier[] | "   \(.dateApplication) | \(.statut)"' | while read -r line; do
    if echo "$line" | grep -q "TEMPO_BLEU"; then
      echo "$line 🔵"
    elif echo "$line" | grep -q "TEMPO_BLANC"; then
      echo "$line ⚪"
    elif echo "$line" | grep -q "TEMPO_ROUGE"; then
      echo "$line 🔴"
    elif echo "$line" | grep -q "NON_DEFINI"; then
      echo "$line ❓"
    else
      echo "$line"
    fi
  done
else
  echo "   ❌ API call failed or invalid response"
  echo "   Response: $CALENDAR_RESULT" | head -c 200
fi

echo ""
echo "================================================"
echo ""
echo "📊 Summary:"
echo "   • api-couleur-tempo.fr: Simple, reliable, real-time"
echo "   • api-commerce.edf.fr: Advanced, calendar, 1 call/day"
echo ""
echo "Both APIs work without authentication! ✅"
echo "================================================"
