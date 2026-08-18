import type { CanonicalRecord } from "./types";

export const CountryCodes =
  "AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ VA VC VE VG VI VN VU WF WS YE YT ZA ZM ZW".split(
    " ",
  );

const displayNames =
  typeof Intl !== "undefined" && "DisplayNames" in Intl
    ? new Intl.DisplayNames(["en-GB"], { type: "region" })
    : null;

export type AddressValues = {
  addressLine1: string;
  addressLine2?: string;
  addressLine3?: string;
  locality: string;
  region?: string;
  postalCode?: string;
  countryCode: string;
  lifecycleState?: "active" | "retired";
  evidenceReferences?: string[];
};

export type AddressDuplicateCandidate = {
  canonicalId: string;
  label: string;
  reason: string;
  confidence: number;
  exact: boolean;
  published: boolean;
};

export type LegacyAddressEvidence = {
  sourceReference: string;
  originals: { source: string; value: string }[];
  proposed: Partial<AddressValues>;
  derivedFields: string[];
  conflicts: string[];
  warnings: string[];
};

export function countryLabel(code: string) {
  const normalised = code.toUpperCase();
  return displayNames?.of(normalised) || normalised;
}

export function formatAddress(value: Record<string, unknown>) {
  return [
    value.addressLine1,
    value.addressLine2,
    value.addressLine3,
    value.locality,
    value.region,
    value.postalCode,
    value.countryCode,
  ]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(", ");
}

export function normaliseAddressValues(
  value: Record<string, unknown>,
): AddressValues {
  const countryCode = String(value.countryCode || "")
    .trim()
    .toUpperCase();
  const postalCode = normalisePostalDisplay(value.postalCode, countryCode);
  return {
    addressLine1: normaliseAddressText(value.addressLine1),
    ...(normaliseAddressText(value.addressLine2)
      ? { addressLine2: normaliseAddressText(value.addressLine2) }
      : {}),
    ...(normaliseAddressText(value.addressLine3)
      ? { addressLine3: normaliseAddressText(value.addressLine3) }
      : {}),
    locality: normaliseAddressText(value.locality),
    ...(normaliseAddressText(value.region)
      ? { region: normaliseAddressText(value.region) }
      : {}),
    ...(postalCode ? { postalCode } : {}),
    countryCode,
    lifecycleState: value.lifecycleState === "retired" ? "retired" : "active",
    evidenceReferences: Array.isArray(value.evidenceReferences)
      ? [
          ...new Set(
            value.evidenceReferences
              .map(String)
              .map((item) => item.trim())
              .filter(Boolean),
          ),
        ]
      : [],
  };
}

export function legacyAddressEvidence(
  record: CanonicalRecord,
): LegacyAddressEvidence | undefined {
  if (record.entityType !== "Site") return undefined;
  const ownership = record.record.ownership as
    { providerOwned?: Record<string, unknown> } | undefined;
  const candidates = [
    {
      source: "Preserved legacy Site candidate",
      value: stringValue(record.record.address),
    },
    {
      source: "Preserved provider-owned Site evidence",
      value: stringValue(ownership?.providerOwned?.address),
    },
  ].filter((item): item is { source: string; value: string } =>
    Boolean(item.value),
  );
  const originals = candidates.filter(
    (item, index) =>
      candidates.findIndex(
        (candidate) =>
          normaliseText(candidate.value) === normaliseText(item.value),
      ) === index,
  );
  if (!originals.length) return undefined;
  const conflicts =
    originals.length > 1
      ? [
          "Preserved sources contain different address text. Review each source before choosing canonical values.",
        ]
      : [];
  const proposed = parseDelimitedAddress(
    originals[0]!.value,
    stringValue(ownership?.providerOwned?.country),
  );
  return {
    sourceReference: record.canonicalId,
    originals,
    proposed: {
      ...proposed,
      evidenceReferences: [record.canonicalId],
      lifecycleState: "active",
    },
    derivedFields: Object.keys(proposed),
    conflicts,
    warnings: [
      "All proposed fields were derived from preserved evidence and remain unapproved until an authorised save.",
      ...(Object.keys(proposed).length
        ? []
        : [
            "The evidence could not be mapped safely; enter the structured fields manually.",
          ]),
    ],
  };
}

