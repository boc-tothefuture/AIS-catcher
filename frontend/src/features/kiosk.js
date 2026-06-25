// Kiosk mode: hides interactive chrome and rotates the shipcard through
// visible ships using a Weighted Round Robin queue based on movement and updates.

import { settings, isKiosk } from '../core/state.js';
import { fromLonLat } from 'ol/proj';
import { containsCoordinate } from 'ol/extent';

// { getMap, getShipsDB, getShipsSince, getCardMmsi, getHoverMmsi,
//   showShipcard, saveSettings }
let deps = null;
let kioskAnimationInterval = null;

export function init(d) {
    deps = d;
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
    if (kiosk) startKioskAnimation();
    else stopKioskAnimation();

    const toHide = document.querySelectorAll(kiosk ? ".nokiosk" : ".kiosk");
    const toShow = document.querySelectorAll(kiosk ? ".kiosk" : ".nokiosk");
    toHide.forEach(clearAndHide);
    toShow.forEach(restoreOriginalDisplay);
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
const kioskSelectionPattern = [
    "transition",
    "transition",
    "transition",
    "transition",
    "changed",
    "stationary",
    "changed",
    "stationary",
    "changed"
];



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

    // Check all queues for next ship.
    for (let i = 0; i < kioskSelectionPattern.length && nextShip == null; i++) {
        const queueKey = kioskSelectionPattern[kioskSelectionCursor];
        const currentQueue = queues[queueKey];
        if (currentQueue && currentQueue.size > 0) {
            nextShip = currentQueue.values().next().value;
            moveToQueue(nextShip, stationaryQueue);
            console.log("Read from Queue: " + queueKey);
        }
        // Update cursor and wrap back around
        kioskSelectionCursor = (kioskSelectionCursor + 1) % kioskSelectionPattern.length;
    }
  
    console.log("Transition Queue Depth: " + transitionQueue.size);
    console.log("Changed Queue Depth: " + changedQueue.size);
    console.log("Stationary Queue Depth: " + stationaryQueue.size);
    console.log("Candidate Ships: " + candidates.length);

    return nextShip;
}

function selectRandomShipForKiosk() {
    if (settings.kiosk_selection_mode === "rotation") {
        return selectWeightedShipForKiosk();
    } else {
        return selectWeightedRandomShipForKiosk();
    }
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

    const map = deps.getMap();
    const shipCoords = fromLonLat([ship.lon, ship.lat]);
    const pixel = map.getPixelFromCoordinate(shipCoords);
    deps.showShipcard('ship', mmsi, pixel);
}

function showRandomKioskShip() {
    const selectedMMSI = selectRandomShipForKiosk();
    if (selectedMMSI) {
        showKioskShip(selectedMMSI);
    }
}

function startKioskAnimation() {
    if (kioskAnimationInterval) {
        clearInterval(kioskAnimationInterval);
    }

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
    // Clear state to prevent leaks
    kioskLastShipState = {};
    transitionQueue.clear();
    changedQueue.clear();
    stationaryQueue.clear();
}

