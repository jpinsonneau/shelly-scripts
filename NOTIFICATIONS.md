# Notification Setup Guide

Get instant alerts when your Tempo script encounters errors like API failures, network timeouts, or invalid data.

## Why Notifications?

Know immediately when something goes wrong so you can fix issues before they impact your automation.

## Supported Methods

This guide covers two reliable notification methods:

1. **HTTP Webhook** - Send notifications to Home Assistant, IFTTT, or any custom HTTP endpoint
2. **MQTT** - Publish errors to an MQTT broker for home automation systems

Both methods are proven, reliable, and don't depend on third-party messaging services.

---

## Method 1: HTTP Webhook

Send notifications to any HTTP endpoint. Perfect for Home Assistant, IFTTT, or custom services.

### Configuration

```javascript
notifications: {
  enabled: true,
  webhook: {
    enabled: true,
    url: "https://your-webhook-url.com/notify",
    method: "POST", // or "GET"
  }
}
```

### Payload Format (POST)

```json
{
  "message": "[Tempo Script] Error Title: Details",
  "severity": "error",
  "timestamp": "2026-01-16T10:30:00.000Z",
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

4. **Update Shelly Script**:

```javascript
notifications: {
  enabled: true,
  webhook: {
    enabled: true,
    url: "http://192.168.1.100:8123/api/webhook/tempo_script_error",
    method: "POST",
  }
}
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

5. **Update Shelly Script**:

```javascript
notifications: {
  enabled: true,
  webhook: {
    enabled: true,
    url: "https://maker.ifttt.com/trigger/tempo_error/with/key/YOUR_KEY",
    method: "POST",
  }
}
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

### Configuration

```javascript
notifications: {
  enabled: true,
  mqtt: {
    enabled: true,
    topic: "shelly/tempo/errors",
  }
}
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
  "message": "[Tempo Script] Calendar API Error: HTTP Error: -114 - Connection timeout. Will retry in 30 minutes.",
  "severity": "error",
  "timestamp": "2026-01-16T10:30:00.000Z"
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

You can enable both webhook and MQTT simultaneously:

```javascript
notifications: {
  enabled: true,
  
  webhook: {
    enabled: true,
    url: "http://192.168.1.100:8123/api/webhook/tempo_error",
    method: "POST",
  },
  
  mqtt: {
    enabled: true,
    topic: "shelly/tempo/errors",
  }
}
```

This sends notifications to both Home Assistant (via webhook) and publishes to MQTT for other systems.

---

## Notification Behavior

### Throttling

- **Maximum 1 notification per hour** for the same error type
- Prevents spam during extended outages
- Check console logs for: "Notification throttled (< 1 hour since last)"

### Severity Levels

- **error** 🔴: Critical issues (API failures, connection timeouts)
- **warning** ⚠️: Non-critical (empty data, validation issues)

### Error Types You'll Be Notified About

- ✅ HTTP connection timeouts
- ✅ API errors (400, 500, etc.)
- ✅ Invalid or empty API responses
- ✅ Calendar fetch failures
- ✅ JSON parsing errors

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

To disable all notifications:

```javascript
notifications: {
  enabled: false,
  // ... rest of config
}
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
