/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const browser = chrome;

const TICK_TIME = 1000; // update every second

const BLOCKABLE_URL = /^(http|file|chrome|edge)/i;
const CLOCKABLE_URL = /^(http|file)/i;

function log(message) { console.log("[LBNG] " + message); }
function warn(message) { console.warn("[LBNG] " + message); }

var gStorage = browser.storage.local;
var gIsAndroid = false;
var gGotOptions = false;
var gOptions = {};
var gNumSets;
var gTabs = [];
var gSetCounted = [];
var gSavedTimeData = [];
var gRegExps = [];
var gFocusWindowId = 0;
var gOverrideIcon = false;
var gSaveSecsCount = 0;

// Create (precompile) regular expressions
//
function createRegExps() {
	// Create new RegExp objects
	for (let set = 1; set <= gNumSets; set++) {
		gRegExps[set] = {};

		let blockRE = gOptions[`regexpBlock${set}`] || gOptions[`blockRE${set}`];
		gRegExps[set].block = blockRE ? new RegExp(blockRE, "i") : null;

		let allowRE = gOptions[`regexpAllow${set}`] || gOptions[`allowRE${set}`];
		gRegExps[set].allow = allowRE ? new RegExp(allowRE, "i") : null;

		let keywordRE = gOptions[`keywordRE${set}`];
		gRegExps[set].keyword = keywordRE; // Chrome workaround
	}
}

// Test URL against block/allow regular expressions
//
function testURL(pageURL, blockRE, allowRE) {
	return (blockRE && blockRE.test(pageURL)
			&& !(allowRE && allowRE.test(pageURL)));
}

// Refresh menus
//
function refreshMenus() {
	if (!browser.contextMenus) {
		return; // no support for menus!
	}

	browser.contextMenus.removeAll();

	let context = gOptions["contextMenu"] ? "all" : "browser_action";

	// Options
	browser.contextMenus.create({
		id: "options",
		title: "Options",
		contexts: [context]
	});

	// Lockdown
	browser.contextMenus.create({
		id: "lockdown",
		title: "Lockdown",
		contexts: [context]
	});

	// Override
	browser.contextMenus.create({
		id: "override",
		title: "Override",
		contexts: [context]
	});

	// Statistics
	browser.contextMenus.create({
		id: "stats",
		title: "Statistics",
		contexts: [context]
	});

	browser.contextMenus.create({
		type: "separator",
		contexts: [context]
	});

	// Add Site
	browser.contextMenus.create({
		id: "addSite",
		title: "Add Site",
		contexts: [context]
	});

	// Add Site submenu
	for (let set = 1; set <= gNumSets; set++) {
		let title = `Add Site to Block Set ${set}`;
		let setName = gOptions[`setName${set}`];
		if (setName) {
			title += ` (${setName})`;
		}
		browser.contextMenus.create({
			id: `addSite-${set}`,
			parentId: "addSite",
			title: title,
			contexts: [context]
		});
	}
}

// Retrieve options from storage
//
function retrieveOptions(update) {
	//log("retrieveOptions: " + update);

	browser.storage.local.get("sync", onGotSync);

	function onGotSync(options) {
		if (browser.runtime.lastError) {
			gGotOptions = false;
			warn("Cannot get options: " + browser.runtime.lastError.message);
			return;
		}

		gStorage = options["sync"]
				? browser.storage.sync
				: browser.storage.local;

		gStorage.get(onGot);
	}

	function onGot(options) {
		if (browser.runtime.lastError) {
			gGotOptions = false;
			warn("Cannot get options: " + browser.runtime.lastError.message);
			return;
		}

		// Copy retrieved options (exclude timedata if update)
		for (let option in options) {
			if (!update || !/^timedata/.test(option)) {
				gOptions[option] = options[option];
			}
		}
		gGotOptions = true;

		cleanOptions(gOptions);
		cleanTimeData(gOptions);

		gNumSets = +gOptions["numSets"];

		createRegExps();
		refreshMenus();
		loadSiteLists();
		updateIcon();

		// Keep track of saved time data to avoid unnecessary writes
		for (let set = 1; set <= gNumSets; set++) {
			gSavedTimeData[set] = gOptions[`timedata${set}`].toString();
		}
	}
}

