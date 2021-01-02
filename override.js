/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const browser = chrome;

function log(message) { console.log("[LBNG] " + message); }
function warn(message) { console.warn("[LBNG] " + message); }

function getElement(id) { return document.getElementById(id); }

var gAccessConfirmed = false;
var gAccessRequiredInput;
var gClockOffset;
var gOverrideConfirm;
var gOverrideMins;

// Initialize page
//
function initializePage() {
	//log("initializePage");

	browser.storage.local.get("sync", onGotSync);

	function onGotSync(options) {
		if (browser.runtime.lastError) {
			warn("Cannot get options: " + browser.runtime.lastError.message);
			$("#alertRetrieveError").dialog("open");
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
			$("#alertRetrieveError").dialog("open");
			return;
		}

		cleanOptions(options);

		setTheme(options["theme"]);

		gClockOffset = options["clockOffset"];

		gOverrideConfirm = options["orc"];
		gOverrideMins = options["orm"];
	
		if (!gOverrideMins) {
			$("#alertNoOverride").dialog("open");
			return;
		}

		confirmAccess(options);
	}
}

// Close page
//
function closePage() {
	// Request tab close
	browser.runtime.sendMessage({ type: "close" });
}

// Confirm access to override
//
function confirmAccess(options) {
	let ora = options["ora"];
	let password = options["password"];
	let hpp = options["hpp"];

	if (ora == 1 && password) {
		gAccessRequiredInput = password;
		if (hpp) {
			$("#promptPasswordInput").attr("type", "password");
		} else {
			$("#promptPasswordInput").attr("type", "text");
		}
		$("#promptPasswordInput").val("");
		$("#promptPassword").dialog("open");
		$("#promptPasswordInput").focus();
	} else if (ora > 1) {
		let code = createAccessCode(32);
		if (ora > 2) {
			code += createAccessCode(32);
		}
		if (ora > 3) {
			code += createAccessCode(64);
		}
		gAccessRequiredInput = code;
		displayAccessCode(code, options["accessCodeImage"]);
		$("#promptAccessCodeInput").val("");
		$("#promptAccessCode").dialog("open");
		$("#promptAccessCodeInput").focus();
	} else {
		activateOverride();
	}
}

// Display access code (as text or image)
//
function displayAccessCode(code, asImage) {
	let codeText = getElement("promptAccessCodeText");
	let codeImage = getElement("promptAccessCodeImage");
	let codeCanvas = getElement("promptAccessCodeCanvas");

	if (asImage) {
		// Display code as image
		codeText.style.display = "none";
		codeImage.style.display = "";
		let ctx = codeCanvas.getContext("2d");
		ctx.font = "normal 14px monospace";
		codeCanvas.width = ctx.measureText(code.substring(0, 64)).width + 8;
		codeCanvas.height = (code.length == 128) ? 40 : 24;
		ctx.font = "normal 14px monospace"; // resizing canvas resets font!
		ctx.fillStyle = "#000";
		if (code.length == 128) {
			ctx.fillText(code.substring(0, 64), 4, 16);
			ctx.fillText(code.substring(64), 4, 32);
		} else {
			ctx.fillText(code, 4, 16);
		}
	} else {
		// Display code as text
		codeText.style.display = "";
		codeImage.style.display = "none";
		if (code.length == 128) {
			codeText.appendChild(document.createTextNode(code.substring(0, 64)));
			codeText.appendChild(document.createElement("br"));
			codeText.appendChild(document.createTextNode(code.substring(64)));
		} else {
			codeText.appendChild(document.createTextNode(code));
		}
	}
}

// Activate override
//
function activateOverride() {
	// Request override
	browser.runtime.sendMessage({ type: "override" });

	if (gOverrideConfirm) {
		// Calculate end time
		let endTime = new Date(Date.now() + (gClockOffset * 60000) + (gOverrideMins * 60000));

		// Show confirmation dialog
		$("#alertOverrideEndTime").html(endTime.toLocaleTimeString());
		$("#alertOverrideActivated").dialog("open");
	} else {
		// Close page immediately (no confirmation dialog)
		closePage();
	}
}

// Initialize access control prompt
//
function initAccessControlPrompt(prompt) {
	// Create functions for buttons
	let dialogButtons = {
		OK: function () {
			let input = $(`#${prompt}Input`);
			if (input.val() == gAccessRequiredInput) {
				gAccessConfirmed = true;
				activateOverride();
				$(`#${prompt}`).dialog("close");
			} else {
				input.val("");
				input.effect({ effect: "highlight", color: "#ff0000" });
				input.focus();
			}
		},
		Cancel: function () {
			$(`#${prompt}`).dialog("close");
		}
	};

	// Initialize prompt dialog
	$(`#${prompt}`).dialog({
		autoOpen: false,
		modal: true,
		width: 600,
		buttons: dialogButtons,
		close: function (event, ui) { if (!gAccessConfirmed) closePage(); }
	});

	// Connect ENTER key to OK button
	$(`#${prompt}Input`).keydown(
		function (event) {
			if (event.which == 13) {
				dialogButtons.OK();
			}
		}
	);
}

/*** STARTUP CODE BEGINS HERE ***/

// Initialize alert dialogs
$("div[id^='alert']").dialog({
	autoOpen: false,
	modal: true,
	width: 500,
	buttons: {
		OK: function () { $(this).dialog("close"); }
	},
	close: function (event, ui) { closePage(); }
});

// Initialize access control prompts
initAccessControlPrompt("promptPassword");
initAccessControlPrompt("promptAccessCode");

document.addEventListener("DOMContentLoaded", initializePage);
