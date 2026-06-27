// Kiosk mode: hides interactive chrome and rotates the shipcard through
// visible ships using a Weighted Round Robin queue based on movement and updates.

import { settings, isKiosk } from '../core/state.js';
import { fromLonLat } from 'ol/proj';
import { containsCoordinate } from 'ol/extent';
import {
    getShipName,
    getFlagStyled,
    getShipTypeShort,
    getStatusVal,
    getCountryName,
    getSpeedVal,
    getSpeedUnit,
    getDistanceVal,
    getDistanceUnit,
    getShipDimension,
    getDeltaTimeVal,
    getDimVal,
    getDimUnit,
} from '../core/format.js';
import { ShippingClass, BASESTATION, SARTEPIRB, ATON, SAR } from '../core/constants.js';

// { getMap, getShipsDB, getShipsSince, getCardMmsi, getHoverMmsi,
//   showShipcard, saveSettings }
let deps = null;
let kioskAnimationInterval = null;
let currentHighlightIndex = 0;
let highlightsRotationInterval = null;
let kioskRotating = false;
let lastSuperlativesData = {
    fastest: "-",
    furthest: "-",
    closest: "-",
    largest: "-",
    total_active: "-",
    countries: "-"
};

export function init(d) {
    deps = d;
    window.addEventListener("resize", () => {
        if (isKiosk()) {
            updateKioskScreenOptimization();
        }
    });
}

export function setKiosk(enabled) {
    settings.kiosk = enabled;
    updateKiosk();
    deps.saveSettings();
}

export function setKioskRotationSpeed(speed) {
    settings.kiosk_rotation_speed = parseInt(speed);
    deps.saveSettings();

    if (isKiosk() && kioskAnimationInterval) {
        startKioskAnimation();
    }
}

export function setKioskPanMap(enabled) {
    settings.kiosk_pan_map = enabled;
    deps.saveSettings();
}

export function setKioskSelectionMode(mode) {
    settings.kiosk_selection_mode = mode;
    deps.saveSettings();
    updateKioskSettingsVisibility();
}

export function setKioskSidebarPosition(position) {
    settings.kiosk_sidebar_position = position;
    deps.saveSettings();
    updateSidebarVisibility();
    updateKioskSettingsVisibility();
}

export function setKioskWeightTransition(weight) {
    settings.kiosk_weight_transition = parseInt(weight);
    deps.saveSettings();
    syncBlocksFromWeights();
}

export function setKioskWeightChanged(weight) {
    settings.kiosk_weight_changed = parseInt(weight);
    deps.saveSettings();
    syncBlocksFromWeights();
}

export function setKioskWeightStationary(weight) {
    settings.kiosk_weight_stationary = parseInt(weight);
    deps.saveSettings();
    syncBlocksFromWeights();
}

function syncBlocksFromWeights() {
    let t = settings.kiosk_weight_transition ?? 3;
    let c = settings.kiosk_weight_changed ?? 3;
    let s = settings.kiosk_weight_stationary ?? 3;
    if (t + c + s !== 9) {
        // If they do not sum to 9, normalize/reset to 3-3-3
        t = 3;
        c = 3;
        s = 3;
        settings.kiosk_weight_transition = 3;
        settings.kiosk_weight_changed = 3;
        settings.kiosk_weight_stationary = 3;
    }
    const blocks = [];
    for (let i = 0; i < t; i++) blocks.push('transition');
    for (let i = 0; i < c; i++) blocks.push('changed');
    for (let i = 0; i < s; i++) blocks.push('stationary');
    settings.kiosk_weight_blocks = blocks;
    
    const bar = document.getElementById("kiosk_weight_bar");
    if (bar) {
        initWeightBarUI();
    }
}