// Load lists of sites if URLs specified
//
function loadSiteLists() {
	//log("loadSiteLists");

	let time = Date.now();

	for (let set = 1; set <= gNumSets; set++) {
		// Get sites for block set from HTTP source (if specified)
		let sitesURL = gOptions[`sitesURL${set}`];
		if (sitesURL) {
			sitesURL = sitesURL.replace(/\$S/, set).replace(/\$T/, time);
			try {
				let req = new XMLHttpRequest();
				req.set = set;
				req.open("GET", sitesURL, true);
				req.overrideMimeType("text/plain");
				req.onload = onLoad;
				req.send();
			} catch (error) {
				warn("Cannot load sites from URL: " + sitesURL);
			}
		}
	}

	function onLoad(event) {
		let req = event.target;
		if (req.readyState == XMLHttpRequest.DONE && req.status == 200) {
			let set = req.set;
			let sites = req.responseText;
			sites = sites.replace(/\s+/g, " ").replace(/(^ +)|( +$)|(\w+:\/+)/g, "");
			sites = sites.split(" ").sort().join(" "); // sort alphabetically

			// Get regular expressions to match sites
			let regexps = getRegExpSites(sites, gOptions["matchSubdomains"]);

			// Update options
			gOptions[`sites${set}`] = sites;
			gOptions[`blockRE${set}`] = regexps.block;
			gOptions[`allowRE${set}`] = regexps.allow;
			gOptions[`keywordRE${set}`] = regexps.keyword;

			createRegExps();

			// Save updated options to local storage
			let options = {};
			options[`sites${set}`] = sites;
			options[`blockRE${set}`] = regexps.block;
			options[`allowRE${set}`] = regexps.allow;
			options[`keywordRE${set}`] = regexps.keyword;
			gStorage.set(options, function () {
				if (browser.runtime.lastError) {
					warn("Cannot set options: " + browser.runtime.lastError.message);
				}
			});
		}
	}
}

// Save time data to storage
//
function saveTimeData() {
	//log("saveTimeData");

	if (!gGotOptions) {
		return;
	}

	let options = {};
	let touched = false;
	for (let set = 1; set <= gNumSets; set++) {
		let timedata = gOptions[`timedata${set}`];
		if (gSavedTimeData[set] != timedata.toString()) {
			options[`timedata${set}`] = timedata;
			gSavedTimeData[set] = timedata.toString();
			touched = true;
		}
	}
	if (touched) {
		gStorage.set(options, function () {
			if (browser.runtime.lastError) {
				warn("Cannot save time data: " + browser.runtime.lastError.message);
			}
		});
	}
}

// Restart time data
//
function restartTimeData(set) {
	//log("restartTimeData: " + set);

	if (!gGotOptions || set < 1 || set > gNumSets) {
		return;
	}

	// Get current time in seconds
	let now = Math.floor(Date.now() / 1000);

	if (!set) {
		for (set = 1; set <= gNumSets; set++) {
			gOptions[`timedata${set}`][0] = now;
			gOptions[`timedata${set}`][1] = 0;
		}
	} else {
		gOptions[`timedata${set}`][0] = now;
		gOptions[`timedata${set}`][1] = 0;
	}

	saveTimeData();
}

// Update ID of focused window
//
function updateFocusedWindowId() {
	if (!browser.windows) {
		return; // no support for windows!
	}

	browser.windows.getCurrent(
		function (win) {
			if (browser.runtime.lastError) {
				warn("Cannot get current window: " + browser.runtime.lastError.message);
			} else {
				gFocusWindowId = win.focused ? win.id : browser.windows.WINDOW_ID_NONE;
			}
		}
	);
}

// Process tabs: update time spent and check for blocks
// 
function processTabs(active) {
	//log("processTabs: " + active);

	gSetCounted = []; // reset

	if (active) {
		// Process only active tabs
		browser.tabs.query({ active: true }, onGot);
	} else {
		// Process all tabs
		browser.tabs.query({}, onGot);
	}

	function onGot(tabs) {
		if (browser.runtime.lastError) {
			warn("Cannot get tabs: " + error);
			return;
		}

		for (let tab of tabs) {
			let focus = tab.active && (!gFocusWindowId || tab.windowId == gFocusWindowId);

			// Force update of time spent on this page
			clockPageTime(tab.id, false, false);
			clockPageTime(tab.id, true, focus);

			let blocked = checkTab(tab.id, tab.url, true);

			if (!blocked && tab.active) {
				updateTimer(tab.id);
			}
		}
	}
}

