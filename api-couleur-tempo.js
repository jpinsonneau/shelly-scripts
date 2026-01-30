/**
 * Shelly Tempo Script - Third-Party API Version
 * 
 * Controls a Shelly switch based on French EDF Tempo pricing.
 * Switch turns ON only during HP Rouge (Peak Hours on Red Days).
 * 
 * API: https://www.api-couleur-tempo.fr/api/now (Third-party)
 * Checks: 1 API call per day (at 11:00 AM for color data)
 * HP/HC state calculated locally based on time
 * 
 * Configuration: Use KVS (Key-Value Store) to configure without editing script
 * See README.md for configuration instructions
 * 
 * @see https://github.com/yourusername/shelly-tempo
 * @license MIT
 */

// Default configuration (used if KVS values not set)
let DEFAULT_CONFIG = {
  url: "https://www.api-couleur-tempo.fr/api/now",
  switchId: 1,
  hpStartHour: 6,
  hpEndHour: 22,
  colorCheckHour: 11,
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
      else if (key === "tempo.colorCheckHour") CONFIG.colorCheckHour = item.value;
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
}

// Simplified notification function
function sendNotification(title, message, severity) {
  if (!CONFIG.notificationsEnabled) return;
  
  let now = new Date().getTime();
  if (lastErrorNotified && (now - lastErrorNotified) < 60 * 60 * 1000) return;
  lastErrorNotified = now;
  
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
  if (CONFIG.mqttEnabled && typeof MQTT !== "undefined") {
    MQTT.publish(CONFIG.mqttTopic, fullMessage, 0, false);
  }
}

// Load persisted color from storage
function loadColor() {
  let stored = Script.storage.getItem("tempoColor");
  if (stored) {
    return JSON.parse(stored);
  }
  return { codeCouleur: null, lastFetch: null };
}

// Save color to storage
function saveColor(codeCouleur) {
  let state = { 
    codeCouleur: codeCouleur, 
    lastFetch: new Date().toISOString() 
  };
  Script.storage.setItem("tempoColor", JSON.stringify(state));
}

// Determine current HP/HC state locally (1=HP, 2=HC)
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

// Calculate minutes until next check time
function getMinutesUntilNextCheck() {
  let now = new Date();
  let currentHour = now.getHours();
  let currentMinute = now.getMinutes();
  let minutesSinceMidnight = currentHour * 60 + currentMinute;
  
  let hpStart = CONFIG.hpStartHour * 60;      // 6:00 = 360 min
  let hpEnd = CONFIG.hpEndHour * 60;          // 22:00 = 1320 min
  let colorCheck = CONFIG.colorCheckHour * 60; // 11:00 = 660 min
  
  let checkTimes = [hpStart, colorCheck, hpEnd];
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
    nextCheck = hpStart + (24 * 60); // 6 AM tomorrow
  }
  
  let minutesUntil = nextCheck - minutesSinceMidnight;
  return minutesUntil;
}

// Update switch state based on current conditions
function updateSwitchState() {
  let colorData = loadColor();
  let codeCouleur = colorData.codeCouleur;
  let codeHoraire = getCurrentHoraireCode();
  
  if (codeCouleur === null) {
    console.log("No color data available, fetching...");
    callAPI();
    return;
  }
  
  let colorName = codeCouleur === 1 ? "Bleu" : codeCouleur === 2 ? "Blanc" : "Rouge";
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
  
  logStatus();
  
  // Check if we need to refresh color (at 11 AM)
  let now = new Date();
  let currentHour = now.getHours();
  let currentMinute = now.getMinutes();
  let minutesSinceMidnight = currentHour * 60 + currentMinute;
  let colorCheckTime = CONFIG.colorCheckHour * 60;
  
  // If it's around color check time (11:00 +/- 30 min), fetch new color
  if (Math.abs(minutesSinceMidnight - colorCheckTime) < 30) {
    let lastFetch = colorData.lastFetch;
    
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
      console.log("Time to refresh color data");
      callAPI();
      return; // callAPI will schedule next check
    }
  }
  
  // Schedule next check at the next transition time
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
  
  // Add 2 minutes buffer to ensure transition has occurred
  let delayMinutes = minutesUntil + 2;
  let delayMs = delayMinutes * 60 * 1000;
  
  // Cap at 24 hours just to be safe
  if (delayMs > 24 * 60 * 60 * 1000) {
    delayMs = 24 * 60 * 60 * 1000;
    delayMinutes = 24 * 60;
  }
  
  console.log("Next check in", delayMinutes, "minutes");
  activeTimer = Timer.set(delayMs, false, updateSwitchState);
}

// Handle API response
function handleApiResponse(result, error_code, error_message) {
  if (error_code !== 0) {
    let errorMsg = "HTTP Error: " + error_code + " - " + error_message;
    console.log("HTTP Error:", error_code, error_message);
    
    let retryMinutes = Math.round(CONFIG.retryDelaySeconds / 60);
    let retrySeconds = CONFIG.retryDelaySeconds % 60;
    let retryMsg = retryMinutes > 0 ? retryMinutes + " minutes" : retrySeconds + " seconds";
    
    sendNotification(
      "API Error",
      errorMsg + "\nWill retry in " + retryMsg + ".",
      "error"
    );
    
    // Apply fallback behavior on error
    applyFallbackBehavior();
    
    // Retry after configured delay
    console.log("Retrying in " + retryMsg + "...");
    activeTimer = Timer.set(CONFIG.retryDelaySeconds * 1000, false, callAPI);
    return;
  }
  
  let body = JSON.parse(result.body);
  let prevColor = loadColor();
  
  // Check if color has changed
  let colorChanged = prevColor.codeCouleur !== body.codeCouleur;
  
  if (colorChanged) {
    console.log("Color changed!");
  }
  
  console.log(
    "Color updated:",
    "codeCouleur=" + body.codeCouleur,
    "(" + body.libTarif + ")"
  );
  
  // Save new color
  saveColor(body.codeCouleur);
  
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
  console.log("Retry delay:", CONFIG.retryDelaySeconds, "seconds");
  console.log("Fallback behavior:", CONFIG.fallbackBehavior);
  console.log("Notifications:", CONFIG.notificationsEnabled ? "enabled" : "disabled");
  
  // Check if we have valid color data
  let colorData = loadColor();
  if (!colorData || colorData.codeCouleur === null) {
    console.log("No color data found, fetching initial data...");
    callAPI();
  } else {
    console.log("Color data loaded from storage");
    updateSwitchState();
  }
});