export function initWeightBarUI() {
    const bar = document.getElementById("kiosk_weight_bar");
    if (!bar) return;

    let blocks = settings.kiosk_weight_blocks;
    if (!blocks || !Array.isArray(blocks) || blocks.length !== 9) {
        let t = settings.kiosk_weight_transition ?? 3;
        let c = settings.kiosk_weight_changed ?? 3;
        let s = settings.kiosk_weight_stationary ?? 3;
        
        if (t + c + s !== 9) {
            t = 3;
            c = 3;
            s = 3;
            settings.kiosk_weight_transition = 3;
            settings.kiosk_weight_changed = 3;
            settings.kiosk_weight_stationary = 3;
        }

        blocks = [];
        for (let i = 0; i < t; i++) blocks.push('transition');
        for (let i = 0; i < c; i++) blocks.push('changed');
        for (let i = 0; i < s; i++) blocks.push('stationary');
        
        settings.kiosk_weight_blocks = blocks;
        deps.saveSettings();
    }

    bar.innerHTML = "";
    blocks.forEach((state, index) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `kiosk-weight-token token-${state}`;
        button.dataset.index = index;
        button.title = "Tap to cycle: Transitions (Amber) -> Moving (Blue) -> Stationary (Gray)";
        button.setAttribute("aria-label", `Priority slot ${index + 1}: ${state}`);
        button.addEventListener("click", () => {
            cycleWeightBlock(index);
        });

        let letter = "S";
        if (state === 'transition') letter = "T";
        else if (state === 'changed') letter = "M";

        const letterSpan = document.createElement("span");
        letterSpan.className = "token-letter";
        letterSpan.textContent = letter;
        button.appendChild(letterSpan);

        const iconContainer = document.createElement("div");
        iconContainer.className = "token-icon-container";

        if (state === 'transition') {
            // Two opposing horizontal arrows (left / right swap)
            iconContainer.innerHTML = `
                <svg class="token-icon-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M20 17H4m16 0l-4-4m4 4l-4 4M4 7h16M4 7l4-4M4 7l4 4"></path>
                </svg>
            `;
        } else if (state === 'changed') {
            // Moving: vector arrowhead pointing top-right (rotated 45 deg)
            iconContainer.innerHTML = `
                <svg class="token-icon-svg" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 3L18 20L12 17L6 20Z" transform="rotate(45 12 12)"></path>
                </svg>
            `;
        } else {
            // Stationary: solid dot
            iconContainer.innerHTML = `
                <svg class="token-icon-svg" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="12" cy="12" r="5"></circle>
                </svg>
            `;
        }

        button.appendChild(iconContainer);
        bar.appendChild(button);
    });

    updateWeightBarLegend();
}

function cycleWeightBlock(index) {
    const states = ['transition', 'changed', 'stationary'];
    const current = settings.kiosk_weight_blocks[index];
    const nextIndex = (states.indexOf(current) + 1) % states.length;
    const nextState = states[nextIndex];

    settings.kiosk_weight_blocks[index] = nextState;

    // Recalculate weights
    const counts = { transition: 0, changed: 0, stationary: 0 };
    settings.kiosk_weight_blocks.forEach(s => counts[s]++);

    settings.kiosk_weight_transition = counts.transition;
    settings.kiosk_weight_changed = counts.changed;
    settings.kiosk_weight_stationary = counts.stationary;

    deps.saveSettings();

    // Update UI elements
    const bar = document.getElementById("kiosk_weight_bar");
    if (bar) {
        const button = bar.children[index];
        if (button) {
            button.className = `kiosk-weight-token token-${nextState}`;
            button.setAttribute("aria-label", `Priority slot ${index + 1}: ${nextState}`);

            let letter = "S";
            if (nextState === 'transition') letter = "T";
            else if (nextState === 'changed') letter = "M";

            const letterSpan = button.querySelector(".token-letter");
            if (letterSpan) {
                letterSpan.textContent = letter;
            }
        }
    }

    updateWeightBarLegend();
}

export function resetKioskWeights() {
    settings.kiosk_weight_blocks = [
        'transition', 'transition', 'transition',
        'changed', 'changed', 'changed',
        'stationary', 'stationary', 'stationary'
    ];
    settings.kiosk_weight_transition = 3;
    settings.kiosk_weight_changed = 3;
    settings.kiosk_weight_stationary = 3;
    deps.saveSettings();

    initWeightBarUI();
}

function updateWeightBarLegend() {
    const legend = document.getElementById("kiosk_weight_legend");
    if (!legend) return;

    const t = settings.kiosk_weight_transition ?? 3;
    const c = settings.kiosk_weight_changed ?? 3;
    const s = settings.kiosk_weight_stationary ?? 3;

    legend.innerHTML = `
        <div class="kiosk-weight-legend-item">
            <span class="legend-dot dot-transition"></span>
            <span>Transitions: ${t} Queues</span>
        </div>
        <div class="kiosk-weight-legend-item">
            <span class="legend-dot dot-changed"></span>
            <span>Moving Vessels: ${c} Queues</span>
        </div>
        <div class="kiosk-weight-legend-item">
            <span class="legend-dot dot-stationary"></span>
            <span>Stationary: ${s} Queues</span>
        </div>
    `;
}

export function setKioskSidebarHighlights(enabled) {
    settings.kiosk_sidebar_highlights = enabled;
    deps.saveSettings();
    updateHighlightsVisibility();
    if (enabled && isKiosk() && kioskAnimationInterval) {
        startHighlightsRotation();
    } else {
        stopHighlightsRotation();
    }
}

