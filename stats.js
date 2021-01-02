/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const browser = chrome;

function log(message) { console.log("[LBNG] " + message); }
function warn(message) { console.warn("[LBNG] " + message); }

function getElement(id) { return document.getElementById(id); }

var gFormHTML;
var gNumSets;

// Initialize form (with specified number of block sets)
//
function initForm(numSets) {
	//log("initForm: " + numSets);

	// Reset form to original HTML
	$("#form").html(gFormHTML);

	gNumSets = +numSets;

	// Use HTML for first row to create other rows
	let rowHTML = $("#statsRow1").html();
	for (let set = 2; set <= gNumSets; set++) {
		let nextRowHTML = rowHTML
				.replace(/(Block Set) 1/g, `$1 ${set}`)
				.replace(/id="(\w+)1"/g, `id="$1${set}"`);
		$("#statsTable").append(`<tr id="statsRow${set}">${nextRowHTML}</tr>`);
	}

	$(":button").click(handleClick);
}

// Refresh page
//
function refreshPage() {
	//log("refreshPage");

	$("#form").hide();

	browser.storage.local.get("sync", onGotSync);

	function onGotSync(options) {
		if (browser.runtime.lastError) {
			warn("Cannot get options: " + browser.runtime.lastError.message);
			return;
		}

		if (options["sync"]) {
			browser.storage.sync.get(onGot);
		} else {
			browser.storage.local.get(onGot);
		}
	}

	function onGot(options) {
		if (browser.runtime.lastError) {
			warn("Cannot get options: " + browser.runtime.lastError.message);
			return;
		}

		cleanOptions(options);

		// Initialize form
		initForm(options["numSets"]);

		setTheme(options["theme"]);

		// Get current time in seconds
		let clockOffset = options["clockOffset"];
		let now = Math.floor(Date.now() / 1000) + (clockOffset * 60);

		for (let set = 1; set <= gNumSets; set++) {
			let setName = options[`setName${set}`];
			let timedata = options[`timedata${set}`];
			let limitMins = options[`limitMins${set}`];
			let limitPeriod = options[`limitPeriod${set}`];
			let limitOffset = options[`limitOffset${set}`];
			let periodStart = getTimePeriodStart(now, limitPeriod, limitOffset);

			if (setName) {
				getElement(`blockSetName${set}`).innerText = setName;
			}

			if (Array.isArray(timedata) && timedata.length == 5) {
				let fs = getFormattedStats(now, timedata);
				getElement(`startTime${set}`).innerText = fs.startTime;
				getElement(`totalTime${set}`).innerText = fs.totalTime;
				getElement(`perWeekTime${set}`).innerText = fs.perWeekTime;
				getElement(`perDayTime${set}`).innerText = fs.perDayTime;

				if (limitMins && limitPeriod) {
					// Calculate total seconds left in this time period
					let secsLeft = (timedata[2] == periodStart)
							? Math.max(0, (limitMins * 60) - timedata[3])
							: (limitMins * 60);
					let timeLeft = formatTime(secsLeft);
					getElement(`timeLeft${set}`).innerText = timeLeft;
				}

				if (timedata[4] > now) {
					let ldEndTime = new Date(timedata[4] * 1000).toLocaleString();
					getElement(`ldEndTime${set}`).innerText = ldEndTime;
				}
			}
		}

		$("#form").show();
	}
}

// Return formatted times based on time data
//
function getFormattedStats(now, timedata) {
	let days = 1
			+ Math.floor(now / 86400)
			- Math.floor(timedata[0] / 86400);
	let weeks = Math.floor((days + 6) / 7);
	return {
		startTime: new Date(timedata[0] * 1000).toLocaleString(),
		totalTime: formatTime(timedata[1]),
		perWeekTime: formatTime(timedata[1] / weeks),
		perDayTime: formatTime(timedata[1] / days)
	};
}

// Handle button click
//
function handleClick(e) {
	let id = e.target.id;

	if (id == "restartAll") {
		// Request restart time data for all sets
		let message = { type: "restart", set: 0 };
		browser.runtime.sendMessage(message, refreshPage);
	} else if (/restart\d+/.test(id)) {
		// Request restart time data for specific set
		let message = { type: "restart", set: +id.substr(7) };
		browser.runtime.sendMessage(message, refreshPage);
	}
}

/*** STARTUP CODE BEGINS HERE ***/

// Save original HTML of form
gFormHTML = $("#form").html();

window.addEventListener("DOMContentLoaded", refreshPage);
window.addEventListener("focus", refreshPage);