export function addressDuplicateCandidates(
  proposed: Record<string, unknown>,
  records: CanonicalRecord[],
  excludeCanonicalId?: string,
): AddressDuplicateCandidate[] {
  const target = comparable(proposed);
  return records
    .filter(
      (record) =>
        record.entityType === "Address" &&
        record.canonicalId !== excludeCanonicalId,
    )
    .flatMap((record) => {
      const candidate = comparable(record.record);
      const exact = [...target].every(
        ([key, value]) => candidate.get(key) === value,
      );
      const samePostal =
        Boolean(target.get("postalCode")) &&
        target.get("postalCode") === candidate.get("postalCode") &&
        target.get("countryCode") === candidate.get("countryCode");
      const samePremises =
        samePostal &&
        target.get("addressLine1") === candidate.get("addressLine1");
      if (!exact && !samePremises && !samePostal) return [];
      return [
        {
          canonicalId: record.canonicalId,
          label: formatAddress(record.record),
          reason: exact
            ? "Exact normalised structured-address match"
            : samePremises
              ? "Same normalised premises line and postal code"
              : "Same postal code; separate sub-premises may still be legitimate",
          confidence: exact ? 1 : samePremises ? 0.9 : 0.55,
          exact,
          published:
            record.lifecycleStatus === "published" &&
            record.publicationStatus === "published",
        },
      ];
    })
    .sort(
      (left, right) =>
        right.confidence - left.confidence ||
        left.canonicalId.localeCompare(right.canonicalId),
    );
}

export function normalisePostalCode(value: unknown) {
  return String(value || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function exactAddressCandidate(candidates: AddressDuplicateCandidate[]) {
  return candidates.find((candidate) => candidate.exact);
}
export function likelyAddressCandidates(
  candidates: AddressDuplicateCandidate[],
) {
  return candidates.filter(
    (candidate) => !candidate.exact && candidate.confidence >= 0.8,
  );
}

export function postcodeOnlyAddressCandidates(
  candidates: AddressDuplicateCandidate[],
) {
  return candidates.filter(
    (candidate) => !candidate.exact && candidate.confidence < 0.8,
  );
}

function parseDelimitedAddress(
  text: string,
  providerCountry?: string,
): Partial<AddressValues> {
  const parts = text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (!parts.length) return {};
  let countryCode = "";
  const last = parts.at(-1)?.toUpperCase() || "";
  if (CountryCodes.includes(last)) {
    countryCode = last;
    parts.pop();
  } else if (
    providerCountry &&
    CountryCodes.includes(providerCountry.toUpperCase())
  )
    countryCode = providerCountry.toUpperCase();
  const postalCode = parts.length >= 2 ? parts.pop() : undefined;
  const locality = parts.length >= 2 ? parts.pop() : undefined;
  const lines = parts;
  const proposed: Partial<AddressValues> = {};
  if (lines[0]) proposed.addressLine1 = lines[0];
  if (lines[1]) proposed.addressLine2 = lines[1];
  if (lines.length > 2) proposed.addressLine3 = lines.slice(2).join(", ");
  if (locality) proposed.locality = locality;
  if (postalCode) proposed.postalCode = postalCode;
  if (countryCode) proposed.countryCode = countryCode;
  return proposed;
}

function comparable(value: Record<string, unknown>) {
  return new Map(
    [
      "addressLine1",
      "addressLine2",
      "addressLine3",
      "locality",
      "region",
      "postalCode",
      "countryCode",
    ].map((key) => [
      key,
      key === "postalCode"
        ? normalisePostalCode(value[key])
        : normaliseText(value[key]),
    ]),
  );
}
function normaliseText(value: unknown) {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("en-GB")
    .replace(/\s+/g, " ");
}
function stringValue(value: unknown) {
  const text = String(value || "").trim();
  return text || undefined;
}

function normaliseAddressText(value: unknown) {
  const text = String(value || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text || (/[a-z]/.test(text) && /[A-Z]/.test(text))) return text;
  return text
    .toLocaleLowerCase("en-GB")
    .replace(/(^|[\s\-/'])\p{L}/gu, (character) =>
      character.toLocaleUpperCase("en-GB"),
    );
}

function normalisePostalDisplay(value: unknown, countryCode: string) {
  const compact = normalisePostalCode(value);
  if (!compact) return "";
  if (countryCode === "GB" && compact.length >= 5 && compact.length <= 8)
    return `${compact.slice(0, -3)} ${compact.slice(-3)}`;
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
}
