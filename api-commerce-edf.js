/**
 * Shelly Tempo Script - EDF Calendar API Version
 * 
 * Controls a Shelly switch based on French EDF Tempo pricing.
 * Switch turns ON only during HP Rouge (Peak Hours on Red Days).
 * 
 * This version uses the official EDF API for maximum reliability.
 * Fetches calendar data once per day at 11:02 AM (when EDF publishes tomorrow's color).
 * 
 * API: https://api-commerce.edf.fr/commerce/activet/v1/calendrier-jours-effacement
 * Checks: 3 times per day (5:50 AM HP start, 11:02 AM calendar refresh, 22:10 PM HC start)
 * HP/HC state calculated locally based on time with 10-minute safety delay
 * 
 * Configuration: Use KVS (Key-Value Store) to configure without editing script
 * See README.md for configuration instructions
 * 
 * @see https://github.com/yourusername/shelly-tempo
 * @license MIT
 */

// Default configuration (used if KVS values not set)
let DEFAULT_CONFIG = {
  calendarUrl: "https://api-commerce.edf.fr/commerce/activet/v1/calendrier-jours-effacement",
  switchId: 1,
  hpStartHour: 6,
  hpEndHour: 22,
  calendarRefreshHour: 11,
  calendarDaysAhead: 1,
  retryDelaySeconds: 30,
  safetyDelayMinutes: 10,
  fallbackBehavior: "PREVIOUS_STATE", // PREVIOUS_STATE, ON, or OFF
  notificationsEnabled: false,
  webhookEnabled: false,
  webhookUrl: "",
  webhookMethod: "POST",
  mqttEnabled: false,
  mqttTopic: "shelly/tempo/errors",
};

let CONFIG = {};
let activeTimer = null;
let lastErrorNotified = null;
let consecutiveFailures = 0; // Track failures for exponential backoff

// Exponential backoff delays (in seconds): 30s → 1m → 2m → 5m → 10m → 30m → 1h (max)
let RETRY_DELAY_STEPS = [30, 60, 120, 300, 600, 1800, 3600];

// Load configuration from KVS or use defaults
function loadConfig(callback) {
  Shelly.call("KVS.GetMany", { match: "tempo.*" }, function(result, error_code) {
    if (error_code !== 0 || !result || !result.items) {
      console.log("No KVS config found, using defaults");
      CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
      callback();
      return;
    }
    
    // Start with defaults
    CONFIG = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    
    // Override with KVS values
    let items = result.items;
    for (let i = 0; i < items.length; i++) {
      let item = items[i];
      let key = item.key;
      
      if (key === "tempo.switchId") CONFIG.switchId = item.value;
      else if (key === "tempo.hpStartHour") CONFIG.hpStartHour = item.value;
      else if (key === "tempo.hpEndHour") CONFIG.hpEndHour = item.value;
      else if (key === "tempo.calendarRefreshHour") CONFIG.calendarRefreshHour = item.value;
      else if (key === "tempo.retryDelaySeconds") CONFIG.retryDelaySeconds = item.value;
      else if (key === "tempo.safetyDelayMinutes") CONFIG.safetyDelayMinutes = item.value;
      else if (key === "tempo.fallbackBehavior") CONFIG.fallbackBehavior = item.value;
      else if (key === "tempo.notificationsEnabled") CONFIG.notificationsEnabled = item.value;
      else if (key === "tempo.webhookEnabled") CONFIG.webhookEnabled = item.value;
      else if (key === "tempo.webhookUrl") CONFIG.webhookUrl = item.value;
      else if (key === "tempo.webhookMethod") CONFIG.webhookMethod = item.value;
      else if (key === "tempo.mqttEnabled") CONFIG.mqttEnabled = item.value;
      else if (key === "tempo.mqttTopic") CONFIG.mqttTopic = item.value;
    }
    
    console.log("Config loaded from KVS");
    callback();
  });
} // Track last error notification to avoid spam

// Send notification via configured method
function sendNotification(title, message, severity) {
  if (!CONFIG.notificationsEnabled) return;

  // Skip throttling for recovery notifications (info severity)
  if (severity !== "info") {
    let now = new Date().getTime();
    if (lastErrorNotified && (now - lastErrorNotified) < 60 * 60 * 1000) {
      console.log("Notification throttled (< 1 hour since last)");
      return;
    }
    lastErrorNotified = now;
  }

  let fullMessage = "[Tempo Script] " + title + ": " + message;

  // Method 1: HTTP Webhook
  if (CONFIG.webhookEnabled && CONFIG.webhookUrl) {
    sendWebhookNotification(fullMessage, severity);
  }

  // Method 2: MQTT
  if (CONFIG.mqttEnabled) {
    sendMqttNotification(fullMessage, severity);
  }
}

