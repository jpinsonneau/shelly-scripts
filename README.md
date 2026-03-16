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
| **api-couleur-tempo.js** | Third-party | Simple (no headers) | Easy setup, reliable |
| **api-commerce-edf.js** | Official EDF | Moderate (requires headers) | Official source, historical data |

## 🎯 How It Works

**Control Logic**: Switch ON only when HP (6:00-22:00) AND Red day, OFF otherwise.

**Scheduling**: 
- **5:50 & 22:00** - Check switch state (with 10-minute safety delay before 6:00 AM for heating system ramp-up)
- **3:00 AM** (api-couleur-tempo.js) or **11:00 AM** (api-commerce-edf.js) - Fetch color from API (only API call of the day)

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

Test the APIs work in your environment:
```bash
./test-apis.sh
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
- Retries after configured delay (default: 30 seconds)
- Sends notification if configured

## 📚 Reference

**Color Codes**: 1=Blue (cheapest), 2=White, 3=Red (most expensive)  
**Horaire Codes**: 1=HP (6:00-22:00), 2=HC (22:00-6:00)

## 📄 License

MIT License

## ⚠️ Disclaimer

Provided as-is. Test before production use. Authors not responsible for damages or costs.
