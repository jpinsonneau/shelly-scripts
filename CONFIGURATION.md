# Configuration Guide

Both Tempo scripts (`api-commerce-edf.js` and `api-couleur-tempo.js`) use Shelly's [KVS (Key-Value Store)](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/KVS/) for configuration. This allows you to configure the scripts without editing code!

**Note**: Both scripts use the same KVS keys, so you can switch between them without reconfiguring.

## Why KVS?

- ✅ **No code editing** - Configure via HTTP/RPC calls
- ✅ **Persistent** - Settings survive script updates and reboots
- ✅ **Safe** - No risk of syntax errors in code
- ✅ **Remote** - Configure from anywhere on your network

## Configuration Options

### Basic Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tempo.switchId` | number | `1` | Shelly switch ID (0 or 1 for Pro 2) |
| `tempo.hpStartHour` | number | `6` | HP period start hour (0-23) |
| `tempo.hpEndHour` | number | `22` | HP period end hour (0-23) |
| `tempo.calendarRefreshHour` | number | `11` | When to fetch new calendar data (EDF API only) |
| `tempo.colorCheckHour` | number | `11` | When to check for color updates (Simple API only) |

### Error Handling Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tempo.retryDelaySeconds` | number | `30` | Delay before retrying after API error (in seconds) |
| `tempo.fallbackBehavior` | string | `"PREVIOUS_STATE"` | Switch behavior on API error: `"PREVIOUS_STATE"`, `"ON"`, or `"OFF"` |

**Fallback Behavior Options**:
- `PREVIOUS_STATE` - Keep switch in its current state when API fails (recommended)
- `ON` - Force switch ON when API fails
- `OFF` - Force switch OFF when API fails

### Notification Settings

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `tempo.notificationsEnabled` | boolean | `false` | Enable/disable all notifications |
| `tempo.webhookEnabled` | boolean | `false` | Enable HTTP webhook notifications |
| `tempo.webhookUrl` | string | `""` | Webhook URL |
| `tempo.webhookMethod` | string | `"POST"` | HTTP method (POST or GET) |
| `tempo.mqttEnabled` | boolean | `false` | Enable MQTT notifications |
| `tempo.mqttTopic` | string | `"shelly/tempo/errors"` | MQTT topic for errors |

## Configuration Methods

### Method 1: Web Browser (Easiest)

Configure using HTTP GET requests in your browser:

#### Set Switch ID to 0
```
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.switchId"&value=0
```

#### Configure HP Hours (6:00 - 22:00)
```
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.hpStartHour"&value=6
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.hpEndHour"&value=22
```

#### Configure Error Handling
```
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.retryDelaySeconds"&value=30
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.fallbackBehavior"&value="PREVIOUS_STATE"
```

#### Enable Webhook Notifications
```
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.notificationsEnabled"&value=true
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.webhookEnabled"&value=true
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.webhookUrl"&value="http://192.168.1.100:8123/api/webhook/tempo"
```

**Response**: You'll see JSON like `{"etag":"...", "rev":123}`

### Method 2: curl Commands

#### Basic Configuration
```bash
SHELLY_IP="192.168.1.50"

# Set switch ID
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.switchId","value":1}}' \
  http://$SHELLY_IP/rpc

# Configure HP hours
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.hpStartHour","value":6}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.hpEndHour","value":22}}' \
  http://$SHELLY_IP/rpc

# Configure error handling
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.retryDelaySeconds","value":30}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.fallbackBehavior","value":"PREVIOUS_STATE"}}' \
  http://$SHELLY_IP/rpc
```

#### Enable Notifications
```bash
# Enable webhook notifications
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.notificationsEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookUrl","value":"http://192.168.1.100:8123/api/webhook/tempo"}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookMethod","value":"POST"}}' \
  http://$SHELLY_IP/rpc
```

#### Enable MQTT Notifications
```bash
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.mqttEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.mqttTopic","value":"shelly/tempo/errors"}}' \
  http://$SHELLY_IP/rpc
```

### Method 3: Shelly Web Interface Console

1. Open Shelly web interface
2. Go to **Scripts** → Your script → **Console**
3. Enter commands:

```javascript
// Set switch ID
KVS.Set({key:"tempo.switchId", value:1})

// Configure HP hours
KVS.Set({key:"tempo.hpStartHour", value:6})
KVS.Set({key:"tempo.hpEndHour", value:22})

// Enable notifications
KVS.Set({key:"tempo.notificationsEnabled", value:true})
KVS.Set({key:"tempo.webhookEnabled", value:true})
KVS.Set({key:"tempo.webhookUrl", value:"http://192.168.1.100:8123/api/webhook/tempo"})
```

### Method 4: Home Assistant Service Call

If using Home Assistant with Shelly integration:

```yaml
service: rest_command.shelly_kvs_set
data:
  shelly_ip: "192.168.1.50"
  key: "tempo.switchId"
  value: 1
```