export function updateHighlightsVisibility() {
    const highlightsCard = document.getElementById("kiosk_sidebar_highlights_card");
    if (!highlightsCard) return;

    if (settings.kiosk_sidebar_highlights !== false) {
        highlightsCard.classList.remove("hidden");
    } else {
        highlightsCard.classList.add("hidden");
    }
}

export function startHighlightsRotation() {
    if (highlightsRotationInterval) {
        clearInterval(highlightsRotationInterval);
        highlightsRotationInterval = null;
    }

    currentHighlightIndex = 0;
    renderActiveHighlight();
}

export function stopHighlightsRotation() {
    if (highlightsRotationInterval) {
        clearInterval(highlightsRotationInterval);
        highlightsRotationInterval = null;
    }
}

export function isRotating() {
    return kioskRotating;
}

export function resetKioskTimer() {
    if (!isKiosk()) return;

    if (kioskAnimationInterval) {
        clearInterval(kioskAnimationInterval);
    }

    kioskAnimationInterval = setInterval(function () {
        showRandomKioskShip();
    }, settings.kiosk_rotation_speed * 1000);

    // Reset progress bar animation on the current card
    const bar = document.getElementById("kiosk_progress_bar");
    if (bar) {
        bar.style.backgroundColor = settings.shipselection_color || "var(--menu-font-color)";
        bar.style.transition = "none";
        bar.style.width = "0%";
        void bar.offsetWidth; // force reflow
        const duration = (settings.kiosk_rotation_speed || 5) + "s";
        bar.style.transition = `width ${duration} linear`;
        bar.style.width = "100%";
    }
}

function rotateHighlights() {
    const container = document.getElementById("kiosk_sidebar_highlights_container");
    if (!container) return;

    container.classList.add("kiosk_highlight_fade_out");

    setTimeout(() => {
        currentHighlightIndex = (currentHighlightIndex + 1) % 6;
        updateKioskSuperlatives();
        container.classList.remove("kiosk_highlight_fade_out");
    }, 300);
}

function renderActiveHighlight() {
    const labelEl = document.getElementById("kiosk_sidebar_highlight_label");
    const valEl = document.getElementById("kiosk_sidebar_highlight_value");
    const iconEl = document.getElementById("kiosk_sidebar_highlight_icon");
    if (!labelEl || !valEl || !iconEl) return;

    const highlights = [
        { label: "Fastest", iconClass: "kiosk_icon_speed", val: lastSuperlativesData.fastest },
        { label: "Furthest", iconClass: "kiosk_icon_cog", val: lastSuperlativesData.furthest },
        { label: "Closest", iconClass: "kiosk_icon_destination", val: lastSuperlativesData.closest },
        { label: "Largest", iconClass: "kiosk_icon_dimension", val: lastSuperlativesData.largest },
        { label: "Total Vessels", iconClass: "kiosk_icon_shiptype", val: lastSuperlativesData.total_active },
        { label: "Countries Represented", iconClass: "kiosk_icon_country", val: lastSuperlativesData.countries }
    ];

    let idx = currentHighlightIndex;
    if (idx < 0 || idx >= highlights.length) {
        idx = 0;
    }

    const item = highlights[idx];

    iconEl.className = `kiosk_icon ${item.iconClass}`;
    labelEl.innerHTML = item.label;
    valEl.innerHTML = item.val;

    const card = document.getElementById("kiosk_sidebar_highlights_card");
    if (card) {
        const isEmpty = !item.val || item.val === "-" || item.val === "0" || item.val === 0;
        if (isEmpty) {
            card.classList.add("kiosk_sidebar_row_empty");
        } else {
            card.classList.remove("kiosk_sidebar_row_empty");
        }
    }
}

export function updateSidebarVisibility() {
    const sidebar = document.getElementById("kiosk_sidebar");
    if (!sidebar) return;

    const position = settings.kiosk_sidebar_position || "off";
    const isKioskMode = isKiosk();
    const settingsWindow = document.querySelector(".settings_window");
    const isSettingsOpen = settingsWindow && settingsWindow.classList.contains("active");

    // Remove existing position classes
    sidebar.classList.remove("kiosk_sidebar-left", "kiosk_sidebar-right");

    if (isKioskMode && position !== "off" && !isSettingsOpen) {
        sidebar.classList.add(`kiosk_sidebar-${position}`);
        sidebar.classList.remove("hidden");
        updateHighlightsVisibility();
    } else {
        sidebar.classList.add("hidden");
    }
    updateKioskSettingsVisibility();
    updateKioskScreenOptimization();
}

