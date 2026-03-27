/**
 * Shelly Tempo Script - Third-Party API Version
 * 
 * Controls a Shelly switch based on French EDF Tempo pricing.
 * Switch turns ON only during HP Rouge (Peak Hours on Red Days).
 * 
 * API: https://www.api-couleur-tempo.fr/api/jourTempo/today (Third-party)
 * Checks: 2 times per day (5:50 AM for HP start + color fetch, 22:10 PM for HC start)
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
  url: "https://www.api-couleur-tempo.fr/api/jourTempo/today",
  switchId: 1,
  hpStartHour: 6,
  hpEndHour: 22,
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
}

// Simplified notification function
function sendNotification(title, message, severity) {
  if (!CONFIG.notificationsEnabled) return;

  // Skip throttling for recovery notifications (info severity)
  if (severity !== "info") {
    let now = new Date().getTime();
    if (lastErrorNotified && (now - lastErrorNotified) < 60 * 60 * 1000) return;
    lastErrorNotified = now;
  }

  let fullMessage = "[Tempo Script] " + title + ": " + message;

  // Webhook
  if (CONFIG.webhookEnabled && CONFIG.webhookUrl) {
    let url = CONFIG.webhookUrl;
    if (CONFIG.webhookMethod === "GET") {
      url += "?message=" + encodeURIComponent(fullMessage);
    }
    Shelly.call(
      CONFIG.webhookMethod === "POST" ? "HTTP.POST" : "HTTP.GET",
      {
        url: url,
        body: CONFIG.webhookMethod === "POST" ?
              JSON.stringify({message: fullMessage, severity: severity}) : undefined,
        content_type: "application/json",
        timeout: 5
      },
      function() { console.log("Notification sent"); }
    );
  }

  // MQTT
  if (CONFIG.mqttEnabled) {
    MQTT.publish(CONFIG.mqttTopic, fullMessage, 0, false);
  }
}

// Get color name from color code
function getColorName(code) {
  if (code === 1) return "Bleu";
  if (code === 2) return "Blanc";
  if (code === 3) return "Rouge";
  return "Unknown";
}

// Load persisted color from storage
function loadColor() {
  let stored = Script.storage.getItem("tempoColor");
  if (stored) {
    return JSON.parse(stored);
  }
  return { codeCouleur: null, lastFetch: null };
}

// Check if stored color is still valid (for today)
function isColorValid(colorData) {
  if (!colorData || colorData.codeCouleur === null || !colorData.lastFetch) {
    return false;
  }
  
  let today = new Date();
  let todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD
  
  // Check if lastFetch date matches today (lastFetch is dateJour from API)
  let fetchDate = colorData.lastFetch.split('T')[0];
  
  return fetchDate === todayStr;
}

// Save color to storage
function saveColor(codeCouleur, dateJour) {
  let state = { 
    codeCouleur: codeCouleur, 
    lastFetch: dateJour
  };
  
  // Save to Script.storage for internal use (fast, private)
  Script.storage.setItem("tempoColor", JSON.stringify(state));
  
  // Save to KVS for external monitoring/logging (delayed to avoid blocking)
  Timer.set(1000, false, function() {
    Shelly.call("KVS.Set", {
      key: "tempo.thirdparty.currentColor",
      value: codeCouleur
    });
    
    Shelly.call("KVS.Set", {
      key: "tempo.thirdparty.currentColorName",
      value: getColorName(codeCouleur)
    });
    
    Shelly.call("KVS.Set", {
      key: "tempo.thirdparty.lastFetch",
      value: dateJour
    });
  });
}

// Determine current HP/HC state locally (1=HP, 2=HC)
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

// Calculate minutes until next check time
function getMinutesUntilNextCheck() {
  let now = new Date();
  let currentHour = now.getHours();
  let currentMinute = now.getMinutes();
  let minutesSinceMidnight = currentHour * 60 + currentMinute;
  
  let hpStart = CONFIG.hpStartHour * 60 - CONFIG.safetyDelayMinutes;  // 5:50 = 350 min (6:00 - 10 min safety delay)
  let hpEnd = CONFIG.hpEndHour * 60 + CONFIG.safetyDelayMinutes;      // 22:10 = 1330 min
  
  let checkTimes = [hpStart, hpEnd];
  let nextCheck = null;
  
  // Find next check time today
  for (let i = 0; i < checkTimes.length; i++) {
    if (checkTimes[i] > minutesSinceMidnight) {
      nextCheck = checkTimes[i];
      break;
    }
  }
  
  // If no check time today, use first check tomorrow
  if (nextCheck === null) {
    nextCheck = hpStart + (24 * 60); // 5:50 AM tomorrow (with safety delay)
  }
  
  let minutesUntil = nextCheck - minutesSinceMidnight;
  return minutesUntil;
}

// Update switch state based on current conditions
function updateSwitchState() {
  let colorData = loadColor();
  
  // Validate color is still current (fetched today)
  if (!isColorValid(colorData)) {
    console.log("Color data is outdated or missing, fetching fresh data...");
    callAPI();
    return;
  }
  
  let codeCouleur = colorData.codeCouleur;
  let codeHoraire = getCurrentHoraireCode();
  
  let colorName = getColorName(codeCouleur);
  let horaireName = codeHoraire === 1 ? "HP" : "HC";
  
  console.log("Tempo:", "Color=" + codeCouleur, "(" + colorName + ")", "Horaire=" + codeHoraire, "(" + horaireName + ")");
  
  // Control switch: ON during HP Rouge only
  // codeHoraire: 1=HP, 2=HC
  // codeCouleur: 1=Bleu, 2=Blanc, 3=Rouge
  let shouldBeOn = codeHoraire === 1 && codeCouleur === 3;
  
  console.log("Setting switch to", shouldBeOn ? "ON" : "OFF");
  Shelly.call("Switch.Set", {
    id: CONFIG.switchId,
    on: shouldBeOn,
  });
  
  // Schedule next check
  let minutesUntil = getMinutesUntilNextCheck();
  scheduleNextCheck(minutesUntil);
}

// Schedule the next check
function scheduleNextCheck(minutesUntil) {
  // Clear any existing timer
  if (activeTimer !== null) {
    Timer.clear(activeTimer);
    activeTimer = null;
  }
  
  let delayMinutes = minutesUntil;
  let delayMs = delayMinutes * 60 * 1000;
  
  // Cap at 24 hours just to be safe
  if (delayMs > 24 * 60 * 60 * 1000) {
    delayMs = 24 * 60 * 60 * 1000;
    delayMinutes = 24 * 60;
  }
  
  console.log("Next check in", delayMinutes, "minutes");
  activeTimer = Timer.set(delayMs, false, updateSwitchState);
  
  // Save next check time to KVS for monitoring (delayed to avoid blocking)
  let nextCheckTime = new Date(new Date().getTime() + delayMs).toISOString();
  Timer.set(1000, false, function() {
    Shelly.call("KVS.Set", {
      key: "tempo.thirdparty.nextCheck",
      value: nextCheckTime
    });
  });
}

// Handle API response
function handleApiResponse(result, error_code, error_message) {
  if (error_code !== 0) {
    let errorMsg = "HTTP Error: " + error_code + " - " + error_message;
    console.log("HTTP Error:", error_code, error_message);
    
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
      "API Error",
      errorMsg + "\nAttempt " + consecutiveFailures + ". Will retry in " + retryMsg + ".",
      "error"
    );
    
    // Apply fallback behavior on error
    applyFallbackBehavior();
    
    // Retry after exponential backoff delay
    console.log("Retrying in " + retryMsg + "...");
    activeTimer = Timer.set(retryDelay * 1000, false, callAPI);
    return;
  }
  
  // Success - check if we're recovering from failures
  if (consecutiveFailures > 0) {
    console.log("API recovered after", consecutiveFailures, "failures");
    sendNotification(
      "API Recovered",
      "Connection restored after " + consecutiveFailures + " failed attempt(s).",
      "info"
    );
  }
  
  // Reset failure counter on success
  consecutiveFailures = 0;
  
  let body = JSON.parse(result.body);
  let prevColor = loadColor();
  
  // Check if color has changed
  let colorChanged = prevColor.codeCouleur !== body.codeJour;
  
  if (colorChanged) {
    console.log("Color changed!");
  }
  
  console.log(
    "Color updated:",
    "codeJour=" + body.codeJour,
    "(" + body.libCouleur + ")",
    "date=" + body.dateJour
  );
  
  // Save new color with the date from API
  saveColor(body.codeJour, body.dateJour);
  
  // Now update switch state
  updateSwitchState();
}

// Call the Tempo API to fetch color
function callAPI() {
  console.log("Fetching Tempo color from API...");
  Shelly.call(
    "HTTP.GET",
    {
      url: CONFIG.url,
      content_type: "application/json",
      timeout: 10
    },
    handleApiResponse
  );
}

// Start the smart polling
console.log("Tempo Third-Party API Script starting...");

// Load configuration from KVS, then start
loadConfig(function() {
  console.log("Switch ID:", CONFIG.switchId);
  console.log("HP Hours:", CONFIG.hpStartHour + ":00 -", CONFIG.hpEndHour + ":00");
  // Calculate check time (safety delay before HP)
  let checkMinutes = CONFIG.hpStartHour * 60 - CONFIG.safetyDelayMinutes;
  let checkHour = Math.floor(checkMinutes / 60);
  let checkMin = checkMinutes % 60;
  let checkTimeStr = checkHour + ":" + (checkMin < 10 ? "0" : "") + checkMin;
  console.log("Safety delay:", CONFIG.safetyDelayMinutes, "minutes (check at", checkTimeStr, ")");
  console.log("Retry delay:", CONFIG.retryDelaySeconds, "seconds");
  console.log("Fallback behavior:", CONFIG.fallbackBehavior);
  console.log("Notifications:", CONFIG.notificationsEnabled ? "enabled" : "disabled");
  
  // Check if we have valid color data
  let colorData = loadColor();
  if (!colorData || !isColorValid(colorData)) {
    console.log("No valid color found (missing or outdated), fetching...");
    callAPI();
  } else {
    console.log("Valid color found (" + getColorName(colorData.codeCouleur) + "), updating switch state...");
    updateSwitchState();
  }
});