(Requires setting up a REST command in `configuration.yaml`)

## View Current Configuration

### Browser
```
http://YOUR_SHELLY_IP/rpc/KVS.GetMany?match="tempo.*"
```

### curl
```bash
curl -X POST -d '{"id":1,"method":"KVS.GetMany","params":{"match":"tempo.*"}}' \
  http://$SHELLY_IP/rpc
```

### Console
```javascript
KVS.GetMany({match:"tempo.*"})
```

## Delete Configuration

To remove a setting (will revert to default):

### Browser
```
http://YOUR_SHELLY_IP/rpc/KVS.Delete?key="tempo.switchId"
```

### curl
```bash
curl -X POST -d '{"id":1,"method":"KVS.Delete","params":{"key":"tempo.switchId"}}' \
  http://$SHELLY_IP/rpc
```

### Console
```javascript
KVS.Delete({key:"tempo.switchId"})
```

## Configuration Examples

### Example 1: Basic Setup (Switch 0, Default Hours)

```bash
SHELLY_IP="192.168.1.50"

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.switchId","value":0}}' \
  http://$SHELLY_IP/rpc
```

That's it! The script will use all other defaults.

### Example 2: Custom HP Hours (7:00 - 23:00)

```bash
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.hpStartHour","value":7}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.hpEndHour","value":23}}' \
  http://$SHELLY_IP/rpc
```

### Example 3: With Home Assistant Webhook

```bash
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.notificationsEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookUrl","value":"http://homeassistant.local:8123/api/webhook/tempo_error"}}' \
  http://$SHELLY_IP/rpc
```

### Example 4: With MQTT

```bash
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.notificationsEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.mqttEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.mqttTopic","value":"home/shelly/tempo/errors"}}' \
  http://$SHELLY_IP/rpc
```

## Troubleshooting

### Script Not Using KVS Configuration?

1. **Check KVS values exist**:
   ```
   http://YOUR_SHELLY_IP/rpc/KVS.GetMany?match="tempo.*"
   ```

2. **Restart the script**:
   - Go to **Scripts** → Your script → **Stop** → **Start**

3. **Check console logs**:
   - Should see "Config loaded from KVS" or "using defaults"

### KVS Set Failed?

- **Error**: Key too long (max 42 characters)
  - Use shorter keys (shouldn't happen with our keys)

- **Error**: Value too long (max 253 characters)
  - Webhook URLs must be < 253 characters
  - Use shorter URLs or IP addresses instead of domain names

- **Error**: Too many keys (max 50)
  - Delete unused keys with `KVS.Delete`

### Reset to Defaults

Delete all tempo configuration:

```bash
# Get all tempo keys
curl -X POST -d '{"id":1,"method":"KVS.GetMany","params":{"match":"tempo.*"}}' \
  http://$SHELLY_IP/rpc

# Delete each key manually or use this script:
for key in switchId hpStartHour hpEndHour calendarRefreshHour notificationsEnabled webhookEnabled webhookUrl webhookMethod mqttEnabled mqttTopic; do
  curl -X POST -d "{\"id\":1,\"method\":\"KVS.Delete\",\"params\":{\"key\":\"tempo.$key\"}}" \
    http://$SHELLY_IP/rpc
done
```

Then restart the script to use defaults.

## Best Practices

1. **Start simple** - Configure only what you need to change
2. **Test changes** - View config after setting to verify
3. **Restart script** - After configuration changes
4. **Use IP addresses** - Shorter and more reliable than domain names
5. **Document your config** - Keep notes of your settings

## Configuration Scripts

### Quick Setup Script (bash)

Save as `setup-tempo.sh`:

```bash
#!/bin/bash
SHELLY_IP="${1:-192.168.1.50}"

echo "Configuring Tempo script on $SHELLY_IP..."

# Basic config
curl -s -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.switchId","value":1}}' \
  http://$SHELLY_IP/rpc > /dev/null

curl -s -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.hpStartHour","value":6}}' \
  http://$SHELLY_IP/rpc > /dev/null

curl -s -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.hpEndHour","value":22}}' \
  http://$SHELLY_IP/rpc > /dev/null

echo "✅ Basic configuration done!"
echo ""
echo "Current configuration:"
curl -s -X POST -d '{"id":1,"method":"KVS.GetMany","params":{"match":"tempo.*"}}' \
  http://$SHELLY_IP/rpc | jq '.result.items'
```

Usage:
```bash
chmod +x setup-tempo.sh
./setup-tempo.sh 192.168.1.50
```

---

## Summary

KVS configuration provides a clean, safe way to configure your Tempo scripts without editing code. Start with the basics (switch ID and HP hours), then add notifications as needed.

For more information, see the [Shelly KVS documentation](https://shelly-api-docs.shelly.cloud/gen2/ComponentsAndServices/KVS/).