export function updateKioskSettingsVisibility() {
    // 1. Hide Fleet Highlights if Vessel Details layout is set to "off"
    const highlightsRow = document.getElementById("settings_kiosk_sidebar_highlights_row");
    if (highlightsRow) {
        if (settings.kiosk_sidebar_position && settings.kiosk_sidebar_position !== "off") {
            highlightsRow.style.display = "";
        } else {
            highlightsRow.style.display = "none";
        }
    }

    // 2. Hide Priority Weights if Selection Mode is "random"
    const weightsRow = document.getElementById("settings_kiosk_priority_weights");
    if (weightsRow) {
        if (settings.kiosk_selection_mode === "priority" || settings.kiosk_selection_mode === "rotation") {
            weightsRow.style.display = "flex";
        } else {
            weightsRow.style.display = "none";
        }
    }
}

export function setKioskScreenOptimization(value) {
    settings.kiosk_screen_optimization = value;
    deps.saveSettings();
    updateSidebarVisibility();
}

export function updateKioskScreenOptimization() {
    const sidebar = document.getElementById("kiosk_sidebar");
    if (!sidebar) return;

    // Automatically scale based on window height (400px baseline)
    const scale = 1.0 + Math.max(0, window.innerHeight - 400) * 0.001;
    sidebar.style.setProperty("--kiosk-scale", scale);
}

export function toggleKioskMode() {
    settings.kiosk = !settings.kiosk;
    updateKiosk();
}

const originalDisplayValues = new Map();

function clearAndHide(element) {
    if (!originalDisplayValues.has(element)) {
        originalDisplayValues.set(element, element.style.display);
    }
    element.style.display = "none";
}

function restoreOriginalDisplay(element) {
    const saved = originalDisplayValues.get(element);
    if (saved) {
        element.style.display = saved;
    } else {
        element.style.removeProperty('display');
    }
}

export function updateKiosk() {
    const kiosk = isKiosk();
    if (kiosk) {
        if (!kioskAnimationInterval) {
            startKioskAnimation();
        }
    } else {
        stopKioskAnimation();
    }

    const toHide = document.querySelectorAll(kiosk ? ".nokiosk" : ".kiosk");
    const toShow = document.querySelectorAll(kiosk ? ".kiosk" : ".nokiosk");
    toHide.forEach(clearAndHide);
    toShow.forEach(restoreOriginalDisplay);
    updateSidebarVisibility();
}

// Kiosk Mode Weighted Selection state
let kioskLastShipState = {};
const transitionQueue = new Set();
const changedQueue = new Set();
const stationaryQueue = new Set();

const queues = {
    transition: transitionQueue,
    changed: changedQueue,
    stationary: stationaryQueue
};

let kioskSelectionCursor = 0;

function getSelectionPattern() {
    const transition = settings.kiosk_weight_transition ?? 3;
    const changed = settings.kiosk_weight_changed ?? 3;
    const stationary = settings.kiosk_weight_stationary ?? 3;
    const result = [];
    const maxLen = Math.max(transition, changed, stationary);
    for (let i = 0; i < maxLen; i++) {
        if (i < transition) result.push("transition");
        if (i < changed) result.push("changed");
        if (i < stationary) result.push("stationary");
    }
    return result.length > 0 ? result : ["transition", "changed"];
}