// Webhook notification
function sendWebhookNotification(message, severity) {
  let payload = JSON.stringify({
    message: message,
    severity: severity,
    timestamp: new Date().toISOString(),
    device: "Shelly Tempo Script"
  });
  
  let params = {
    url: CONFIG.webhookUrl,
    content_type: "application/json",
    timeout: 5
  };
  
  if (CONFIG.webhookMethod === "POST") {
    params.body = payload;
    Shelly.call("HTTP.POST", params, function(result, error_code, error_message) {
      if (error_code !== 0) {
        console.log("Webhook notification failed:", error_message);
      } else {
        console.log("Webhook notification sent");
      }
    });
  } else {
    params.url += "?message=" + encodeURIComponent(message);
    Shelly.call("HTTP.GET", params, function(result, error_code, error_message) {
      if (error_code !== 0) {
        console.log("Webhook notification failed:", error_message);
      } else {
        console.log("Webhook notification sent");
      }
    });
  }
}

// MQTT notification
function sendMqttNotification(message, severity) {
  let payload = JSON.stringify({
    message: message,
    severity: severity,
    timestamp: new Date().toISOString()
  });
  
  MQTT.publish(CONFIG.mqttTopic, payload, 0, false);
  console.log("MQTT notification sent to", CONFIG.mqttTopic);
}

// Color mapping: TEMPO_BLEU=1, TEMPO_BLANC=2, TEMPO_ROUGE=3, NON_DEFINI=0
function parseColorCode(statut) {
  if (statut === "TEMPO_BLEU") return 1;
  if (statut === "TEMPO_BLANC") return 2;
  if (statut === "TEMPO_ROUGE") return 3;
  if (statut === "NON_DEFINI") return 0; // Not yet defined (future dates)
  return 0;
}

function getColorName(code) {
  if (code === 1) return "Bleu";
  if (code === 2) return "Blanc";
  if (code === 3) return "Rouge";
  return "Unknown";
}

// Load calendar from storage
function loadCalendar() {
  let stored = Script.storage.getItem("calendar");
  if (stored) {
    try {
      return JSON.parse(stored);
    } catch (e) {
      console.log("Warning: Corrupted calendar data in storage, will re-fetch:", e);
      return null;
    }
  }
  return null;
}

// Check if calendar data is still valid (fetched within last 24 hours)
function isCalendarValid() {
  let lastFetch = Script.storage.getItem("calendarFetch");
  if (!lastFetch) {
    return false;
  }
  
  let now = new Date();
  let lastFetchDate = new Date(lastFetch);
  let hoursSinceLastFetch = (now.getTime() - lastFetchDate.getTime()) / (1000 * 60 * 60);
  
  // Calendar is valid if fetched within last 24 hours
  return hoursSinceLastFetch < 24;
}

// Save calendar to storage (compact format)
function saveCalendar(calendar) {
  // Store as array of [date, colorCode] to save space
  let compact = calendar.map(function(entry) {
    return [entry.dateApplication, entry.colorCode];
  });
  
  let fetchTime = new Date().toISOString();
  
  // Save to Script.storage for internal use (fast, private)
  Script.storage.setItem("calendar", JSON.stringify(compact));
  Script.storage.setItem("calendarFetch", fetchTime);
  
  // Save to KVS for external monitoring (delayed to avoid blocking)
  let kvsCalendar = calendar.map(function(entry) {
    return [entry.dateApplication, entry.colorCode, getColorName(entry.colorCode)];
  });
  
  Timer.set(1000, false, function() {
    Shelly.call("KVS.Set", {
      key: "tempo.edf.calendar",
      value: JSON.stringify(kvsCalendar)
    });
    
    Shelly.call("KVS.Set", {
      key: "tempo.edf.lastFetch",
      value: fetchTime
    });
  });
}

// Get color for a specific date (YYYY-MM-DD format)
function getColorForDate(dateStr) {
  let calendar = loadCalendar();
  if (!calendar) return null;
  
  for (let i = 0; i < calendar.length; i++) {
    if (calendar[i][0] === dateStr) {
      return calendar[i][1];
    }
  }
  return null;
}

// Get today's date in YYYY-MM-DD format
function getTodayDateString() {
  let now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth() + 1;
  let day = now.getDate();
  
  // Pad with zeros
  let monthStr = month < 10 ? "0" + month : "" + month;
  let dayStr = day < 10 ? "0" + day : "" + day;
  
  return year + "-" + monthStr + "-" + dayStr;
}

