import assert from "node:assert/strict";
import test from "node:test";
import { isGallagherBooking as isClientGallagher } from "../lib/gallagher-rules";
import { isGallagherBooking as isHubGallagher } from "../../integration-hub/lib/gallagher-rules";

test("Gallagher detection normalizes the same company and email cases in client and Hub", () => {
  const cases = [
    [{ companyName: " Gallagher ", email: "other@example.com" }, true],
    [{ companyName: "G A L L A G H E R", email: "other@example.com" }, true],
    [{ companyName: "Another client", email: " FRONT@REDINGTON.CO.UK " }, true],
    [{ companyName: "Another client", email: "@redington.co.uk" }, false],
    [{ companyName: "Gallagher-ish", email: "other@example.com" }, false],
    [{ companyName: "Ordinary customer", email: "host@example.com" }, false],
  ] as const;
  for (const [input, expected] of cases) {
    assert.equal(isClientGallagher(input), expected);
    assert.equal(isHubGallagher(input), expected);
    assert.equal(isClientGallagher(input), isHubGallagher(input));
  }
});