function haversineDistance(previousPosition, currentPosition) {
    const R = 6371e3; // Earth's mean radius in meters
    const lat1 = previousPosition.lat;
    const lon1 = previousPosition.lon;
    const lat2 = currentPosition.lat;
    const lon2 = currentPosition.lon;
    
    const lat1Rad = lat1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const deltaLat = (lat2 - lat1) * Math.PI / 180;
    const deltaLon = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
              Math.cos(lat1Rad) * Math.cos(lat2Rad) *
              Math.sin(deltaLon / 2) * Math.sin(deltaLon / 2);
              
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

// Helper to move a ship exclusively to one queue
function moveToQueue(mmsi, targetQueue) {
    [transitionQueue, changedQueue, stationaryQueue].forEach(queue => {
        if (queue === targetQueue) {
            queue.delete(mmsi); // Delete first to force insertion at the end (ES6 Set behavior)
            queue.add(mmsi);
        } else {
            queue.delete(mmsi);
        }
    });
}

function selectWeightedRandomShipForKiosk() {
    const map = deps.getMap();
    const shipsDB = deps.getShipsDB();
    const shipsSince = deps.getShipsSince();

    const mapExtent = map.getView().calculateExtent(map.getSize());
    const visibleShips = Object.keys(shipsDB).filter(mmsi => {
        const ship = shipsDB[mmsi].raw;
        if (!ship.lat || !ship.lon || ship.lat === 0 || ship.lon === 0) {
            return false;
        }

        const shipCoords = fromLonLat([ship.lon, ship.lat]);
        return containsCoordinate(mapExtent, shipCoords);
    });

    if (visibleShips.length === 0) {
        return null;
    }

    const candidates = visibleShips.filter(mmsi =>
        mmsi != deps.getCardMmsi() && mmsi != deps.getHoverMmsi()
    );

    const finalCandidates = candidates.length > 0 ? candidates : visibleShips;

    const weights = finalCandidates.map(mmsi => {
        const ship = shipsDB[mmsi].raw;
        const timeSinceUpdate = (shipsSince - ship.last_signal) || 3600;

        // Higher weight for more recently updated ships
        if (timeSinceUpdate < 60) return 10;
        if (timeSinceUpdate < 300) return 5;
        if (timeSinceUpdate < 900) return 2;
        return 1;
    });

    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
    let random = Math.random() * totalWeight;

    for (let i = 0; i < finalCandidates.length; i++) {
        random -= weights[i];
        if (random <= 0) {
            return finalCandidates[i];
        }
    }

    return finalCandidates[0];
}

function selectWeightedShipForKiosk() {
    const map = deps.getMap();
    const shipsDB = deps.getShipsDB();
    let candidates = [];

    if (settings.kiosk_pan_map) {
        // If panning is enabled, rotation candidate list is all active vessels in the database
        candidates = Object.keys(shipsDB).filter(mmsi => {
            const ship = shipsDB[mmsi].raw;
            return ship.lat && ship.lon && ship.lat !== 0 && ship.lon !== 0;
        });
    } else {
        // If panning is disabled, candidate list is restricted to vessels currently on-screen
        const mapExtent = map.getView().calculateExtent(map.getSize());
        candidates = Object.keys(shipsDB).filter(mmsi => {
            const ship = shipsDB[mmsi].raw;
            if (!ship.lat || !ship.lon || ship.lat === 0 || ship.lon === 0) {
                return false;
            }
            const shipCoords = fromLonLat([ship.lon, ship.lat]);
            return containsCoordinate(mapExtent, shipCoords);
        });
    }

    if (candidates.length === 0) {
        kioskLastShipState = {}; // Reset state if no candidate ships are available
        return null;
    }

    // Start every ship as stationary on startup
    if (Object.keys(kioskLastShipState).length === 0) {
        candidates.forEach(mmsi => {
            moveToQueue(mmsi, stationaryQueue);
        });
        // Seed initial positions
        candidates.forEach(mmsi => {
            const raw = shipsDB[mmsi].raw;
            kioskLastShipState[mmsi] = {
                lat: raw.lat,
                lon: raw.lon,
                speed: raw.speed,
                cog: raw.cog,
                last_signal: raw.last_signal,
                isMoving: false
            };
        });
    }

    // Clean up queues from ships that are no longer candidates
    const candidateSet = new Set(candidates);
    [transitionQueue, changedQueue, stationaryQueue].forEach(queue => {
        for (const mmsi of queue) {
            if (!candidateSet.has(mmsi)) {
                console.log("Kiosk Mode: Removing no longer candidate ship: " + mmsi);
                queue.delete(mmsi);
            }
        }
    });

    const newKioskLastShipState = {};

    // Move ships to the appropriate queues
    candidates.forEach(mmsi => {
        const ship = shipsDB[mmsi].raw;
        const lastShip = kioskLastShipState[mmsi];

        // Determine current moving state:
        // Consider stationary if speed has not changed and is < 1.0 kt
        let currentMoving = false;
        if (ship.speed != null && ship.cog != null) {
            if (lastShip != null) {
                if (ship.last_signal === lastShip.last_signal) {
                    // No new reading has been received, keep the same state
                    currentMoving = lastShip.isMoving || false;
                } else {
                    // A new reading has been received
                    if (lastShip.speed != null && ship.speed === lastShip.speed && ship.speed < 1.0) {
                        currentMoving = false;
                    } else {
                        currentMoving = ship.speed > 0.5;
                    }
                }
            } else {
                // First reading for this ship: if speed is under 1.0 kt, consider it stationary
                currentMoving = ship.speed >= 1.0;
            }
        }

        // Save current state snapshot
        newKioskLastShipState[mmsi] = {
            lat: ship.lat,
            lon: ship.lon,
            speed: ship.speed,
            cog: ship.cog,
            last_signal: ship.last_signal,
            isMoving: currentMoving
        };

        // New Ship
        if (lastShip == null) {
            console.log("Kiosk Mode: New ship detected: " + mmsi);
            if (!transitionQueue.has(mmsi)) {
                moveToQueue(mmsi, transitionQueue);
            }
        } else {
            const lastMoving = lastShip.isMoving || false;
            
            // Ship changed from stationary to moving or vice versa
            if (currentMoving !== lastMoving) {
                console.log("Kiosk Mode: State change detected: " + mmsi + " (Moving: " + currentMoving + ")");
                if (!transitionQueue.has(mmsi)) {
                    moveToQueue(mmsi, transitionQueue);
                }
            } else {
                const distanceMoved = haversineDistance(lastShip, ship);
                if (distanceMoved > 5) {
                    // Ship moved
                    console.log("Kiosk Mode: Ship move detected: " + mmsi + " distance: " + distanceMoved);
                    if (!changedQueue.has(mmsi)) {
                        moveToQueue(mmsi, changedQueue);
                    }
                } else {
                    if (!stationaryQueue.has(mmsi)) {
                        moveToQueue(mmsi, stationaryQueue);
                    }
                }
            }
        }
    });

    // Hold onto a cloned snapshot of the state for comparison next time
    kioskLastShipState = newKioskLastShipState;

    let nextShip = null;
    const pattern = getSelectionPattern();

    // Check all queues for next ship.
    for (let i = 0; i < pattern.length && nextShip == null; i++) {
        const queueKey = pattern[kioskSelectionCursor % pattern.length];
        const currentQueue = queues[queueKey];
        if (currentQueue && currentQueue.size > 0) {
            nextShip = currentQueue.values().next().value;
            moveToQueue(nextShip, stationaryQueue);
            console.log("Read from Queue: " + queueKey);
        }
        // Update cursor and wrap back around
        kioskSelectionCursor = (kioskSelectionCursor + 1) % pattern.length;
    }
  
    console.log("Transition Queue Depth: " + transitionQueue.size);
    console.log("Changed Queue Depth: " + changedQueue.size);
    console.log("Stationary Queue Depth: " + stationaryQueue.size);
    console.log("Candidate Ships: " + candidates.length);

    return nextShip;
}

function selectRandomShipForKiosk() {
    const mode = settings.kiosk_selection_mode;
    if (mode === "priority" || mode === "rotation") {
        return selectWeightedShipForKiosk();
    } else {
        return selectWeightedRandomShipForKiosk();
    }
}

function setRowValue(id, val, isAvailable = true) {
    const el = document.getElementById(id);
    if (!el) return;

    el.innerHTML = val || "-";

    const row = el.closest(".kiosk_sidebar_row");
    if (row) {
        const isEmpty = !val || val === "-" || val === "Not available" || !isAvailable;
        if (isEmpty) {
            row.classList.add("kiosk_sidebar_row_empty");
        } else {
            row.classList.remove("kiosk_sidebar_row_empty");
        }
    }
}

function updateKioskSuperlatives() {
    const shipsDB = deps.getShipsDB();
    const shipsSince = deps.getShipsSince();
    const shipsList = Object.keys(shipsDB)
        .map(mmsi => shipsDB[mmsi].raw)
        .filter(ship => {
            if (!ship.lat || !ship.lon || ship.lat === 0 || ship.lon === 0) {
                return false;
            }
            // Exclude beacons, stations, SAR devices, EPIRBs, and aircraft
            if (ship.shipclass === ShippingClass.ATON ||
                ship.shipclass === ShippingClass.STATION ||
                ship.shipclass === ShippingClass.SARTEPIRB ||
                ship.shipclass === ShippingClass.PLANE ||
                ship.shipclass === ShippingClass.HELICOPTER) {
                return false;
            }
            if (ship.mmsi_type === BASESTATION ||
                ship.mmsi_type === SARTEPIRB ||
                ship.mmsi_type === ATON ||
                ship.mmsi_type === SAR) {
                return false;
            }
            return true;
        });

    if (shipsList.length === 0) {
        lastSuperlativesData.fastest = "-";
        lastSuperlativesData.furthest = "-";
        lastSuperlativesData.closest = "-";
        lastSuperlativesData.largest = "-";
        lastSuperlativesData.total_active = "-";
        lastSuperlativesData.countries = "-";
        renderActiveHighlight();
        return;
    }

    let fastest = null;
    let furthest = null;
    let closest = null;

    shipsList.forEach(ship => {
        // Fastest
        if (ship.speed != null && ship.speed > 0) {
            if (!fastest || ship.speed > fastest.speed) {
                fastest = ship;
            }
        }
        // Distance-based (Closest / Furthest)
        if (ship.distance != null && ship.distance > 0) {
            // Furthest: only include if we can determine a ship name instead of an MMSI
            if (getShipName(ship)) {
                if (!furthest || ship.distance > furthest.distance) {
                    furthest = ship;
                }
            }
            if (!closest || ship.distance < closest.distance) {
                closest = ship;
            }
        }
    });

    // Active ships (signals in last 30 minutes)
    const referenceTime = shipsSince || Math.floor(Date.now() / 1000);
    const activeShips = shipsList.filter(ship => (referenceTime - ship.last_signal) < 1800);

    // Largest
    let largest = null;
    let maxLength = 0;
    activeShips.forEach(ship => {
        if (ship.to_bow != null && ship.to_stern != null) {
            const length = ship.to_bow + ship.to_stern;
            if (length > maxLength) {
                maxLength = length;
                largest = ship;
            }
        }
    });

    // Countries
    // Countries represented counts and flags list
    const countryCounts = {};
    activeShips.forEach(ship => {
        if (ship.country && ship.country.trim() !== "") {
            const code = ship.country.trim().toUpperCase();
            countryCounts[code] = (countryCounts[code] || 0) + 1;
        }
    });

    const sortedCountries = Object.entries(countryCounts)
        .sort((a, b) => b[1] - a[1]);

    let countriesHTML = "-";
    if (sortedCountries.length > 0) {
        const topN = 3;
        const topCountries = sortedCountries.slice(0, topN);
        const otherCountries = sortedCountries.slice(topN);

        const items = [];
        topCountries.forEach(([code, count]) => {
            const flagHTML = getFlagStyled(code, "padding: 0px; margin: 0px; box-shadow: 1px 1px 2px rgba(0, 0, 0, 0.2); font-size: 20px; display: inline-block; vertical-align: middle;");
            const name = getCountryName(code) || code;
            items.push(`<div class="kiosk_country_item" title="${name}">${flagHTML} <span class="kiosk_country_count">${count}</span></div>`);
        });

        if (otherCountries.length > 0) {
            const otherCount = otherCountries.reduce((sum, [_, count]) => sum + count, 0);
            const otherFlagHTML = `<span class="fi fi-xx" style="padding: 0px; margin: 0px; box-shadow: 1px 1px 2px rgba(0, 0, 0, 0.2); font-size: 20px; display: inline-block; vertical-align: middle;" title="Other countries"></span>`;
            items.push(`<div class="kiosk_country_item other" title="Other countries">${otherFlagHTML} <span class="kiosk_country_count">${otherCount} other</span></div>`);
        }

        countriesHTML = `<div class="kiosk_countries_list">${items.join("")}</div>`;
    }

    const formatVessel = (ship, valueStr) => {
        if (!ship) return "-";
        const name = getShipName(ship) || ship.mmsi;
        return `<span class="kiosk_highlight_shipname">${name}</span><span class="kiosk_highlight_metric">${valueStr}</span>`;
    };

    const fastestStr = fastest ? getSpeedVal(fastest.speed) + " " + getSpeedUnit() : null;
    const furthestStr = furthest ? getDistanceVal(furthest.distance) + " " + getDistanceUnit() : null;
    const closestStr = closest ? getDistanceVal(closest.distance) + " " + getDistanceUnit() : null;
    const largestStr = largest ? getDimVal(largest.to_bow + largest.to_stern) + " " + getDimUnit() : null;

    lastSuperlativesData.fastest = fastest ? formatVessel(fastest, fastestStr) : "-";
    lastSuperlativesData.furthest = furthest ? formatVessel(furthest, furthestStr) : "-";
    lastSuperlativesData.closest = closest ? formatVessel(closest, closestStr) : "-";
    lastSuperlativesData.largest = largest ? formatVessel(largest, largestStr) : "-";
    lastSuperlativesData.total_active = activeShips.length > 0 ? `<span class="kiosk_highlight_shipname">${activeShips.length}</span>` : "-";
    lastSuperlativesData.countries = countriesHTML;

    renderActiveHighlight();
}

export function populateKioskSidebar(mmsi, isRefresh = false) {
    const shipsDB = deps.getShipsDB();
    const ship = shipsDB[mmsi].raw;
    const shipsSince = deps.getShipsSince();

    const titleEl = document.getElementById("kiosk_sidebar_header_title");
    titleEl.innerHTML = (getShipName(ship) || ship.mmsi);
    titleEl.style.color = settings.shipselection_color || "var(--menu-font-color)";

    setRowValue("kiosk_sidebar_shiptype", ship.shiptype != null ? getShipTypeShort(ship.shiptype) : "-");

    // Status with colored indicator dot
    const statusVal = getStatusVal(ship) || "Not available";
    let dotColor = "var(--error-color)"; // Default Red for Not available/Not defined
    const lowStatus = statusVal.toLowerCase();

    if (lowStatus.includes("under way")) {
        dotColor = "#22c55e"; // Green
    } else if (lowStatus.includes("anchor") || lowStatus.includes("moored")) {
        dotColor = "#3b82f6"; // Blue
    } else if (statusVal === "Not available" || statusVal === "Not defined") {
        dotColor = "var(--error-color)"; // Red
    } else {
        dotColor = "#eab308"; // Yellow/Orange for other states
    }

    const statusHTML = `<span class="kiosk_status_dot" style="background-color: ${dotColor}"></span>${statusVal}`;
    const isStatusAvailable = statusVal !== "Not available" && statusVal !== "Not defined" && statusVal !== "Not defined/default";

    setRowValue("kiosk_sidebar_status", statusHTML, isStatusAvailable);
    
    const countryName = getCountryName(ship.country) || "-";
    const countryFlag = ship.country ? getFlagStyled(ship.country, "padding: 0px; margin: 0px; margin-right: 6px; box-shadow: 1px 1px 2px rgba(0, 0, 0, 0.2); font-size: 16px; display: inline-block; vertical-align: middle;") : "";
    setRowValue("kiosk_sidebar_country", countryFlag + countryName);
    setRowValue("kiosk_sidebar_speed", ship.speed ? getSpeedVal(ship.speed) + " " + getSpeedUnit() : "-");

    const headingVal = ship.heading && ship.heading < 360 ? Number(ship.heading).toFixed(0) + "&deg;" : "-";
    setRowValue("kiosk_sidebar_heading", headingVal, headingVal !== "-");

    const cogVal = ship.cog && ship.cog < 360 ? Number(ship.cog).toFixed(0) + "&deg;" : "-";
    setRowValue("kiosk_sidebar_cog", cogVal, cogVal !== "-");

    setRowValue("kiosk_sidebar_destination", ship.destination || "-");
    setRowValue("kiosk_sidebar_dimension", getShipDimension(ship) || "-");
    setRowValue("kiosk_sidebar_last_signal", getDeltaTimeVal(shipsSince - ship.last_signal) || "-");

    // Reset and animate subtle horizontal progress bar
    if (!isRefresh) {
        const bar = document.getElementById("kiosk_progress_bar");
        if (bar) {
            bar.style.backgroundColor = settings.shipselection_color || "var(--menu-font-color)";
            bar.style.transition = "none";
            bar.style.width = "0%";
            void bar.offsetWidth; // force reflow
            const duration = (settings.kiosk_rotation_speed || 5) + "s";
            bar.style.transition = `width ${duration} linear`;
            bar.style.width = "100%";
        }
    }

    updateKioskSuperlatives();
}

function showKioskShip(mmsi) {
    const shipsDB = deps.getShipsDB();
    if (!mmsi || !(mmsi in shipsDB)) {
        console.log("Invalid MMSI or ship not found:", mmsi);
        return;
    }

    const ship = shipsDB[mmsi].raw;
    if (!ship.lat || !ship.lon) {
        console.log("Ship has no valid coordinates:", mmsi);
        return;
    }

    const position = settings.kiosk_sidebar_position || "off";
    if (position !== "off") {
        // Populate and show the compact sidebar
        populateKioskSidebar(mmsi);
        
        // Set standard selected ship so focus marker/circle is drawn
        deps.showShipcard('ship', mmsi);

        // Make sure sidebar is visible
        updateSidebarVisibility();

        // Pan map to ship if pan map setting is enabled
        if (settings.kiosk_pan_map) {
            const map = deps.getMap();
            const shipCoords = fromLonLat([ship.lon, ship.lat]);
            map.getView().animate({
                center: shipCoords,
                duration: 1000
            });
        }
    } else {
        // Hide compact sidebar
        const sidebar = document.getElementById("kiosk_sidebar");
        if (sidebar) sidebar.classList.add("hidden");

        // Show the standard floating shipcard
        const map = deps.getMap();
        const shipCoords = fromLonLat([ship.lon, ship.lat]);
        const pixel = map.getPixelFromCoordinate(shipCoords);
        deps.showShipcard('ship', mmsi, pixel);
    }
}

function showRandomKioskShip() {
    kioskRotating = true;
    const selectedMMSI = selectRandomShipForKiosk();
    if (selectedMMSI) {
        showKioskShip(selectedMMSI);
    }
    if (settings.kiosk_sidebar_highlights !== false) {
        rotateHighlights();
    }
    kioskRotating = false;
}

function startKioskAnimation() {
    if (kioskAnimationInterval) {
        clearInterval(kioskAnimationInterval);
    }

    currentHighlightIndex = -1;
    showRandomKioskShip();
    kioskAnimationInterval = setInterval(function () {
        showRandomKioskShip();
    }, settings.kiosk_rotation_speed * 1000);
}

function stopKioskAnimation() {
    if (kioskAnimationInterval) {
        clearInterval(kioskAnimationInterval);
        kioskAnimationInterval = null;
        console.log("Kiosk animation stopped");
    }
    stopHighlightsRotation();

    // Clear state to prevent leaks
    kioskLastShipState = {};
    transitionQueue.clear();
    changedQueue.clear();
    stationaryQueue.clear();
    updateSidebarVisibility();
}

