# Notification Setup Guide

Get instant alerts when your Tempo script encounters errors like API failures, network timeouts, or invalid data.

## Why Notifications?

Know immediately when something goes wrong so you can fix issues before they impact your automation.

## Supported Methods

This guide covers two reliable notification methods:

1. **HTTP Webhook** - Send notifications to Home Assistant, IFTTT, or any custom HTTP endpoint
2. **MQTT** - Publish errors to an MQTT broker for home automation systems

Both methods are configured via **KVS (Key-Value Store)**. See [CONFIGURATION.md](CONFIGURATION.md) for details.

---

## Method 1: HTTP Webhook

Send notifications to any HTTP endpoint. Perfect for Home Assistant, IFTTT, or custom services.

### Quick Setup (KVS)

```bash
# Enable notifications
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.notificationsEnabled"&value=true

# Enable and configure webhook
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.webhookEnabled"&value=true
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.webhookUrl"&value="http://your-server.com/webhook"
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.webhookMethod"&value="POST"
```

### Payload Format (POST)

```json
{
  "message": "[Tempo Script] Error Title: Details",
  "severity": "error",
  "timestamp": "2026-01-30T10:30:00.000Z",
  "device": "Shelly Tempo Script"
}
```

**Severity levels**: `"error"`, `"warning"`, or `"info"` (for recovery notifications)

**Example recovery notification**:
```json
{
  "message": "[Tempo Script] API Recovered: Connection restored after 3 failed attempt(s).",
  "severity": "info",
  "timestamp": "2026-01-30T11:45:00.000Z",
  "device": "Shelly Tempo Script"
}
```

### GET Requests

For GET requests, the message is URL-encoded and appended as a query parameter:
```
https://your-url.com/notify?message=[Tempo%20Script]%20Error...
```

---

## Home Assistant Setup

### Option 1: Webhook Automation (Recommended)

1. **Create Automation**:
   - Go to **Settings** → **Automations & Scenes** → **Create Automation**
   - Click **⋮** → **Edit in YAML**

2. **Add This Configuration**:

```yaml
alias: "Tempo Script Error Notification"
description: "Alert when Shelly Tempo script encounters errors"
trigger:
  - platform: webhook
    webhook_id: tempo_script_error
    local_only: false
action:
  - service: notify.mobile_app_your_phone
    data:
      title: "⚠️ Tempo Script Error"
      message: "{{ trigger.json.message }}"
      data:
        priority: high
        ttl: 0
mode: single
```

3. **Get Your Webhook URL**:
   - The webhook ID in the automation above is `tempo_script_error`
   - Your URL will be: `http://YOUR_HA_IP:8123/api/webhook/tempo_script_error`

4. **Update Shelly Script via KVS**:

```bash
SHELLY_IP="192.168.1.50"

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.notificationsEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookUrl","value":"http://192.168.1.100:8123/api/webhook/tempo_script_error"}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookMethod","value":"POST"}}' \
  http://$SHELLY_IP/rpc
```

### Option 2: RESTful Command

1. **Add to `configuration.yaml`**:

```yaml
rest_command:
  tempo_script_notify:
    url: "http://localhost:8123/api/services/notify/mobile_app_your_phone"
    method: POST
    headers:
      authorization: "Bearer YOUR_LONG_LIVED_ACCESS_TOKEN"
      content-type: "application/json"
    payload: '{"title": "Tempo Script Error", "message": "{{ message }}"}'
```

2. **Create Automation**:

```yaml
alias: "Tempo Script Error Handler"
trigger:
  - platform: webhook
    webhook_id: tempo_error
action:
  - service: rest_command.tempo_script_notify
    data:
      message: "{{ trigger.json.message }}"
```

---

## IFTTT Setup