// Check the URL of a tab and applies block if necessary (returns true if blocked)
//
function checkTab(id, url, isRepeat) {
	//log("checkTab: " + id + " " + url + " " + isRepeat);

	function isSameHost(host1, host2) {
		return (host1 == host2)
				|| (host1 == "www." + host2)
				|| (host2 == "www." + host1);
	}

	// Remove view-source prefix if necessary
	url = url.replace(/^view-source:/i, "");

	if (!gTabs[id]) {
		// Create object to track this tab
		gTabs[id] = { allowedHost: null, allowedPath: null, filtered: false };
	}

	gTabs[id].blockable = BLOCKABLE_URL.test(url);
	gTabs[id].clockable = CLOCKABLE_URL.test(url);
	gTabs[id].url = url;

	// Quick exit for about:blank and extension pages
	if (url == "about:blank" || /^(chrome-)?extension/i.test(url)) {
		return false; // not blocked
	}

	// Quick exit for LeechBlock website (documentation should be always available)
	if (url.startsWith(LEECHBLOCK_URL)) {
		return false; // not blocked
	}

	// Quick exit for non-blockable URLs
	if (!gTabs[id].blockable) {
		return false; // not blocked
	}

	// Get parsed URL for this page
	let parsedURL = getParsedURL(url);

	// Check for allowed host/path
	let ah = isSameHost(gTabs[id].allowedHost, parsedURL.host);
	let ap = !gTabs[id].allowedPath || (gTabs[id].allowedPath == parsedURL.path);
	if (ah && ap) {
		return false; // not blocked
	} else {
		gTabs[id].allowedHost = null;
		gTabs[id].allowedPath = null;
	}

	// Get current time/date
	let timedate = new Date();

	// Get current time in seconds
	let now = Math.floor(Date.now() / 1000);

	// Get override end time
	let overrideEndTime = gOptions["oret"];

	gTabs[id].secsLeft = Infinity;

	for (let set = 1; set <= gNumSets; set++) {
		// Get URL of page (possibly with hash part)
		let pageURL = parsedURL.page;
		let pageURLWithHash = parsedURL.page;
		if (parsedURL.hash != null) {
			pageURLWithHash +=  "#" + parsedURL.hash;
			if (/^!/.test(parsedURL.hash) || !gOptions[`ignoreHash${set}`]) {
				pageURL = pageURLWithHash;
			}
		}

		// Get regular expressions for matching sites to block/allow
		let blockRE = gRegExps[set].block;
		if (!blockRE) continue; // no block for this set
		let allowRE = gRegExps[set].allow;
		let keywordRE = gRegExps[set].keyword;

		// Get options for preventing access to extensions/settings pages
		let prevExts = gOptions[`prevExts${set}`];
		let prevSettings = gOptions[`prevSettings${set}`];

		// Test URL against block/allow regular expressions
		if (testURL(pageURL, blockRE, allowRE)
				|| (prevExts && /^[a-z]+:\/\/extensions/i.test(pageURL))
				|| (prevSettings && /^[a-z]+:\/\/settings/i.test(pageURL))) {
			// Get options for this set
			let timedata = gOptions[`timedata${set}`];
			let times = gOptions[`times${set}`];
			let minPeriods = getMinPeriods(times);
			let limitMins = gOptions[`limitMins${set}`];
			let limitPeriod = gOptions[`limitPeriod${set}`];
			let limitOffset = gOptions[`limitOffset${set}`];
			let periodStart = getTimePeriodStart(now, limitPeriod, limitOffset);
			let conjMode = gOptions[`conjMode${set}`];
			let days = gOptions[`days${set}`];
			let blockURL = gOptions[`blockURL${set}`];
			let applyFilter = gOptions[`applyFilter${set}`];
			let filterName = gOptions[`filterName${set}`];
			let activeBlock = gOptions[`activeBlock${set}`];
			let allowOverride = gOptions[`allowOverride${set}`];
			let showTimer = gOptions[`showTimer${set}`];

			// Check day
			let onSelectedDay = days[timedate.getDay()];

			// Check time periods
			let secsLeftBeforePeriod = Infinity;
			if (onSelectedDay && times) {
				// Get number of minutes elapsed since midnight
				let mins = timedate.getHours() * 60 + timedate.getMinutes();

				// Check each time period in turn
				for (let mp of minPeriods) {
					if (mins >= mp.start && mins < mp.end) {
						secsLeftBeforePeriod = 0;
					} else if (mins < mp.start) {
						// Compute exact seconds before this time period starts
						let secs = (mp.start - mins) * 60 - timedate.getSeconds();
						if (secs < secsLeftBeforePeriod) {
							secsLeftBeforePeriod = secs;
						}
					}
				}
			}

			// Check time limit
			let secsLeftBeforeLimit = Infinity;
			if (onSelectedDay && limitMins && limitPeriod) {
				// Compute exact seconds before this time limit expires
				secsLeftBeforeLimit = limitMins * 60;
				if (timedata[2] == periodStart) {
					let secs = secsLeftBeforeLimit - timedata[3];
					secsLeftBeforeLimit = Math.max(0, secs);
				}
			}

			let withinTimePeriods = (secsLeftBeforePeriod == 0);
			let afterTimeLimit = (secsLeftBeforeLimit == 0);

			// Check lockdown condition
			let lockdown = (timedata[4] > now);

			// Check override condition
			let override = (overrideEndTime > now) && allowOverride;

			// Determine whether this page should now be blocked
			let doBlock = lockdown
					|| (!conjMode && (withinTimePeriods || afterTimeLimit))
					|| (conjMode && (withinTimePeriods && afterTimeLimit));

			// Apply block if all relevant block conditions are fulfilled
			if (!override && doBlock && (!isRepeat || activeBlock)) {
				// Get final URL for block page
				blockURL = blockURL.replace(/\$S/g, set).replace(/\$U/g, pageURLWithHash);

				if (keywordRE) {
					// Check for keyword(s) before blocking
					let message = {
						type: "keyword",
						keywordRE: keywordRE
					};
					browser.tabs.sendMessage(id, message,
						function (keyword) {
							if (keyword) {
								if (applyFilter) {
									gTabs[id].filtered = true;

									// Send message to tab
									let message = {
										type: "filter",
										name: filterName
									};
									browser.tabs.sendMessage(id, message);
								} else {
									// Redirect page
									browser.tabs.update(id, { url: blockURL });
								}
							}
						}
					);
				} else if (applyFilter) {
					gTabs[id].filtered = true;

					// Send message to tab
					let message = {
						type: "filter",
						name: filterName
					};
					browser.tabs.sendMessage(id, message);
				} else {
					// Redirect page
					browser.tabs.update(id, { url: blockURL });

					return true; // blocked
				}
			}

			// Clear filter if no longer blocked
			if (gTabs[id].filtered && (override || !doBlock)) {
				gTabs[id].filtered = false;

				// Send message to tab
				let message = {
					type: "filter",
					name: null
				};
				browser.tabs.sendMessage(id, message);
			}

			// Update seconds left before block
			let secsLeft = conjMode
					? (secsLeftBeforePeriod + secsLeftBeforeLimit)
					: Math.min(secsLeftBeforePeriod, secsLeftBeforeLimit);
			if (override) {
				secsLeft = Math.max(secsLeft, overrideEndTime - now);
			}
			if (showTimer && secsLeft < gTabs[id].secsLeft) {
				gTabs[id].secsLeft = secsLeft;
				gTabs[id].secsLeftSet = set;
			}
		}
	}

	checkWarning(id);

	return false; // not blocked
}

