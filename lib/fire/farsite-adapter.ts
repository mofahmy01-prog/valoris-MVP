/**
 * FarsiteAdapter — INTERFACE STUB. DELIBERATELY UNIMPLEMENTED.
 *
 * This exists to prove the boundary: when a fire agency brings a real fire
 * behaviour model to a pilot, it plugs in here and nothing else in Valoris
 * changes. The risk engine does not know this file exists.
 *
 * There is NO FARSITE client here, no HTTP calls, no invented endpoints and no
 * credentials. Writing a speculative client for a system we have not been given
 * access to would be inventing a vendor integration. It stays a stub until a
 * pilot partner provides an actual interface, output format and licence terms.
 *
 * What a real implementation would need, for whoever picks this up:
 *
 *  - An agreed transport (file drop, S3 prefix, or an agency-hosted service)
 *  - The output format: FARSITE emits time-of-arrival grids and perimeter
 *    shapefiles, not lat/lng rings, so a conversion step is required
 *  - The run's ignition time and timestep, to map a perimeter to `validAtMs`
 *  - A stated confidence, or a documented basis for assigning one
 *  - Licence and data-sharing terms, before any incident data leaves the box
 */

import {
  FireFrontUnavailableError,
  type FireFront,
  type FireFrontProvider,
  type FireFrontProviderKey,
  type FireFrontQuery,
} from "./types";

export type FarsiteAdapterConfig = {
  /** Where perimeter exports would be read from. Unset means not configured. */
  perimeterSourceUri?: string;
};

export class FarsiteAdapter implements FireFrontProvider {
  readonly key: FireFrontProviderKey = "farsite_adapter";
  readonly label = "FARSITE adapter (not implemented — future pilot integration)";

  private readonly config: FarsiteAdapterConfig;

  constructor(config: FarsiteAdapterConfig = {}) {
    this.config = config;
  }

  isAvailable(): boolean {
    // Never available in this build. Even with a URI configured there is no
    // parser, and claiming availability would be worse than refusing.
    return false;
  }

  unavailableReason(): string {
    return this.config.perimeterSourceUri === undefined
      ? "Not implemented. No FARSITE source is configured, and Valoris ships no FARSITE client. Requires a pilot partner to supply transport, output format and licence terms."
      : "Not implemented. A source URI is configured but Valoris has no FARSITE perimeter parser in this build.";
  }

  async getFireFront(_query: FireFrontQuery): Promise<FireFront> {
    throw new FireFrontUnavailableError(this.key, this.unavailableReason());
  }
}
