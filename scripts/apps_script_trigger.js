/**
 * FuckLike Persona Batch Trigger
 *
 * Google Apps Script — paste this into script.google.com, attach to your
 * persona spec sheet, and set a time-based trigger (e.g. every 10 minutes).
 *
 * Sheet columns (row 1 = headers):
 *   A: name          (persona slug, e.g. "riley")
 *   B: body_type     (e.g. "slim hourglass")
 *   C: skin_tone     (e.g. "light tan")
 *   D: outfit        (e.g. "white crop top, denim shorts")
 *   E: background    (e.g. "cozy bedroom, white sheets")
 *   F: count         (number of images, default 4)
 *   G: seed          (base seed, default 42)
 *   H: explicit_level (0-3, default 2)
 *   I: status        (leave blank — script writes "done" / "error" here)
 *   J: generated_at  (script writes timestamp)
 *   K: drive_folder_url (script writes the Drive link)
 */

var COLAB_URL = "";          // paste ngrok URL from Colab here each session
var SHEET_NAME = "Personas"; // name of the tab in your Sheet
var BATCH_SIZE = 5;          // how many personas to process per run

function runBatch() {
  if (!COLAB_URL) {
    Logger.log("COLAB_URL not set — paste your ngrok URL");
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    Logger.log("Sheet '" + SHEET_NAME + "' not found");
    return;
  }

  var data = sheet.getDataRange().getValues();
  var processed = 0;

  for (var i = 1; i < data.length && processed < BATCH_SIZE; i++) {
    var row = data[i];
    var status = row[8]; // column I

    if (status === "done" || status === "error" || status === "skip") continue;

    var name = String(row[0]).trim();
    if (!name) continue;

    var spec = {
      name: name,
      body_type: row[1] || "slim hourglass",
      skin_tone: row[2] || "fair",
      outfit: row[3] || "matching lace lingerie set",
      background: row[4] || "cozy bedroom, unmade white sheets, fairy lights",
      count: parseInt(row[5]) || 4,
      seed: parseInt(row[6]) || 42,
      explicit_level: parseInt(row[7]) || 2,
    };

    var result = callGenerate(spec);
    var statusCell = sheet.getRange(i + 1, 9);  // col I
    var timeCell = sheet.getRange(i + 1, 10);   // col J

    if (result && result.ok) {
      statusCell.setValue("done");
      timeCell.setValue(new Date().toISOString());
      Logger.log("Generated: " + name + " (" + result.generated + " images)");
    } else {
      statusCell.setValue("error");
      timeCell.setValue(new Date().toISOString());
      Logger.log("Error for: " + name + " — " + JSON.stringify(result));
    }

    processed++;
    Utilities.sleep(1000); // brief pause between requests
  }

  Logger.log("Batch complete. Processed " + processed + " personas.");
}

function callGenerate(spec) {
  try {
    var options = {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(spec),
      muteHttpExceptions: true,
      // Colab generation can take ~90s for 4 images — extend timeout
      followRedirects: true,
    };
    var response = UrlFetchApp.fetch(COLAB_URL + "/generate", options);
    var code = response.getResponseCode();
    if (code !== 200) {
      Logger.log("HTTP " + code + ": " + response.getContentText());
      return { ok: false, error: "HTTP " + code };
    }
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log("Exception: " + e.toString());
    return { ok: false, error: e.toString() };
  }
}

/** Run a full batch send (all unprocessed at once via /batch endpoint). */
function runFullBatch() {
  if (!COLAB_URL) return;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  var data = sheet.getDataRange().getValues();
  var batch = [];
  var rowIndexes = [];

  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    if (row[8] === "done" || row[8] === "error" || row[8] === "skip") continue;
    var name = String(row[0]).trim();
    if (!name) continue;
    batch.push({
      name: name,
      body_type: row[1] || "slim hourglass",
      skin_tone: row[2] || "fair",
      outfit: row[3] || "matching lace lingerie set",
      background: row[4] || "cozy bedroom, unmade white sheets, fairy lights",
      count: parseInt(row[5]) || 4,
      seed: parseInt(row[6]) || 42,
      explicit_level: parseInt(row[7]) || 2,
    });
    rowIndexes.push(i + 1);
  }

  if (!batch.length) {
    Logger.log("Nothing to process");
    return;
  }

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(batch),
    muteHttpExceptions: true,
  };

  var response = UrlFetchApp.fetch(COLAB_URL + "/batch", options);
  var result = JSON.parse(response.getContentText());

  for (var j = 0; j < rowIndexes.length; j++) {
    var r = result.results && result.results[j];
    sheet.getRange(rowIndexes[j], 9).setValue(r && r.ok ? "done" : "error");
    sheet.getRange(rowIndexes[j], 10).setValue(new Date().toISOString());
  }

  Logger.log("Full batch done: " + (result.total || 0) + " personas");
}

/** One-time setup: create the Personas sheet with headers. */
function setupSheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  var headers = [
    "name", "body_type", "skin_tone", "outfit", "background",
    "count", "seed", "explicit_level", "status", "generated_at", "notes"
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");

  // Example personas
  var examples = [
    ["riley",   "slim hourglass", "light tan",   "white crop top, denim shorts",         "sun-lit bathroom mirror",              4, 1001, 2, "", "", ""],
    ["nova",    "curvy",          "deep brown",  "matching red satin set",                "luxury hotel room, city view at night",4, 2002, 2, "", "", ""],
    ["jade",    "petite",         "olive",       "oversized hoodie, nothing underneath",  "college dorm, string lights",          4, 3003, 2, "", "", ""],
    ["venus",   "athletic",       "medium tan",  "sports bra, yoga pants pulled down",   "gym locker room, natural light",       4, 4004, 2, "", "", ""],
    ["luna",    "plus size",      "fair",        "black lace bodysuit",                  "cozy bedroom, unmade white sheets",    4, 5005, 2, "", "", ""],
  ];
  sheet.getRange(2, 1, examples.length, headers.length).setValues(examples);

  Logger.log("Sheet '" + SHEET_NAME + "' created with " + examples.length + " example personas");
}
