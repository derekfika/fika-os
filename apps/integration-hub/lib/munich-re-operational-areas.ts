export const MunichReOplocId = "oploc:95d84de6-b3f5-4c8f-b3a7-6a313b17d701";
export const MunichReFifthFloorSquareSiteId = "site:66312780d16e4e266674";
export const MunichReThirdFloorSquareSiteId = "site:810bcbfeb2a6e027e709";

export const MunichReOperationalAreaTypes = [
  { name: "Coffee Bar", description: "A coffee-focused service point." },
  { name: "Hot Food Servery", description: "A hot-food service counter." },
  { name: "Retail / Grab-and-Go", description: "A retail or grab-and-go service point." },
] as const;

export const MunichReOperationalAreas = [
  {
    name: "3rd Floor Coffee Bar",
    areaTypeName: "Coffee Bar",
    floorLevel: 3,
    description: "Main third-floor coffee service point",
  },
  {
    name: "5th Floor Coffee Bar",
    areaTypeName: "Coffee Bar",
    floorLevel: 5,
    description:
      "Fifth-floor coffee service point; preserves continuity with the former Munich RE 5th Floor identity and provider mappings",
  },
  {
    name: "2nd Floor Hot Food Servery",
    areaTypeName: "Hot Food Servery",
    floorLevel: 2,
    description: "Hot-food service counter",
  },
  {
    name: "2nd Floor Confectionery Stand",
    areaTypeName: "Retail / Grab-and-Go",
    floorLevel: 2,
    description: "Confectionery and retail service point",
  },
] as const;