// Check for warning message (and display message if needed)
//
function checkWarning(id) {
	let set = gTabs[id].secsLeftSet;
	let warnSecs = gOptions["warnSecs"];
	let canWarn = !gOptions["warnImmediate"] || gOptions[`activeBlock${set}`]

	if (warnSecs && canWarn) {
		let secsLeft = Math.round(gTabs[id].secsLeft);
		if (secsLeft > warnSecs) {
			gTabs[id].warned = false;
		} else if (secsLeft > 0 && !gTabs[id].warned) {
			gTabs[id].warned = true;

			// Send message to tab
			let text = `Sites in Block Set ${set}`;
			let setName = gOptions[`setName${set}`];
			if (setName) {
				text += ` (${setName})`;
			}
			text += ` will be blocked in ${secsLeft} seconds.`;
			let message = {
				type: "alert",
				text: text
			};
			browser.tabs.sendMessage(id, message, function () {
				if (browser.runtime.lastError) {
					gTabs[id].warned = false;
				}
			});
		}
	}
}

// Clock time spent on page
//
function clockPageTime(id, open, focus) {
	if (!gTabs[id] || !gTabs[id].clockable) {
		return;
	}

	// Get current time in milliseconds
	let time = Date.now();

	// Clock time during which page has been open
	let secsOpen = 0;
	if (open) {
		if (gTabs[id].openTime == undefined) {
			// Set open time for this page
			gTabs[id].openTime = time;
		}
	} else {
		if (gTabs[id].openTime != undefined) {
			// Calculate seconds spent on this page (while open)
			secsOpen = ((time - gTabs[id].openTime) / 1000);

			gTabs[id].openTime = undefined;
		}
	}

	// Clock time during which page has been focused
	let secsFocus = 0;
	if (focus) {
		if (gTabs[id].focusTime == undefined) {
			// Set focus time for this page
			gTabs[id].focusTime = time;
		}
	} else {
		if (gTabs[id].focusTime != undefined) {
			// Calculate seconds spent on this page (while focused)
			secsFocus = ((time - gTabs[id].focusTime) / 1000);

			gTabs[id].focusTime = undefined;
		}
	}

	// Update time data if necessary
	if (secsOpen > 0 || secsFocus > 0) {
		updateTimeData(gTabs[id].url, secsOpen, secsFocus);
	}
}

