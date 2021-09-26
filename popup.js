/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const browser = chrome;

// Initialize page
//
function initializePage() {
	browser.storage.local.get("sync", onGotSync);

	function onGotSync(options) {
		if (browser.runtime.lastError) {
			return;
		}

		if (options["sync"]) {
			browser.storage.sync.get("theme", onGot);
		} else {
			browser.storage.local.get("theme", onGot);
		}
	}

	function onGot(options) {
		if (browser.runtime.lastError) {
			return;
		}

		let theme = options["theme"];
		let link = document.getElementById("themeLink");
		if (link) {
			link.href = theme ? `/themes/${theme}.css` : "";
		}
	}
}

// Open options page
//
function openOptions() {
	browser.runtime.openOptionsPage();
	window.close();
}

// Open lockdown page
//
function openLockdown() {
	openExtensionPage("lockdown.html");
}

// Open override page
//
function openOverride() {
	openExtensionPage("override.html");
}

// Open stats page
//
function openStats() {
	openExtensionPage("stats.html");
}

// Open extension page (either create new tab or activate existing tab)
//
function openExtensionPage(url) {
	let fullURL = browser.runtime.getURL(url);

	browser.tabs.query({ url: fullURL }, onGot);

	function onGot(tabs) {
		if (tabs.length > 0) {
			browser.tabs.update(tabs[0].id, { active: true });
		} else {
			browser.tabs.create({ url: fullURL });
		}
		window.close();
	}
}

document.querySelector("#options").addEventListener("click", openOptions);
document.querySelector("#lockdown").addEventListener("click", openLockdown);
document.querySelector("#override").addEventListener("click", openOverride);
document.querySelector("#stats").addEventListener("click", openStats);

document.addEventListener("DOMContentLoaded", initializePage);