// Build calendar API URL with date range
function buildCalendarUrl() {
  let now = new Date();
  let start = getTodayDateString();
  
  // Calculate end date (N days from now) - manual calculation for Espruino
  let nowTime = now.getTime();
  let daysInMs = CONFIG.calendarDaysAhead * 24 * 60 * 60 * 1000;
  let endTime = nowTime + daysInMs;
  let endDate = new Date(endTime);
  
  let endYear = endDate.getFullYear();
  let endMonth = endDate.getMonth() + 1;
  let endDay = endDate.getDate();
  let end = endYear + "-" + endMonth + "-" + endDay;
  
  return CONFIG.calendarUrl + 
         "?option=TEMPO" +
         "&dateApplicationBorneInf=" + start +
         "&dateApplicationBorneSup=" + end +
         "&identifiantConsommateur=src";
}

// Determine current HP/HC state (1=HP, 2=HC)
// Determine current HP/HC state (1=HP, 2=HC)
// Applies safety delay to consider HP starting earlier
function getCurrentHoraireCode() {
  let now = new Date();
  let hour = now.getHours();
  let minute = now.getMinutes();
  let minutesSinceMidnight = hour * 60 + minute;
  
  // Apply safety delay: HP starts safetyDelayMinutes before configured hour
  let hpStartMinutes = CONFIG.hpStartHour * 60 - CONFIG.safetyDelayMinutes;
  let hpEndMinutes = CONFIG.hpEndHour * 60 + CONFIG.safetyDelayMinutes;
  
  // HP: (6:00 - safety) to 22:00, HC: 22:00 to (6:00 - safety)
  if (minutesSinceMidnight >= hpStartMinutes && minutesSinceMidnight < hpEndMinutes) {
    return 1; // HP
  }
  return 2; // HC
}

// Get retry delay with exponential backoff based on failure count
function getRetryDelay() {
  // consecutiveFailures is already incremented, so subtract 1 for array index
  let index = Math.min(consecutiveFailures - 1, RETRY_DELAY_STEPS.length - 1);
  return RETRY_DELAY_STEPS[index];
}

// Apply fallback behavior when API fails
function applyFallbackBehavior() {
  if (CONFIG.fallbackBehavior === "PREVIOUS_STATE") {
    console.log("API failed - keeping previous switch state");
    // Do nothing, switch stays in current state
    return;
  }
  
  let shouldBeOn = CONFIG.fallbackBehavior === "ON";
  console.log("API failed - setting switch to fallback:", CONFIG.fallbackBehavior);
  
  Shelly.call("Switch.Set", {
    id: CONFIG.switchId,
    on: shouldBeOn,
  });
}

// Calculate minutes until next check time and determine what action to take
function getNextCheckInfo() {
  let now = new Date();
  let currentHour = now.getHours();
  let currentMinute = now.getMinutes();
  let minutesSinceMidnight = currentHour * 60 + currentMinute;
  
  let hpStart = CONFIG.hpStartHour * 60 - CONFIG.safetyDelayMinutes;  // 5:50 = 350 min (6:00 - 10 min safety delay)
  let hpEnd = CONFIG.hpEndHour * 60 + CONFIG.safetyDelayMinutes;      // 22:10 = 1330 min
  let calendarRefresh = CONFIG.calendarRefreshHour * 60; // 11:00 = 660 min
  
  let checkTimes = [
    { time: hpStart, action: "updateSwitch", label: "HP start" },
    { time: calendarRefresh, action: "fetchCalendar", label: "Calendar refresh" },
    { time: hpEnd, action: "updateSwitch", label: "HP end" }
  ];
  
  // Find next check time today
  for (let i = 0; i < checkTimes.length; i++) {
    if (checkTimes[i].time > minutesSinceMidnight) {
      let minutesUntil = checkTimes[i].time - minutesSinceMidnight;
      return {
        minutesUntil: minutesUntil,
        action: checkTimes[i].action,
        label: checkTimes[i].label
      };
    }
  }
  
  // If no check time today, use first check tomorrow (5:50 AM with safety delay)
  let minutesUntil = hpStart + (24 * 60) - minutesSinceMidnight;
  return {
    minutesUntil: minutesUntil,
    action: "updateSwitch",
    label: "HP start (tomorrow)"
  };
}