// Update time data for specified page
//
function updateTimeData(url, secsOpen, secsFocus) {
	//log("updateTimeData: " + url + " " + secsOpen + " " + secsFocus);

	// Get parsed URL for this page
	let parsedURL = getParsedURL(url);
	let pageURL = parsedURL.page;

	// Get current time/date
	let timedate = new Date();

	// Get current time in seconds
	let now = Math.floor(Date.now() / 1000);

	for (let set = 1; set <= gNumSets; set++) {
		// Get regular expressions for matching sites to block/allow
		let blockRE = gRegExps[set].block;
		if (!blockRE) continue; // no block for this set
		let allowRE = gRegExps[set].allow;

		// Test URL against block/allow regular expressions
		if (testURL(pageURL, blockRE, allowRE)) {
			// Get options for this set
			let timedata = gOptions[`timedata${set}`];
			let countFocus = gOptions[`countFocus${set}`];
			let times = gOptions[`times${set}`];
			let minPeriods = getMinPeriods(times);
			let limitPeriod = gOptions[`limitPeriod${set}`];
			let limitOffset = gOptions[`limitOffset${set}`];
			let periodStart = getTimePeriodStart(now, limitPeriod, limitOffset);
			let conjMode = gOptions[`conjMode${set}`];
			let days = gOptions[`days${set}`];

			// Avoid overcounting time for non-focused tabs
			if (!countFocus && gSetCounted[set]) {
				continue;
			} else {
				gSetCounted[set] = true;
			}

			// Reset time data if currently invalid
			if (!Array.isArray(timedata) || timedata.length != 5) {
				timedata = [now, 0, 0, 0, 0];
			}

			// Get number of seconds spent on page (focused or open)
			let secsSpent = countFocus ? secsFocus : secsOpen;

			// Update data for total time spent
			timedata[1] = +timedata[1] + secsSpent;

			// Determine whether we should count time spent on page in
			// specified time period (we should only count time on selected
			// days -- and in conjunction mode, only within time periods)
			let countTimeSpentInPeriod = days[timedate.getDay()];
			if (countTimeSpentInPeriod && conjMode) {
				countTimeSpentInPeriod = false;

				// Get number of minutes elapsed since midnight
				let mins = timedate.getHours() * 60 + timedate.getMinutes();

				// Check each time period in turn
				for (let mp of minPeriods) {
					if (mins >= mp.start && mins < mp.end) {
						countTimeSpentInPeriod = true;
					}
				}
			}

			// Update data for time spent in specified time period
			if (countTimeSpentInPeriod && periodStart > 0 && timedata[2] >= 0) {
				if (timedata[2] != periodStart) {
					// We've entered a new time period, so start new count
					timedata[2] = periodStart;
					timedata[3] = secsSpent;
				} else {
					// We haven't entered a new time period, so keep counting
					timedata[3] = +timedata[3] + secsSpent;
				}
			}

			// Update time data for this set
			gOptions[`timedata${set}`] = timedata;
		}
	}
}

// Update timer
//
function updateTimer(id) {
	if (!gTabs[id] || !gTabs[id].clockable) {
		return;
	}

	// Send message to tab
	let secsLeft = gTabs[id].secsLeft;
	let message = {
		type: "timer",
		size: gOptions["timerSize"],
		location: gOptions["timerLocation"]
	};
	if (!gOptions["timerVisible"] || secsLeft == undefined || secsLeft == Infinity) {
		message.text = null; // hide timer
	} else {
		message.text = formatTime(secsLeft); // show timer with time left
	}
	browser.tabs.sendMessage(id, message);

	// Set tooltip
	if (!gIsAndroid) {
		if (secsLeft == undefined || secsLeft == Infinity) {
			browser.browserAction.setTitle({ title: "LeechBlock", tabId: id });
		} else {
			let title = "LeechBlock [" + formatTime(secsLeft) + "]"
			browser.browserAction.setTitle({ title: title, tabId: id });
		}
	}

	// Set badge timer (if option selected)
	if (!gIsAndroid && gOptions["timerBadge"] && secsLeft < 600) {
		let m = Math.floor(secsLeft / 60);
		let s = Math.floor(secsLeft) % 60;
		let text = m + ":" + ((s < 10) ? "0" + s : s);
		browser.browserAction.setBadgeBackgroundColor({ color: "#666" });
		browser.browserAction.setBadgeText({ text: text, tabId: id });
	} else {
		browser.browserAction.setBadgeText({ text: "", tabId: id });
	}
}

// Update button icon
//
function updateIcon() {
	if (gIsAndroid) {
		return; // icon not supported yet
	}

	// Get current time in seconds
	let now = Math.floor(Date.now() / 1000);

	// Get override end time
	let overrideEndTime = gOptions["oret"];

	// Change icon only if override status has changed
	if (!gOverrideIcon && overrideEndTime > now) {
		browser.browserAction.setIcon({ path: OVERRIDE_ICON });
		gOverrideIcon = true;
	} else if (gOverrideIcon && overrideEndTime <= now) {
		browser.browserAction.setIcon({ path: DEFAULT_ICON });
		gOverrideIcon = false;
	}
}

