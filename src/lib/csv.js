function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === "\"") {
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }

      continue;
    }

    if (char === "," && !inQuotes) {
      values.push(current.trim());
      current = "";
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsvText(csvText) {
  const raw = String(csvText || "").trim();

  if (!raw) {
    throw new Error("CSV text is empty.");
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    throw new Error("CSV must contain a header row and at least one data row.");
  }

  const headers = parseCsvLine(lines[0]).map((header) => header.toLowerCase());
  const rows = [];

  for (const line of lines.slice(1)) {
    const values = parseCsvLine(line);
    const record = {};

    headers.forEach((header, index) => {
      record[header] = values[index] ?? "";
    });

    rows.push({
      routeName: record.route_name || record.routename || record.route || "",
      passengerCount: record.passenger_count || record.passengercount || record.passengers || "",
      delayMinutes: record.delay_minutes || record.delayminutes || record.delay || 0,
      timestamp: record.timestamp || record.trip_timestamp || record.datetime || ""
    });
  }

  return rows;
}

module.exports = {
  parseCsvText
};