// Schedule the next check with appropriate action
function scheduleNextCheck() {
  // Clear any existing timer
  if (activeTimer !== null) {
    Timer.clear(activeTimer);
    activeTimer = null;
  }
  
  let nextCheck = getNextCheckInfo();
  
  // Add 2 minutes buffer only for calendar refresh (to ensure data is published)
  let delayMinutes = nextCheck.minutesUntil;
  if (nextCheck.action === "fetchCalendar") {
    delayMinutes += 2;
  }
  let delayMs = delayMinutes * 60 * 1000;
  
  // Cap at 24 hours
  if (delayMs > 24 * 60 * 60 * 1000) {
    delayMs = 24 * 60 * 60 * 1000;
    delayMinutes = 24 * 60;
  }
  
  console.log("Next check in", delayMinutes, "minutes -", nextCheck.label);
  
  // Schedule appropriate action
  if (nextCheck.action === "fetchCalendar") {
    activeTimer = Timer.set(delayMs, false, fetchCalendar);
  } else {
    activeTimer = Timer.set(delayMs, false, updateSwitchState);
  }
  
  // Save next check time to KVS for monitoring (delayed to avoid blocking)
  let nextCheckTime = new Date(new Date().getTime() + delayMs).toISOString();
  Timer.set(1000, false, function() {
    Shelly.call("KVS.Set", {
      key: "tempo.edf.nextCheck",
      value: nextCheckTime
    });
  });
}

// Handle calendar API response
function handleCalendarResponse(result, error_code, error_message) {
  if (error_code !== 0) {
    let errorMsg = "HTTP Error: " + error_code + " - " + error_message;
    console.log("Calendar API Error:", error_code, error_message);
    
    let retryMinutes = Math.round(CONFIG.retryDelaySeconds / 60);
    let retrySeconds = CONFIG.retryDelaySeconds % 60;
    let retryMsg = retryMinutes > 0 ? retryMinutes + " minutes" : retrySeconds + " seconds";
    
    // Send notification about the error
    sendNotification(
      "Calendar API Error",
      errorMsg + "\nWill retry in " + retryMsg + ".",
      "error"
    );
    
    // Apply fallback behavior on error
    applyFallbackBehavior();
    
    // Retry after configured delay
    console.log("Retrying in " + retryMsg + "...");
    activeTimer = Timer.set(CONFIG.retryDelaySeconds * 1000, false, fetchCalendar);
    return;
  }
  
  let data = JSON.parse(result.body);
  
  if (data.errors && data.errors.length > 0) {
    let errorMsg = "API returned errors: " + JSON.stringify(data.errors);
    console.log("Calendar API returned errors:", JSON.stringify(data.errors));
    
    let retryMinutes = Math.round(CONFIG.retryDelaySeconds / 60);
    let retrySeconds = CONFIG.retryDelaySeconds % 60;
    let retryMsg = retryMinutes > 0 ? retryMinutes + " minutes" : retrySeconds + " seconds";
    
    sendNotification(
      "Calendar Data Error",
      errorMsg + "\nWill retry in " + retryMsg + ".",
      "warning"
    );
    
    applyFallbackBehavior();
    activeTimer = Timer.set(CONFIG.retryDelaySeconds * 1000, false, fetchCalendar);
    return;
  }
  
  if (!data.content || !data.content.options || data.content.options.length === 0) {
    console.log("Invalid calendar data");
    
    // Increment failure counter for exponential backoff
    consecutiveFailures++;
    let retryDelay = getRetryDelay();
    
    let retryMinutes = Math.floor(retryDelay / 60);
    let retrySeconds = retryDelay % 60;
    let retryMsg = retryMinutes > 0 
      ? (retrySeconds > 0 ? retryMinutes + "m " + retrySeconds + "s" : retryMinutes + " minutes")
      : retrySeconds + " seconds";
    
    console.log("Consecutive failures:", consecutiveFailures, "- retry in", retryMsg);
    
    sendNotification(
      "Invalid Calendar Data",
      "API returned empty or invalid data structure.\nAttempt " + consecutiveFailures + ". Will retry in " + retryMsg + ".",
      "warning"
    );
    
    applyFallbackBehavior();
    activeTimer = Timer.set(retryDelay * 1000, false, fetchCalendar);
    return;
  }
  
  let tempoOption = data.content.options[0];
  let calendar = tempoOption.calendrier;
  
  if (!calendar || calendar.length === 0) {
    console.log("Empty calendar");
    
    // Increment failure counter for exponential backoff
    consecutiveFailures++;
    let retryDelay = getRetryDelay();
    
    let retryMinutes = Math.floor(retryDelay / 60);
    let retrySeconds = retryDelay % 60;
    let retryMsg = retryMinutes > 0 
      ? (retrySeconds > 0 ? retryMinutes + "m " + retrySeconds + "s" : retryMinutes + " minutes")
      : retrySeconds + " seconds";
    
    console.log("Consecutive failures:", consecutiveFailures, "- retry in", retryMsg);
    
    sendNotification(
      "Empty Calendar",
      "API returned no calendar entries.\nAttempt " + consecutiveFailures + ". Will retry in " + retryMsg + ".",
      "warning"
    );
    
    applyFallbackBehavior();
    activeTimer = Timer.set(retryDelay * 1000, false, fetchCalendar);
    return;
  }
  
  // Success - check if we're recovering from failures
  if (consecutiveFailures > 0) {
    console.log("Calendar API recovered after", consecutiveFailures, "failures");
    sendNotification(
      "Calendar API Recovered",
      "Connection restored after " + consecutiveFailures + " failed attempt(s).",
      "info"
    );
  }
  
  // Reset failure counter on success
  consecutiveFailures = 0;
  
  // Parse and save calendar
  let parsedCalendar = [];
  for (let i = 0; i < calendar.length; i++) {
    parsedCalendar.push({
      dateApplication: calendar[i].dateApplication,
      colorCode: parseColorCode(calendar[i].statut)
    });
  }
  
  saveCalendar(parsedCalendar);
  console.log("Calendar updated:", calendar.length, "days fetched");
  
  // Now update switch state
  updateSwitchState();
}