// Create info for blocking/delaying page
//
function createBlockInfo(url) {
	// Get theme
	let theme = gOptions["theme"];

	// Get parsed URL
	let parsedURL = getParsedURL(url);
	let pageURL = parsedURL.page;

	if (parsedURL.args == null || parsedURL.args.length < 2) {
		warn("Cannot create block info: not enough arguments in URL.");
		return { theme: theme };
	}

	// Get block set and URL (including hash part) of blocked page
	let blockedSet = parsedURL.args.shift();
	let blockedSetName = gOptions[`setName${blockedSet}`];
	let blockedURL = parsedURL.query.substring(blockedSet.length + 2); // retains original separators (& or ;)
	if (parsedURL.hash != null) {
		blockedURL += "#" + parsedURL.hash;
	}

	// Get unblock time for block set
	let unblockTime = getUnblockTime(blockedSet);
	if (unblockTime != null) {
		// Convert to string
		if (unblockTime.getDate() == new Date().getDate()) {
			// Same day: show time only
			unblockTime = unblockTime.toLocaleTimeString();
		} else {
			// Different day: show date and time
			unblockTime = unblockTime.toLocaleString();
		}
	}

	// Get delaying time for block set
	let delaySecs = gOptions[`delaySecs${blockedSet}`];

	// Get reloading time (if specified)
	let reloadSecs = gOptions[`reloadSecs${blockedSet}`];

	return {
		theme: theme,
		blockedSet: blockedSet,
		blockedSetName: blockedSetName,
		blockedURL: blockedURL,
		unblockTime: unblockTime,
		delaySecs: delaySecs,
		reloadSecs: reloadSecs
	};
}

// Return time when blocked sites will be unblocked (as Date object)
//
function getUnblockTime(set) {
	//log("getUnlockTime: " + set);

	if (!gGotOptions || set < 1 || set > gNumSets) {
		return null;
	}

	// Get current time/date
	let timedate = new Date();
	
	// Get current time in seconds
	let now = Math.floor(Date.now() / 1000);

	// Get options for this set
	let timedata = gOptions[`timedata${set}`];
	let times = gOptions[`times${set}`];
	let minPeriods = getMinPeriods(times);
	let limitMins = gOptions[`limitMins${set}`];
	let limitPeriod = gOptions[`limitPeriod${set}`];
	let limitOffset = gOptions[`limitOffset${set}`];
	let periodStart = getTimePeriodStart(now, limitPeriod, limitOffset);
	let conjMode = gOptions[`conjMode${set}`];
	let days = gOptions[`days${set}`];

	// Check for valid time data
	if (!Array.isArray(timedata) || timedata.length != 5) {
		return null;
	}

	// Check for 24/7 block
	if (times == ALL_DAY_TIMES && allTrue(days) && !conjMode) {
		return null;
	}

	// Check for lockdown
	if (now < timedata[4]) {
		// Return end time for lockdown
		return new Date(timedata[4] * 1000);
	}
	
	// Get number of minutes elapsed since midnight
	let mins = timedate.getHours() * 60 + timedate.getMinutes();

	// Create list of time periods for today and following seven days
	let day = timedate.getDay();
	let allMinPeriods = [];
	for (let i = 0; i <= 7; i++) {
		if (days[(day + i) % 7]) {
			let offset = (i * 1440);
			for (let mp of minPeriods) {
				// Create new time period with offset
				let mp1 = {
					start: (mp.start + offset),
					end: (mp.end + offset)
				};
				if (allMinPeriods.length == 0) {
					// Add new time period
					allMinPeriods.push(mp1);
				} else {
					let mp0 = allMinPeriods[allMinPeriods.length - 1];
					if (mp1.start <= mp0.end) {
						// Merge time period into previous one
						mp0.end = mp1.end;
					} else {
						// Add new time period
						allMinPeriods.push(mp1);
					}
				}
			}
		}
	}

	let timePeriods = (times != "");
	let timeLimit = (limitMins && limitPeriod);

	if (timePeriods && !timeLimit) {
		// Case 1: within time periods (no time limit)

		// Find relevant time period
		for (let mp of allMinPeriods) {
			if (mins >= mp.start && mins < mp.end) {
				// Return end time for time period
				return new Date(
						timedate.getFullYear(),
						timedate.getMonth(),
						timedate.getDate(),
						0, mp.end);
			}
		}
	} else if (!timePeriods && timeLimit) {
		// Case 2: after time limit (no time periods)

		// Return end time for current time limit period
		return new Date(timedata[2] * 1000 + limitPeriod * 1000);
	} else if (timePeriods && timeLimit) {
		if (conjMode) {
			// Case 3: within time periods AND after time limit

			// Find relevant time period
			for (let mp of allMinPeriods) {
				if (mins >= mp.start && mins < mp.end) {
					// Return the earlier of the two end times
					let td1 = new Date(
							timedate.getFullYear(),
							timedate.getMonth(),
							timedate.getDate(),
							0, mp.end);
					let td2 = new Date(timedata[2] * 1000 + limitPeriod * 1000);
					return (td1 < td2) ? td1 : td2;
				}
			}
		} else {
			// Case 4: within time periods OR after time limit

			// Determine whether time limit was exceeded
			let afterTimeLimit = (timedata[2] == periodStart)
					&& (timedata[3] >= (limitMins * 60));

			if (afterTimeLimit) {
				// Check against end time for current time limit period instead
				let td = new Date(timedata[2] * 1000 + limitPeriod * 1000);
				mins = td.getHours() * 60 + td.getMinutes();
			}

			// Find relevant time period
			for (let mp of allMinPeriods) {
				if (mins >= mp.start && mins < mp.end) {
					// Return end time for time period
					return new Date(
							timedate.getFullYear(),
							timedate.getMonth(),
							timedate.getDate(),
							0, mp.end);
				}
			}
		}
	}

	return null;
}

