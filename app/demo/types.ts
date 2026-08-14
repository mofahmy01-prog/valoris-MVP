/** Shapes the demo page reads from the existing snapshot endpoint. */

export type SnapshotRisk = {
  score: number;
  band: string;
  subscores: {
    physiological: number;
    environmental: number;
    proximity: number;
    profile: number;
  };
  hardOverride: boolean;
  hardOverrideReasons: string[];
  topDrivers: string[];
  explanation: string;
  dataQuality: {
    confidence: string;
    staleInputs: string[];
    missingInputs: string[];
    oldestReadingAgeSec: number;
    note: string;
  };
  modelVersion: string;
  configHash: string;
};

export type SnapshotFirefighter = {
  callsign: string;
  crewName: string;
  deploymentId: string;
  profile: {
    ageYears: number;
    fitness: string;
    respiratoryRisk: string;
    heatTolerance: string;
    conditions: string[];
    prevShiftHours: number;
    restingHrBpm: number;
    spo2BaselinePct: number;
  };
  latestObservationAtUtc: string | null;
  latest: {
    lat: number;
    lng: number;
    hrBpm: number | null;
    spo2Pct: number | null;
    scbaPressurePct: number | null;
    timeOnTaskMin: number;
    coPpm: number | null;
    pm25UgM3: number | null;
    pm25RawUgM3: number | null;
    ambientTempC: number | null;
    glucoseMmolL: number | null;
    distanceToFireFrontM: number | null;
  } | null;
  risk: SnapshotRisk | null;
  physiology: {
    coreTempC: number | null;
    coreTempIsModelled: boolean;
    coreTempSdC: number | null;
    fatiguePct: number | null;
    hrrFraction: number | null;
    dlimMin: number | null;
    cohbPct: number | null;
  } | null;
  reason?: string;
};

export type FireFrontShape = {
  perimeter?: Array<{ lat: number; lng: number }>;
  providerLabel?: string;
  confidence?: string;
  isFireBehaviourPrediction?: boolean;
  provenance?: string;
  unavailableReason?: string;
};

export type Snapshot = {
  incident: {
    id: string;
    name: string;
    status: string;
    centroidLat: number;
    centroidLng: number;
    modelVersion: string;
    configHash: string;
  };
  fireFront: FireFrontShape;
  firefighters: SnapshotFirefighter[];
  provenance: {
    dataTierSummary: string;
    strip: Array<{
      domain: string;
      verdict: string;
      badge: string;
      source: string;
    }>;
  };
  generatedAtUtc: string;
};

export type SimStatus = {
  incidentId: string | null;
  running: boolean;
  speed: number;
  tick: number;
  incidentMinutes: number;
  windShiftActive: boolean;
  windDirDeg?: number;
  windSpeedMs?: number;
  lastError: string | null;
  killed: Array<{ callsign: string; channels: string[] }>;
};