// Fetch calendar from EDF API
function fetchCalendar() {
  console.log("Fetching Tempo calendar...");
  
  let url = buildCalendarUrl();
  
  // Generate a unique request ID based on timestamp
  let requestId = "" + new Date().getTime();
  
  Shelly.call(
    "HTTP.Request",
    {
      url: url,
      method: "GET",
      timeout: 10,
      headers: {
        "Accept": "application/json, text/plain, */*",
        "Accept-Encoding": "identity",
        "application-origine-controlee": "site_RC",
        "Content-Type": "application/json",
        "Origin": "https://particulier.edf.fr",
        "Referer": "https://particulier.edf.fr/",
        "situation-usage": "Jours Effacement",
        "x-request-id": requestId
      }
    },
    handleCalendarResponse
  );
}

// Update switch state based on current conditions
function updateSwitchState() {
  let today = getTodayDateString();
  let colorCode = getColorForDate(today);
  let horaireCode = getCurrentHoraireCode();
  
  // Check if calendar is outdated (>24 hours old)
  if (!isCalendarValid()) {
    console.log("Calendar is outdated (>24h old), fetching fresh data...");
    fetchCalendar();
    return;
  }
  
  if (colorCode === null) {
    console.log("No calendar data for today, fetching...");
    fetchCalendar();
    return;
  }
  
  if (colorCode === 0) {
    console.log("Today's color is NON_DEFINI, fetching fresh data...");
    fetchCalendar();
    return;
  }
  
  let colorName = getColorName(colorCode);
  let horaireName = horaireCode === 1 ? "HP" : "HC";
  
  console.log("Today:", today, "-", colorName, "-", horaireName);
  
  // Switch ON only during HP Rouge (horaireCode=1 AND colorCode=3)
  let shouldBeOn = horaireCode === 1 && colorCode === 3;
  
  console.log("Setting switch to", shouldBeOn ? "ON" : "OFF");
  Shelly.call("Switch.Set", {
    id: CONFIG.switchId,
    on: shouldBeOn,
  });
  
  // Schedule next check
  scheduleNextCheck();
}

// Start the smart calendar-based script
console.log("Tempo Calendar Script starting...");

// Load configuration from KVS, then start
loadConfig(function() {
  console.log("Switch ID:", CONFIG.switchId);
  console.log("HP Hours:", CONFIG.hpStartHour + ":00 -", CONFIG.hpEndHour + ":00");
  console.log("Retry delay:", CONFIG.retryDelaySeconds, "seconds");
  console.log("Fallback behavior:", CONFIG.fallbackBehavior);
  console.log("Notifications:", CONFIG.notificationsEnabled ? "enabled" : "disabled");
  
  // Check if we have a valid calendar
  let calendar = loadCalendar();
  if (!calendar || calendar.length === 0 || !isCalendarValid()) {
    console.log("No valid calendar found (missing, empty, or outdated), fetching...");
    fetchCalendar();
  } else {
    console.log("Valid calendar loaded:", calendar.length, "days");
    updateSwitchState();
  }
});