// Apply lockdown for specified set
//
function applyLockdown(set, endTime) {
	//log("applyLockdown: " + set + " " + endTime);

	if (!gGotOptions || set < 1 || set > gNumSets) {
		return;
	}

	// Apply lockdown only if it doesn't reduce any current lockdown
	if (endTime > gOptions[`timedata${set}`][4]) {
		gOptions[`timedata${set}`][4] = endTime;
	}

	saveTimeData();
}

// Cancel lockdown for specified set
//
function cancelLockdown(set) {
	//log("cancelLockdown: " + set);

	if (!gGotOptions || set < 1 || set > gNumSets) {
		return;
	}

	gOptions[`timedata${set}`][4] = 0;

	saveTimeData();
}

// Apply override
//
function applyOverride() {
	//log("applyOverride");

	if (!gGotOptions) {
		return;
	}

	let overrideMins = gOptions["orm"];
	if (overrideMins) {
		// Calculate end time
		let overrideEndTime = Math.floor(Date.now() / 1000) + (overrideMins * 60);

		// Update option
		gOptions["oret"] = overrideEndTime;

		// Save updated option to local storage
		let options = {};
		options["oret"] = overrideEndTime;
		gStorage.set(options, function () {
			if (browser.runtime.lastError) {
				warn("Cannot set options: " + browser.runtime.lastError.message);
			}
		});

		updateIcon();
	}
}

// Open extension page (either create new tab or activate existing tab)
//
function openExtensionPage(url) {
	let fullURL = browser.extension.getURL(url);

	browser.tabs.query({ url: fullURL }, onGot);

	function onGot(tabs) {
		if (tabs.length > 0) {
			browser.tabs.update(tabs[0].id, { active: true });
		} else {
			browser.tabs.create({ url: fullURL });
		}
	}
}

// Open page blocked by delaying page
//
function openDelayedPage(id, url, set) {
	//log("openDelayedPage: " + id + " " + url);

	if (!gGotOptions || set < 1 || set > gNumSets) {
		return;
	}

	// Get parsed URL for this page
	let parsedURL = getParsedURL(url);

	// Set parameters for allowing host
	gTabs[id].allowedHost = parsedURL.host;
	if (!gOptions[`delayFirst${set}`]) {
		gTabs[id].allowedPath = parsedURL.path;
	}

	// Redirect page
	browser.tabs.update(id, { url: url });
}

// Add site to block set
//
function addSiteToSet(url, set) {
	//log("addSiteToSet: " + url + " " + set);

	if (!url) {
		browser.tabs.query(
			{ active: true, currentWindow: true },
			function (tabs) { 
				if (tabs[0].url) {
					addSiteToSet(tabs[0].url, set);
				}
			}
		);
		return;
	}

	if (!gGotOptions || set < 1 || set > gNumSets || !/^http/i.test(url)) {
		return;
	}

	// Get parsed URL for this page
	let parsedURL = getParsedURL(url);

	// Get sites for this set
	let sites = gOptions[`sites${set}`];

	// Add site if not already included
	let site = parsedURL.host.replace(/^www\./, "");
	let patterns = sites.split(/\s+/);
	if (patterns.indexOf(site) < 0) {
		// Get sorted list of sites including new one
		patterns.push(site);
		sites = patterns.sort().join(" ").replace(/(^ +)|( +$)/g, "");

		// Get regular expressions to match sites
		let regexps = getRegExpSites(sites, gOptions["matchSubdomains"]);

		// Update options
		gOptions[`sites${set}`] = sites;
		gOptions[`blockRE${set}`] = regexps.block;
		gOptions[`allowRE${set}`] = regexps.allow;
		gOptions[`keywordRE${set}`] = regexps.keyword;

		createRegExps();

		// Save updated options to local storage
		let options = {};
		options[`sites${set}`] = sites;
		options[`blockRE${set}`] = regexps.block;
		options[`allowRE${set}`] = regexps.allow;
		options[`keywordRE${set}`] = regexps.keyword;
		gStorage.set(options, function () {
			if (browser.runtime.lastError) {
				warn("Cannot set options: " + browser.runtime.lastError.message);
			}
		});
	}	
}

/*** EVENT HANDLERS BEGIN HERE ***/

