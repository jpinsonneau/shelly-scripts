/**
 * Shelly Tempo Script - EDF Calendar API Version
 * 
 * Controls a Shelly switch based on French EDF Tempo pricing.
 * Switch turns ON only during HP Rouge (Peak Hours on Red Days).
 * 
 * This version uses the official EDF API for maximum reliability.
 * Fetches calendar data once per day (EDF publishes tomorrow's color at 11:00 AM).
 * 
 * API: https://api-commerce.edf.fr/commerce/activet/v1/calendrier-jours-effacement
 * Checks: ~1 API call per day + HP/HC transitions
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
  calendarDaysAhead: 30,
  retryDelaySeconds: 30,
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
  
  // Avoid spamming notifications (max 1 per hour for same error type)
  let now = new Date().getTime();
  if (lastErrorNotified && (now - lastErrorNotified) < 60 * 60 * 1000) {
    console.log("Notification throttled (< 1 hour since last)");
    return;
  }
  lastErrorNotified = now;
  
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
    return JSON.parse(stored);
  }
  return null;
}

// Save calendar to storage (compact format)
function saveCalendar(calendar) {
  // Store as array of [date, colorCode] to save space
  let compact = calendar.map(function(entry) {
    return [entry.dateApplication, entry.colorCode];
  });
  Script.storage.setItem("calendar", JSON.stringify(compact));
  Script.storage.setItem("calendarFetch", new Date().toISOString());
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

function logStatus() {
  Shelly.call(
    "Switch.GetStatus",
    { id: CONFIG.switchId },
    function (result, error_code, error_message) {
      if (error_code !== 0) {
        console.log("Switch Error:", error_message);
        return;
      }
      console.log("Switch", result.id, "is", result.output ? "ON" : "OFF");
    }
  );
}

// Determine current HP/HC state (1=HP, 2=HC)
function getCurrentHoraireCode() {
  let now = new Date();
  let hour = now.getHours();
  
  // HP: 6:00 - 22:00, HC: 22:00 - 6:00
  if (hour >= CONFIG.hpStartHour && hour < CONFIG.hpEndHour) {
    return 1; // HP
  }
  return 2; // HC
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
  
  logStatus();
}

// Calculate minutes until next check time
function getMinutesUntilNextCheck() {
  let now = new Date();
  let currentHour = now.getHours();
  let currentMinute = now.getMinutes();
  let minutesSinceMidnight = currentHour * 60 + currentMinute;
  
  let hpStart = CONFIG.hpStartHour * 60;              // 6:00 = 360 min
  let hpEnd = CONFIG.hpEndHour * 60;                  // 22:00 = 1320 min
  let calendarRefresh = CONFIG.calendarRefreshHour * 60; // 11:00 = 660 min
  
  let checkTimes = [hpStart, calendarRefresh, hpEnd];
  let nextCheck = null;
  
  // Find next check time today
  for (let i = 0; i < checkTimes.length; i++) {
    if (checkTimes[i] > minutesSinceMidnight) {
      nextCheck = checkTimes[i];
      break;
    }
  }
  
  // If no check time today, use first check tomorrow (6 AM)
  if (nextCheck === null) {
    nextCheck = hpStart + (24 * 60);
  }
  
  let minutesUntil = nextCheck - minutesSinceMidnight;
  return minutesUntil;
}

// Schedule the next check
function scheduleNextCheck(minutesUntil) {
  // Clear any existing timer
  if (activeTimer !== null) {
    Timer.clear(activeTimer);
    activeTimer = null;
  }
  
  // Add 2 minutes buffer
  let delayMinutes = minutesUntil + 2;
  let delayMs = delayMinutes * 60 * 1000;
  
  // Cap at 24 hours
  if (delayMs > 24 * 60 * 60 * 1000) {
    delayMs = 24 * 60 * 60 * 1000;
    delayMinutes = 24 * 60;
  }
  
  console.log("Next check in", delayMinutes, "minutes");
  activeTimer = Timer.set(delayMs, false, updateSwitchState);
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
    
    let retryMinutes = Math.round(CONFIG.retryDelaySeconds / 60);
    let retrySeconds = CONFIG.retryDelaySeconds % 60;
    let retryMsg = retryMinutes > 0 ? retryMinutes + " minutes" : retrySeconds + " seconds";
    
    sendNotification(
      "Invalid Calendar Data",
      "API returned empty or invalid data structure.\nWill retry in " + retryMsg + ".",
      "warning"
    );
    
    applyFallbackBehavior();
    activeTimer = Timer.set(CONFIG.retryDelaySeconds * 1000, false, fetchCalendar);
    return;
  }
  
  let tempoOption = data.content.options[0];
  let calendar = tempoOption.calendrier;
  
  if (!calendar || calendar.length === 0) {
    console.log("Empty calendar");
    
    let retryMinutes = Math.round(CONFIG.retryDelaySeconds / 60);
    let retrySeconds = CONFIG.retryDelaySeconds % 60;
    let retryMsg = retryMinutes > 0 ? retryMinutes + " minutes" : retrySeconds + " seconds";
    
    sendNotification(
      "Empty Calendar",
      "API returned no calendar entries.\nWill retry in " + retryMsg + ".",
      "warning"
    );
    
    applyFallbackBehavior();
    activeTimer = Timer.set(CONFIG.retryDelaySeconds * 1000, false, fetchCalendar);
    return;
  }
  
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
    "HTTP.GET",
    {
      url: url,
      timeout: 10,
      headers: {
        "Accept": "application/json, text/plain, */*",
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
  
  logStatus();
  
  // Check if we need to refresh calendar (at 11 AM)
  let now = new Date();
  let currentHour = now.getHours();
  let currentMinute = now.getMinutes();
  let minutesSinceMidnight = currentHour * 60 + currentMinute;
  let calendarRefreshTime = CONFIG.calendarRefreshHour * 60;
  
  // If it's around calendar refresh time (11:00 +/- 30 min), fetch new calendar
  if (Math.abs(minutesSinceMidnight - calendarRefreshTime) < 30) {
    let lastFetch = Script.storage.getItem("calendarFetch");
    let now = new Date();
    
    // Only fetch if we haven't fetched today
    let shouldFetch = true;
    if (lastFetch) {
      let lastFetchDate = new Date(lastFetch);
      let lastFetchDay = lastFetchDate.getDate();
      let todayDay = now.getDate();
      if (lastFetchDay === todayDay) {
        shouldFetch = false;
      }
    }
    
    if (shouldFetch) {
      console.log("Time to refresh calendar");
      fetchCalendar();
      return; // fetchCalendar will schedule next check
    }
  }
  
  // Schedule next check at the next transition time
  let minutesUntil = getMinutesUntilNextCheck();
  scheduleNextCheck(minutesUntil);
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
  if (!calendar || calendar.length === 0) {
    console.log("No calendar found, fetching initial data...");
    fetchCalendar();
  } else {
    console.log("Calendar loaded:", calendar.length, "days");
    updateSwitchState();
  }
});
