# Shelly Tempo Scripts

Smart JavaScript scripts for controlling [Shelly](https://www.shelly.com/) devices based on the French [EDF Tempo](https://particulier.edf.fr/fr/accueil/gestion-contrat/options/tempo.html#/) electricity pricing system.

## 📖 About

Tempo is a dynamic electricity pricing contract in France with three color-coded pricing tiers:
- 🔵 **Blue** (300/year) - Lowest prices
- ⚪ **White** (43/year) - Medium prices  
- 🔴 **Red** (22/year) - Highest prices

Each day has:
- ☀️ **HP** (Peak): 6:00 - 22:00
- 🌙 **HC** (Off-Peak): 22:00 - 6:00

These scripts control your Shelly switch to turn **ON only during HP Rouge** (Peak hours on Red days), with only 1 API call per day.

## 📋 Choose Your Script

Both scripts are equally efficient (1 API call/day) and provide the same functionality. Pick one:

| Script | API Source | Complexity | When to Use |
|--------|-----------|------------|-------------|
| **api-couleur-tempo.js** | Third-party (`api-couleur-tempo.fr`) | Simple (no headers) | Easy setup, reliable |
| **api-commerce-edf.js** | Official EDF | Moderate (requires headers) | Official source, calendar data |

## 🎯 How It Works

**Control Logic**: Switch ON only when HP (6:00-22:00) AND Red day, OFF otherwise.

**Scheduling** (with 10-minute safety delay for heating ramp-up): 

**api-couleur-tempo.js**:
- **5:50 AM** - HP starts, fetch color if needed, update switch
- **22:10 PM** - HC starts, update switch (OFF)

**api-commerce-edf.js**:
- **5:50 AM** - HP starts, update switch
- **11:02 AM** - Fetch calendar (+2min to ensure data published)
- **22:10 PM** - HC starts, update switch (OFF)

Data persists across reboots via Shelly's storage.

## 🚀 Installation

1. Choose your script: `api-couleur-tempo.js` (simple) or `api-commerce-edf.js` (official)
2. Copy the script content
3. Open Shelly web UI → **Scripts** → **Library** → **Add Script**
4. Paste, **Save**, and **Start**

### Configuration

Configure via KVS (Key-Value Store) without editing code. See **[CONFIGURATION.md](CONFIGURATION.md)** for full guide.

**Quick example** - Set switch ID to 0:
```
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.switchId"&value=0
```

**Common options**: 
- `tempo.switchId` - Switch ID (0 or 1)
- `tempo.hpStartHour` / `tempo.hpEndHour` - HP period hours
- `tempo.safetyDelayMinutes` - Safety delay before HP starts for heating system ramp-up (default: 10 minutes)
- `tempo.retryDelaySeconds` - Retry delay after API error (default: 30s)
- `tempo.fallbackBehavior` - Switch behavior on error: `"PREVIOUS_STATE"`, `"ON"`, or `"OFF"`
- `tempo.webhookUrl` - Webhook for error notifications

## 🔔 Notifications (Optional)

Get alerted on API errors via HTTP webhook or MQTT. See **[NOTIFICATIONS.md](NOTIFICATIONS.md)** for full setup.

**Quick webhook setup via KVS**:
```
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.notificationsEnabled"&value=true
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.webhookEnabled"&value=true
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.webhookUrl"&value="http://your-server.com/webhook"
```

## 🧪 Testing

Test both APIs work in your environment:
```bash
./test-apis.sh
```

**Third-party API test:**
```bash
curl 'https://www.api-couleur-tempo.fr/api/jourTempo/today'
# Returns: {"dateJour":"2026-03-27","codeJour":3,"periode":"2025-2026","libCouleur":"Rouge"}
```

## 🐛 Debugging

Monitor via Shelly web UI: **Scripts** → **Your Script** → **Console**

Common issues:
- **Wrong switch**: Check `tempo.switchId` config
- **API errors**: Check console for HTTP error codes
- **Network issues**: Verify Shelly network connectivity

**Error handling**: On API failure, the script:
- Logs error to console
- Applies fallback behavior (default: keeps previous state)
- Retries with exponential backoff (30s → 1m → 2m → 5m → 10m → 30m → 1h max)
- Sends notification if configured (including recovery notification when connection restored)

**Exponential Backoff**: After repeated failures, retry delays increase automatically to reduce resource usage during extended outages. Resets to 30 seconds when connection recovers.

**Example scenario - Internet failure**:
```
5:50 AM - Try to fetch color → Timeout (error -114)
         ↓ Retry in 30 seconds (1st failure)
5:51 AM - Try again → Timeout
         ↓ Retry in 1 minute (2nd failure)  
5:52 AM - Try again → Timeout
         ↓ Retry in 2 minutes (3rd failure)
5:54 AM - Try again → Timeout
         ↓ Retry in 5 minutes (4th failure)
5:59 AM - Try again → Success! ✅
         → Recovery notification sent
         → Failure counter resets to 0
```

## 📚 Reference

**Color Codes**: 1=Blue (cheapest), 2=White, 3=Red (most expensive)  
**Horaire Codes**: 1=HP (6:00-22:00), 2=HC (22:00-6:00)

## 📄 License

MIT License

## ⚠️ Disclaimer

Provided as-is. Test before production use. Authors not responsible for damages or costs.