function handleMenuClick(info, tab) {
	let id = info.menuItemId;
	if (id == "options") {
		browser.runtime.openOptionsPage();
	} else if (id == "lockdown") {
		openExtensionPage("lockdown.html");
	} else if (id == "override") {
		openExtensionPage("override.html");
	} else if (id == "stats") {
		openExtensionPage("stats.html");
	} else if (id.startsWith("addSite-")) {
		addSiteToSet(info.pageUrl, id.substr(8));
	}
}

function handleMessage(message, sender, sendResponse) {
	if (!sender) {
		warn("No sender!");
		return;
	}

	//log("handleMessage: " + sender.tab.id + " " + message.type);

	if (message.type == "close") {
		// Close tab requested
		browser.tabs.remove(sender.tab.id);
	} else if (message.type == "options") {
		// Options updated
		retrieveOptions(true);
	} else if (message.type == "lockdown") {
		if (!message.endTime) {
			// Lockdown canceled
			cancelLockdown(message.set);
		} else {
			// Lockdown requested
			applyLockdown(message.set, message.endTime);
		}
	} else if (message.type == "override") {
		// Override requested
		applyOverride();
	} else if (message.type == "restart") {
		// Restart time data requested by statistics page
		restartTimeData(message.set);
		sendResponse();
	} else if (message.type == "blocked") {
		// Block info requested by blocking/delaying page
		let info = createBlockInfo(sender.url);
		sendResponse(info);
	} else if (message.type == "delayed") {
		// Redirect requested by delaying page
		openDelayedPage(sender.tab.id, message.blockedURL, message.blockedSet);
	}
}

function handleTabCreated(tab) {
	//log("handleTabCreated: " + tab.id);

	if (!gTabs[tab.id]) {
		// Create object to track this tab
		gTabs[tab.id] = { allowedHost: null, allowedPath: null };

		if (tab.openerTabId) {
			// Inherit properties from opener tab
			gTabs[tab.id].allowedHost = gTabs[tab.openerTabId].allowedHost;
			gTabs[tab.id].allowedPath = gTabs[tab.openerTabId].allowedPath;
		}
	}
}

function handleTabUpdated(tabId, changeInfo, tab) {
	//log("handleTabUpdated: " + tabId);

	if (!gGotOptions) {
		return;
	}

	let focus = tab.active && (!gFocusWindowId || tab.windowId == gFocusWindowId);

	if (changeInfo.status && changeInfo.status == "complete") {
		clockPageTime(tab.id, true, focus);

		let blocked = checkTab(tab.id, tab.url, false);

		if (!blocked && tab.active) {
			updateTimer(tab.id);
		}
	}
}

function handleTabActivated(activeInfo) {
	//log("handleTabActivated: " + activeInfo.tabId);

	if (!gGotOptions) {
		return;
	}

	if (gOptions["processActiveTabs"]) {
		// Process all tabs to ensure time counted correctly
		processTabs(false);
		return;
	}

	let focus = (!gFocusWindowId || activeInfo.windowId == gFocusWindowId);

	clockPageTime(activeInfo.tabId, true, focus);
	updateTimer(activeInfo.tabId);
}

function handleTabRemoved(tabId, removeInfo) {
	//log("handleTabRemoved: " + tabId);

	if (!gGotOptions) {
		return;
	}

	clockPageTime(tabId, false, false);
}

function handleBeforeNavigate(navDetails) {
	//log("handleBeforeNavigate: " + navDetails.tabId);

	if (!gGotOptions) {
		return;
	}

	clockPageTime(navDetails.tabId, false, false);

	if (navDetails.frameId == 0) {
		checkTab(navDetails.tabId, navDetails.url, false);
	}
}

function handleWinFocused(winId) {
	//log("handleWinFocused: " + winId);

	gFocusWindowId = winId;
}

function onInterval() {
	//log("onInterval");

	updateFocusedWindowId();

	if (!gGotOptions) {
		retrieveOptions();
	} else {
		processTabs(gOptions["processActiveTabs"]);
		updateIcon();

		if (++gSaveSecsCount >= gOptions["saveSecs"]) {
			saveTimeData();
			gSaveSecsCount = 0;
		}
	}
}

/*** STARTUP CODE BEGINS HERE ***/

browser.runtime.getPlatformInfo(
	function (info) { gIsAndroid = (info.os == "android"); }
);

if (browser.contextMenus) {
	browser.contextMenus.onClicked.addListener(handleMenuClick);
}

browser.runtime.onMessage.addListener(handleMessage);

browser.tabs.onCreated.addListener(handleTabCreated);
browser.tabs.onUpdated.addListener(handleTabUpdated);
browser.tabs.onActivated.addListener(handleTabActivated);
browser.tabs.onRemoved.addListener(handleTabRemoved);

browser.webNavigation.onBeforeNavigate.addListener(handleBeforeNavigate);

if (browser.windows) {
	//browser.windows.onFocusChanged.addListener(handleWinFocused);
}

window.setInterval(onInterval, TICK_TIME);
