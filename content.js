/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const browser = chrome;

const TIMER_SIZES = ["10px", "12px", "14px", "16px"];

const TIMER_LOCATIONS = [
	["0px", "auto", "0px", "auto"],
	["0px", "auto", "auto", "0px"],
	["auto", "0px", "auto", "0px"],
	["auto", "0px", "0px", "auto"]
];

var gTimer;
var gAlert;

// Update timer
//
function updateTimer(text, size, location) {
	if (!text) {
		if (gTimer) {
			// Hide timer
			gTimer.hidden = true;
		}
	} else {
		if (!gTimer) {
			// Create timer
			gTimer = document.createElement("div");
			gTimer.setAttribute("class", "leechblock-timer");
			gTimer.addEventListener("dblclick", function (e) { this.style.display = "none"; });
		}

		if (!document.body.contains(gTimer)) {
			// Insert timer at end of document body
			document.body.appendChild(gTimer);
		}

		// Set text
		gTimer.innerText = text;

		// Set size
		if (size >= 0 && size < TIMER_SIZES.length) {
			gTimer.style.fontSize = TIMER_SIZES[size];
		}

		// Set location
		if (location >= 0 && location < TIMER_LOCATIONS.length) {
			gTimer.style.top = TIMER_LOCATIONS[location][0];
			gTimer.style.bottom = TIMER_LOCATIONS[location][1];
			gTimer.style.left = TIMER_LOCATIONS[location][2];
			gTimer.style.right = TIMER_LOCATIONS[location][3];
		}

		// Show timer
		gTimer.hidden = false;
	}
}

// Show alert message
//
function showAlert(text) {
	let alertBox, alertIcon, alertText;

	if (!gAlert) {
		// Create container
		gAlert = document.createElement("div");
		gAlert.setAttribute("class", "leechblock-alert-container");
		document.body.appendChild(gAlert);

		// Create message box
		alertBox = document.createElement("div");
		alertBox.setAttribute("class", "leechblock-alert-box");
		alertBox.addEventListener("click", hideAlert);
		alertIcon = document.createElement("div");
		alertIcon.setAttribute("class", "leechblock-alert-icon");
		alertBox.appendChild(alertIcon);
		alertText = document.createElement("div");
		alertText.setAttribute("class", "leechblock-alert-text");
		alertBox.appendChild(alertText);
		gAlert.appendChild(alertBox);
	}

	// Set text
	alertText.innerText = text;

	// Show timer
	gAlert.style.display = "flex";
}

// Hide alert message
//
function hideAlert() {
	if (gAlert) {
		gAlert.style.display = "none";
	}
}

// Check page for keyword(s)
//
function checkKeyword(keywordRE) {
	if (!keywordRE) {
		return null; // nothing to find!
	}

	// Get all text nodes in document
	let textNodes = document.evaluate(
		"//text()", document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);

	//console.log("Checking " + textNodes.snapshotLength + " text node(s) for keyword(s)...");

	for (let i = 0; i < textNodes.snapshotLength; i++) {
		let matches;
		let data = textNodes.snapshotItem(i).data;
		if (data && (matches = keywordRE.exec(data)) != null) {
			return matches[0]; // keyword(s) found
		}
	}

	return null; // keyword(s) not found
}

// Apply filter
//
function applyFilter(name) {
	let filters = {
		"blur (1px)": "blur(1px)",
		"blur (2px)": "blur(2px)",
		"blur (4px)": "blur(4px)",
		"blur (8px)": "blur(8px)",
		"blur (16px)": "blur(16px)",
		"blur (32px)": "blur(32px)",
		"fade (80%)": "opacity(20%)",
		"fade (90%)": "opacity(10%)",
		"grayscale": "grayscale(100%)",
		"invert": "invert(100%)",
		"sepia": "sepia(100%)"
	};
	if (name && filters[name]) {
		document.body.style.filter = filters[name];
	} else {
		document.body.style.filter = "none";
	}
}

/*** EVENT HANDLERS BEGIN HERE ***/

function handleMessage(message, sender, sendResponse) {

	switch (message.type) {

		case "alert":
			showAlert(message.text);
			break;

		case "filter":
			applyFilter(message.name);
			break;

		case "keyword":
			let keyword = checkKeyword(new RegExp(message.keywordRE, "iu")); // Chrome workaround
			sendResponse(keyword);
			break;

		case "timer":
			updateTimer(message.text, message.size, message.location);
			break;

	}

}

browser.runtime.onMessage.addListener(handleMessage);

// Send URL of referring page to background script
browser.runtime.sendMessage({ type: "referrer", referrer: document.referrer });