1. **Create New Applet**:
   - Go to [IFTTT](https://ifttt.com/) → **Create**

2. **Configure Trigger**:
   - **If This**: Webhooks → **Receive a web request**
   - Event name: `tempo_error`

3. **Configure Action**:
   - **Then That**: Choose your action:
     - **Notifications** → Send a notification to your phone
     - **Email** → Send me an email
     - **SMS** (if available in your region)

4. **Get Webhook URL**:
   - Go to https://ifttt.com/maker_webhooks
   - Click **Documentation**
   - Your URL: `https://maker.ifttt.com/trigger/tempo_error/with/key/YOUR_KEY`

5. **Update Shelly Script via KVS**:

```bash
SHELLY_IP="192.168.1.50"
IFTTT_KEY="YOUR_KEY"

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.notificationsEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d "{\"id\":1,\"method\":\"KVS.Set\",\"params\":{\"key\":\"tempo.webhookUrl\",\"value\":\"https://maker.ifttt.com/trigger/tempo_error/with/key/$IFTTT_KEY\"}}" \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookMethod","value":"POST"}}' \
  http://$SHELLY_IP/rpc
```

---

## Custom Webhook Server

### Simple Node.js Example

```javascript
const express = require('express');
const app = express();
app.use(express.json());

app.post('/tempo-notify', (req, res) => {
  console.log('Tempo Error:', req.body.message);
  
  // Send email, SMS, push notification, etc.
  // ... your custom logic here ...
  
  res.json({ status: 'ok' });
});

app.listen(3000, () => console.log('Webhook server running on port 3000'));
```

### Simple Python Flask Example

```python
from flask import Flask, request
app = Flask(__name__)

@app.route('/tempo-notify', methods=['POST'])
def tempo_notify():
    data = request.json
    print(f"Tempo Error: {data['message']}")
    
    # Send notification via your preferred method
    # ... your custom logic here ...
    
    return {'status': 'ok'}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=3000)
```

---

## Method 2: MQTT

Publish error messages to an MQTT broker for integration with home automation systems.

### Prerequisites

- MQTT broker running (Mosquitto, Home Assistant MQTT, etc.)
- MQTT enabled on your Shelly device

### Quick Setup (KVS)

```bash
# Enable notifications
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.notificationsEnabled"&value=true

# Enable and configure MQTT
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.mqttEnabled"&value=true
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.mqttTopic"&value="shelly/tempo/errors"
```

### Enable MQTT on Shelly

1. Open Shelly web interface
2. Go to **Settings** → **MQTT**
3. **Enable MQTT**
4. Enter your broker details:
   - **Server**: IP address of your MQTT broker (e.g., `192.168.1.100:1883`)
   - **Client ID**: Leave default or customize
   - **Username/Password**: If your broker requires authentication
5. **Save** and reboot if prompted

### Message Format

Published messages are JSON:

```json
{
  "message": "[Tempo Script] Calendar API Error: HTTP Error: -114 - Connection timeout. Will retry in 30 seconds.",
  "severity": "error",
  "timestamp": "2026-01-30T10:30:00.000Z"
}
```

---

## Home Assistant MQTT Automation

```yaml
automation:
  - alias: "Tempo Script Error Alert"
    description: "Notify on Tempo script errors via MQTT"
    trigger:
      - platform: mqtt
        topic: "shelly/tempo/errors"
    action:
      - service: notify.mobile_app_your_phone
        data:
          title: "⚠️ Tempo Script Error"
          message: "{{ trigger.payload_json.message }}"
          data:
            priority: high
    mode: single
```

### Advanced: Parse Severity Level

```yaml
automation:
  - alias: "Tempo Script Error with Severity"
    trigger:
      - platform: mqtt
        topic: "shelly/tempo/errors"
    action:
      - choose:
          - conditions:
              - condition: template
                value_template: "{{ trigger.payload_json.severity == 'error' }}"
            sequence:
              - service: notify.mobile_app_your_phone
                data:
                  title: "🔴 Critical: Tempo Script"
                  message: "{{ trigger.payload_json.message }}"
          - conditions:
              - condition: template
                value_template: "{{ trigger.payload_json.severity == 'warning' }}"
            sequence:
              - service: notify.mobile_app_your_phone
                data:
                  title: "⚠️ Warning: Tempo Script"
                  message: "{{ trigger.payload_json.message }}"
    mode: single
```

---

## Node-RED MQTT Flow

```json
[
  {
    "id": "mqtt-in",
    "type": "mqtt in",
    "topic": "shelly/tempo/errors",
    "broker": "your-mqtt-broker"
  },
  {
    "id": "parse-json",
    "type": "json",
    "property": "payload"
  },
  {
    "id": "send-notification",
    "type": "function",
    "func": "msg.payload = {\n  title: 'Tempo Error',\n  body: msg.payload.message\n};\nreturn msg;"
  }
]
```

---

## Using Both Methods

You can enable both webhook and MQTT simultaneously via KVS:

```bash
SHELLY_IP="192.168.1.50"

# Enable notifications
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.notificationsEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

# Configure webhook
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.webhookUrl","value":"http://192.168.1.100:8123/api/webhook/tempo"}}' \
  http://$SHELLY_IP/rpc

# Configure MQTT
curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.mqttEnabled","value":true}}' \
  http://$SHELLY_IP/rpc

curl -X POST -d '{"id":1,"method":"KVS.Set","params":{"key":"tempo.mqttTopic","value":"shelly/tempo/errors"}}' \
  http://$SHELLY_IP/rpc
```

This sends notifications to both Home Assistant (via webhook) and publishes to MQTT for other systems.

---

## Notification Behavior

### Throttling

- **Maximum 1 error/warning notification per hour** for the same error type
- **Recovery notifications are never throttled** - you'll always be notified when connection is restored
- Prevents spam during extended outages
- Check console logs for: "Notification throttled (< 1 hour since last)"

### Severity Levels

- **error** 🔴: Critical issues (API failures, connection timeouts)
- **warning** ⚠️: Non-critical (empty data, validation issues)
- **info** ℹ️: Recovery notifications (connection restored after failures)

### Error Types You'll Be Notified About

- ✅ HTTP connection timeouts
- ✅ API errors (400, 500, etc.)
- ✅ Invalid or empty API responses
- ✅ Calendar fetch failures
- ✅ JSON parsing errors
- ✅ **Recovery notifications** when connection is restored after failures

### Exponential Backoff

When API failures occur repeatedly, retry delays automatically increase:
- 1st failure: Retry in 30 seconds
- 2nd failure: Retry in 1 minute
- 3rd failure: Retry in 2 minutes
- 4th failure: Retry in 5 minutes
- 5th failure: Retry in 10 minutes
- 6th failure: Retry in 30 minutes
- 7th+ failures: Retry in 1 hour (maximum)

When the API recovers, you'll receive a recovery notification and retry delays reset to 30 seconds.

---

## Troubleshooting

### Webhook Issues

**Not receiving notifications?**

1. ✅ Check Shelly console logs for "Notification sent" or error messages
2. ✅ Verify webhook URL is accessible from your Shelly device
3. ✅ Test webhook URL manually with curl:

```bash
curl -X POST https://your-webhook-url.com/notify \
  -H "Content-Type: application/json" \
  -d '{"message":"test","severity":"error"}'
```

4. ✅ Check firewall rules (especially for Home Assistant)
5. ✅ Verify HTTP vs HTTPS (some services require HTTPS)

**Home Assistant webhook not working?**

- Ensure webhook automation is enabled
- Check Home Assistant logs: **Settings** → **System** → **Logs**
- Verify webhook ID matches in both automation and Shelly config
- Try `local_only: false` in webhook trigger

### MQTT Issues

**MQTT not publishing?**

1. ✅ Verify MQTT is enabled in Shelly settings
2. ✅ Check broker connection status in Shelly UI
3. ✅ Test MQTT broker with a client:

```bash
# Subscribe to topic
mosquitto_sub -h 192.168.1.100 -t "shelly/tempo/errors"
```

4. ✅ Check broker logs for connection attempts
5. ✅ Verify username/password if authentication is enabled
6. ✅ Check topic name matches exactly (case-sensitive)

**Home Assistant not receiving MQTT?**

- Verify MQTT integration is set up
- Check **Settings** → **Devices & Services** → **MQTT**
- Use MQTT Explorer to debug topic subscriptions
- Check Home Assistant MQTT logs

---

## Security Considerations

### Webhook Security

- **Use HTTPS** when possible for webhooks
- **Restrict access** by IP if your webhook server supports it
- **Don't expose** webhook URLs publicly
- **Use authentication** tokens if supported

### MQTT Security

- **Use authentication** (username/password)
- **Use TLS/SSL** for encrypted connections
- **Restrict topics** with ACLs (Access Control Lists)
- **Keep broker** on local network when possible

---

## Disabling Notifications

To disable all notifications via KVS:

```bash
http://YOUR_SHELLY_IP/rpc/KVS.Set?key="tempo.notificationsEnabled"&value=false
```

The script will continue to work normally, logging errors to console only.

---

## FAQ

**Q: Which method should I use?**  
A: If you have Home Assistant, use webhooks. If you have an existing MQTT setup, use MQTT. Both are reliable.

**Q: Can I use both webhook and MQTT?**  
A: Yes! Enable both for redundancy.

**Q: What if my notification service is down?**  
A: The script continues working normally. Notification failures don't affect operation.

**Q: How often will I get error notifications?**  
A: Maximum 1 error notification per hour (throttled). Recovery notifications are always sent when connection is restored.

**Q: What happens during extended internet outages?**  
A: The script uses exponential backoff (30s → 1m → 2m → 5m → 10m → 30m → 1h max) to reduce retry frequency and resource usage. You'll get a recovery notification when internet returns.

**Q: How do I test notifications?**  
A: Temporarily change the API URL to an invalid one to trigger an error.

**Q: Can I customize notification messages?**  
A: Not directly in the script, but you can modify messages in your Home Assistant automation or webhook handler.

**Q: Do notifications work without internet?**  
A: Yes, if using local webhooks or MQTT broker on your LAN.

---

## Summary

| Method | Setup Time | Best For |
|--------|-----------|----------|
| **Webhook** | 5-10 min | Home Assistant, IFTTT, custom services |
| **MQTT** | 10-15 min | Existing MQTT setups, multiple integrations |

Both methods are reliable and don't depend on third-party messaging services. Choose based on your existing home automation setup.
