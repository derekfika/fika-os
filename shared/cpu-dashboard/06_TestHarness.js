function runCpuPureTests() {
  const results = [];

  cpuAssert_(results, "Calendar title fallback", function() {
    const parsed = parseCpuCalendarTitle_("OAC_Apex Partners_Working Lunch x 42");
    return parsed.siteCode === "OAC" &&
      parsed.clientCompany === "Apex Partners" &&
      parsed.serviceType === "Working Lunch" &&
      parsed.pax === 42;
  });

  cpuAssert_(results, "12-hour time parsing", function() {
    return cpuNormaliseTime_("12:30 pm") === "12:30" &&
      cpuNormaliseTime_("8am") === "08:00";
  });

  cpuAssert_(results, "Quote menu line parsing", function() {
    const items = extractCpuItemsFromText_(
      "08:30 - Smoked salmon bagel x 24\nSeasonal fruit pot x 12"
    );
    return items.length === 2 &&
      items[0].name === "Smoked salmon bagel" &&
      items[0].quantity === 24;
  });

  cpuAssert_(results, "Leading quantity parsing", function() {
    const items = extractCpuItemsFromText_("18 x Mini pastries");
    return items.length === 1 &&
      items[0].name === "Mini pastries" &&
      items[0].quantity === 18;
  });

  cpuAssert_(results, "Gallagher Word quote fields", function() {
    const parsed = parseCpuTextFields_([
      "Fika (Floor 6th Floor)",
      "@One Angel Court Thursday",
      "Number: x10",
      "Date: 25/06/2026",
      "Service Type: Lunch",
      "Delivery Time: 11:30",
      "Service Time: 11:30",
      "Location: One Angel Court",
      "HOST: WPF Board Meeting - BU958532",
      "LUNCH",
      "11:30 - Deli Style Working Lunch (minimum order of 8) x 10"
    ].join("\n"));
    return parsed.pax === 10 &&
      parsed.serviceType === "Lunch" &&
      parsed.deliveryTime === "11:30" &&
      parsed.location === "One Angel Court" &&
      parsed.hostName === "WPF Board Meeting - BU958532" &&
      parsed.items.length === 1 &&
      parsed.items[0].quantity === 10;
  });

  cpuAssert_(results, "Legacy calendar title pax fallbacks", function() {
    return parseCpuCalendarTitle_("Munich Re_Ulrich_Lunchx25").pax === 25 &&
      parseCpuCalendarTitle_("03.06.26 Nader Asgari - Elizabeth School - Lunch x 14").pax === 14 &&
      parseCpuCalendarTitle_("Commerzbank_Jacket Potatoes_Qty x20").pax === 20;
  });

  cpuAssert_(results, "Description Drive links become attachments", function() {
    const values = extractCpuDescriptionAttachments_(
      'Menu<br><a href="https://docs.google.com/document/d/1oxk5IC5kQC5QVNrA4rN5s9y4YJcVWXQT/edit?usp=sharing&amp;sd=true">Hospitality Menu.docx</a>'
    );
    return values.length === 1 &&
      values[0].fileId === "1oxk5IC5kQC5QVNrA4rN5s9y4YJcVWXQT" &&
      values[0].mimeType.indexOf("wordprocessingml") !== -1;
  });

  cpuAssert_(results, "Legacy DOCX quote and XLSX form classification", function() {
    const classified = classifyCpuAttachments_([
      {
        title: "Angel Court Booking Form.xlsx",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        fileId: "spreadsheet-file-id-123456789"
      },
      {
        title: "Gallagher Sandwich Lunch x 16.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        fileId: "word-quote-file-id-123456789"
      }
    ]);
    return /\.docx$/i.test(classified.quote.title) &&
      /\.xlsx$/i.test(classified.form.title);
  });

  cpuAssert_(results, "Canonical booking JSON is classified and normalised", function() {
    const classified = classifyCpuAttachments_([
      {
        title: "Quote - Example Client.docx",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
      },
      {
        title: "Booking Object - AC-TEST-001.json",
        mimeType: "application/json"
      }
    ]);
    const normalised = normaliseCpuBookingJson_({
      bookingId: "AC-TEST-001",
      clientCompany: "Example Client",
      pax: 12,
      serviceType: "Breakfast",
      serviceTimes: ["08:30"],
      location: "1 Angel Court, London",
      floor: "7",
      items: [
        { name: "Mini Pastries", qty: 2, info: "Serves 12", detail: "Mixed" }
      ],
      clientBooking: {
        dietaries: { vegetarian: 2, allergyDetails: "Nut allergy" }
      }
    });
    return classified.json &&
      /\.json$/i.test(classified.json.title) &&
      normalised.clientCompany === "Example Client" &&
      normalised.items.length === 1 &&
      normalised.items[0].quantity === 2 &&
      normalised.dietary.indexOf("Nut allergy") !== -1;
  });

  cpuAssert_(results, "Calendar event without JSON keeps event update fingerprint", function() {
    return getCpuEventSourceVersion_({
      updated: "2026-06-22T12:00:00.000Z",
      attachments: []
    }) === "2026-06-22T12:00:00.000Z";
  });

  cpuAssert_(results, "Allergen quantity is not a line item", function() {
    const parsed = parseCpuTextFields_([
      "Number: x16",
      "11:30 - Deli Style Working Lunch (minimum order of 8) x 16",
      "1 allergy to shrimp"
    ].join("\n"));
    return parsed.items.length === 1 &&
      parsed.items[0].name === "Deli Style Working Lunch (minimum order of 8)" &&
      parsed.dietary === "allergy to shrimp";
  });

  cpuAssert_(results, "Comments move to chef notes", function() {
    const cleaned = sanitiseCpuParsedData_({
      items: [
        { quantity: 12, name: "Mini pastries", notes: "" },
        { quantity: 1, name: "Note: deliver to reception", notes: "" }
      ],
      notes: "",
      dietary: ""
    }, "");
    return cleaned.items.length === 1 &&
      cleaned.items[0].name === "Mini pastries" &&
      cleaned.notes === "deliver to reception";
  });

  cpuAssert_(results, "Booking form boilerplate is discarded", function() {
    const cleaned = sanitiseCpuParsedData_({
      items: [],
      dietary: "& Dietary Requirements - All allergen and dietary requirements must be provided at least 3 working days prior to the event.",
      notes: "Please ensure all green shaded boxes are completed, and then save a copy and send it to ashley@fikacatering.com"
    }, "");
    return cleaned.dietary === "" && cleaned.notes === "";
  });

  cpuAssert_(results, "Service times are stripped from products", function() {
    return cleanCpuProductName_("8:30am - Fresh Sliced Fruit Platter") === "Fresh Sliced Fruit Platter" &&
      cleanCpuProductName_("08:30 - Mini Pastries") === "Mini Pastries";
  });

  cpuAssert_(results, "Food exclusions become dietary notes", function() {
    const cleaned = sanitiseCpuParsedData_({
      items: [
        { quantity: 2, name: "No Beef", notes: "" },
        { quantity: 3, name: "No fish", notes: "" },
        { quantity: 12, name: "Deli Style Working Lunch", notes: "" }
      ],
      notes: "",
      dietary: ""
    }, "");
    return cleaned.items.length === 1 &&
      cleaned.items[0].name === "Deli Style Working Lunch" &&
      cleaned.dietary.indexOf("No Beef") !== -1 &&
      cleaned.dietary.indexOf("No fish") !== -1;
  });

  cpuAssert_(results, "Timed delegate lunch line is parsed", function() {
    const parsed = parseCpuTextFields_([
      "Service Type: Morning Day Delegate Package",
      "Dietary requirements",
      "9am - Breakfast Continental Day Package",
      "150x tea & coffee, biscuits, filtered water",
      "13:55pm-14:55pm - 150 x Deli Style Working Lunch From FIKA X ONLY!!",
      "150 x T&C",
      "150x Sweet treat"
    ].join("\n"));
    const lunch = parsed.items.filter(function(item) {
      return item.name.indexOf("Deli Style Working Lunch") !== -1;
    })[0];
    return Boolean(lunch) &&
      lunch.quantity === 150 &&
      parsed.dietary === "";
  });

  cpuAssert_(results, "Authoritative site directory is unique", function() {
    if (typeof CPU_SITE_DIRECTORY === "undefined") return true;
    const ids = CPU_SITE_DIRECTORY.map(function(site) { return site.id.toLowerCase(); });
    return CPU_SITE_DIRECTORY.length === 16 &&
      new Set(ids).size === 16 &&
      ids.indexOf("seven@fikacatering.com") !== -1 &&
      ids.indexOf("munichre@fikacatering.com") !== -1 &&
      ids.indexOf("58ve@fikacatering.com") !== -1;
  });

  cpuAssert_(results, "Priced package line is parsed", function() {
    const parsed = parseCpuTextFields_([
      "12:30pm - Lunch",
      "10x Salad & Protein - £14.00 p/p = £140.00",
      "Example Menu",
      "- Lebanese Pulled Chicken, Mint Yoghurt, Seeded Toast & Pomegranate",
      "Delivery Charge: £35.00",
      "TOTAL NET: £175.00"
    ].join("\n"));
    return parsed.items.length === 1 &&
      parsed.items[0].quantity === 10 &&
      parsed.items[0].name === "Salad & Protein";
  });

  cpuAssert_(results, "HTML notes and repeated dietary labels are cleaned", function() {
    const cleaned = sanitiseCpuParsedData_({
      items: [],
      dietary: "No Nuts / 1 no pork\nDietary requirements: No Nuts / 1 no pork",
      notes: 'Menu-<a href="https://docs.google.com/document/d/abc1234567890123456789012/edit">https://docs.google.com/document/d/abc1234567890123456789012/edit</a>'
    }, "");
    return cleaned.dietary === "No Nuts / 1 no pork" &&
      cleaned.notes === "";
  });

  cpuAssert_(results, "DOCX text-box XML is extracted", function() {
    const xml = [
      '<w:document xmlns:w="urn:test"><w:body>',
      '<w:p><w:r><w:t>12:30pm - Lunch</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>10x Salad &amp; Protein - £14.00 p/p = £140.00</w:t></w:r></w:p>',
      '</w:body></w:document>'
    ].join("");
    const text = extractCpuWordXmlText_(xml);
    const parsed = parseCpuTextFields_(text);
    return text.indexOf("10x Salad & Protein") !== -1 &&
      parsed.items.length === 1 &&
      parsed.items[0].name === "Salad & Protein" &&
      parsed.items[0].quantity === 10;
  });

  cpuAssert_(results, "Split CFC package text is parsed", function() {
    const parsed = parseCpuTextFields_([
      "Number: 10x",
      "12:30pm - Lunch",
      "10",
      "x",
      "Salad & Protein",
      "-",
      "£",
      "14.00 p/p = £140.00",
      "Example Menu"
    ].join("\n"));
    return parsed.items.length === 1 &&
      parsed.items[0].quantity === 10 &&
      parsed.items[0].name === "Salad & Protein";
  });

  cpuAssert_(results, "CFC heading and product on one line is parsed", function() {
    const parsed = parseCpuTextFields_([
      "Event/Service: Lunch",
      "Number: 10x Service Time: 12:30PM",
      "12:30pm - Lunch 10x Salad & Protein - £14.00 p/p = £140.00",
      "Example Menu",
      "Delivery Charge: £35.00"
    ].join("\n"));
    return parsed.items.length === 1 &&
      parsed.items[0].quantity === 10 &&
      parsed.items[0].name === "Salad & Protein";
  });

  cpuAssert_(results, "Priced menu items may contain dietary words", function() {
    const parsed = parseCpuTextFields_([
      "Dietary Requirements:",
      "Allergens:",
      "Notes: Please provide at least 5 dipping sauce pots each",
      "MENU",
      "1x - Char-Siu Pulled Chicken Roll with Soy Dipping Sauce £37.50",
      "1x - Rainbow Vegetable Roll with Peanutless Satay Sauce (Vegan) £37.50",
      "Delivery Charge: £35"
    ].join("\n"));
    return parsed.items.length === 2 &&
      parsed.items[0].quantity === 1 &&
      parsed.items[0].name.indexOf("Char-Siu Pulled Chicken Roll") !== -1 &&
      parsed.items[1].name.indexOf("Rainbow Vegetable Roll") !== -1 &&
      parsed.notes.indexOf("dipping sauce pots") !== -1;
  });

  cpuAssert_(results, "Product heading above price calculation is parsed", function() {
    const parsed = parseCpuTextFields_([
      "12:30pm",
      "Sandwich Lunch",
      "£7.00 p/p x 22 = £154.00",
      "A selection of deli-style sandwiches/wraps served with root vegetable crisps.",
      "Side Salads",
      "£3.95p/p x 22 = £86.90",
      "Finger Food",
      "£3.95p/p x 22 = £86.90",
      "Sweet Potato Falafel with Beetroot Hummus",
      "Dietary Requirements",
      "x Vegetarian",
      "x Gluten Free"
    ].join("\n"));
    return parsed.items.length === 3 &&
      parsed.items[0].name === "Sandwich Lunch" &&
      parsed.items[0].quantity === 22 &&
      parsed.items[1].name === "Side Salads" &&
      parsed.items[2].name === "Finger Food" &&
      parsed.dietary.indexOf("Vegetarian") !== -1 &&
      parsed.dietary.indexOf("Gluten Free") !== -1;
  });

  cpuAssert_(results, "Per-person package inherits booking pax", function() {
    const parsed = parseCpuTextFields_([
      "Number: x200",
      "Service Type: Evening Event",
      "Service Time: 6-8pm",
      "Drinks Package - £6,000",
      "(Beers, house wine & soft drinks)",
      "Premium BBQ £32.50pp - £6,500",
      "Beef and mature cheddar brioche burger.",
      "Plant based brioche burger.",
      "Smoked ribs with BBQ glaze.",
      "Additional Labour - £1,198.08",
      "x4 Fika team members to set up and serve",
      "BBQ & Gas hire x 2 - £484.32",
      "TOTAL NET: £15,316.99"
    ].join("\n"));
    return parsed.pax === 200 &&
      parsed.serviceTime === "18:00" &&
      parsed.items.length === 1 &&
      parsed.items[0].name === "Premium BBQ" &&
      parsed.items[0].quantity === 200;
  });

  cpuAssert_(results, "Munich RE reversed quantities and dates are parsed", function() {
    const parsed = parseCpuTextFields_([
      "CLIENT: MUNICH RE",
      "Menu/Event: Lunch",
      "Number: 10",
      "Date: Monday",
      "15 June 2026",
      "Delivery Time: 10:00",
      "Dietary Requirements: x1 Gluten free",
      "Notes: Please deliver everything in the morning as we have fridges on site.",
      "9:50 - Refreshments",
      "X10 Tea/Coffee/Biscuits",
      "X6 Canned Soft Drinks (including diet coke)",
      "12:00 – Lunch - (One attendee is gluten free. Please can their food be set to one side and highlighted)",
      "X1 Deli Style Sandwich Platter Mixed £50.00 (for 5 people in total)",
      "Fresh Made Deli Style Sandwiches on Focaccia, Ciabatta, Baguettes & Wraps.",
      "X1 Salad & Protein Lunch Platter £70.00 (for 5 people in total)",
      "A selection of 4 different composite salads, plus one meat protein, one fish protein, and one veggie/vegan protein",
      "X10 Tea/Coffee",
      "X8 Canned Soft Drinks (including diet coke)"
    ].join("\n"));
    const names = parsed.items.map(function(item) { return item.name; });
    return parsed.items.length === 6 &&
      names.indexOf("June 2026") === -1 &&
      parsed.items[0].name === "Tea/Coffee/Biscuits" &&
      parsed.items[0].quantity === 10 &&
      names.indexOf("Deli Style Sandwich Platter Mixed") !== -1 &&
      parsed.items.filter(function(item) { return item.name === "Deli Style Sandwich Platter Mixed"; })[0].quantity === 5 &&
      names.indexOf("Salad & Protein Lunch Platter") !== -1 &&
      parsed.dietary.indexOf("x1 Gluten free") !== -1 &&
      parsed.dietary.indexOf("veggie/vegan protein") === -1;
  });

  cpuAssert_(results, "Soy menu item remains a production line", function() {
    const parsed = parseCpuTextFields_([
      "Number: 40",
      "Dietary Requirements: NO",
      "17:30 - Event",
      "X3 Summer Pea, Mascarpone & Pesto Tartlet",
      "X3 Traditional Falafel & Tahini Dip",
      "X3 Vegetable Gyoza, Soy Dipping Sauce",
      "X1 Gluten free"
    ].join("\n"));
    const gyoza = parsed.items.filter(function(item) {
      return item.name === "Vegetable Gyoza, Soy Dipping Sauce";
    })[0];
    return Boolean(gyoza) &&
      gyoza.quantity === 3 &&
      parsed.dietary.indexOf("NO") === -1 &&
      parsed.dietary.indexOf("Vegetable Gyoza") === -1 &&
      parsed.items.every(function(item) { return item.name.toLowerCase() !== "gluten free"; });
  });

  cpuAssert_(results, "Vegetarian shorthand becomes dietary split", function() {
    const parsed = parseCpuTextFields_([
      "Number: x18",
      "11:30 - Deli Style Working Lunch (minimum order of 8) x 18",
      "3x vege",
      "Order Total: GBP 197.10"
    ].join("\n"));
    return parsed.items.length === 1 &&
      parsed.items[0].name === "Deli Style Working Lunch (minimum order of 8)" &&
      parsed.items[0].quantity === 18 &&
      parsed.dietary.toLowerCase().indexOf("3x vege") !== -1;
  });

  cpuAssert_(results, "Sesame ingredient remains a production item", function() {
    const parsed = parseCpuTextFields_([
      "Dietary requirements: tbc",
      "MAINS",
      "35x - Panko Crumbed chicken thigh nuggets fried and seasoned",
      "5x - Caramelised Miso-Glazed Aubergine & Sesame Dressing",
      "SALADS",
      "- Broccoli & Edamame with Black Rice Vinegar & Sesame",
      "Dietary: 1 sesame allergy"
    ].join("\n"));
    const aubergine = parsed.items.filter(function(item) {
      return item.name.indexOf("Miso-Glazed Aubergine") !== -1;
    })[0];
    return Boolean(aubergine) &&
      aubergine.quantity === 5 &&
      parsed.dietary.indexOf("Miso-Glazed Aubergine") === -1 &&
      parsed.dietary.indexOf("Broccoli & Edamame") === -1 &&
      parsed.dietary.indexOf("sesame allergy") !== -1;
  });

  const failed = results.filter(function(result) { return !result.ok; });
  if (failed.length) {
    throw new Error(failed.length + " CPU tests failed: " + JSON.stringify(failed));
  }
  return { ok: true, passed: results.length, results: results };
}

function cpuAssert_(results, name, test) {
  try {
    const ok = Boolean(test());
    results.push({ name: name, ok: ok });
  } catch (error) {
    results.push({ name: name, ok: false, error: error.message });
  }
}
