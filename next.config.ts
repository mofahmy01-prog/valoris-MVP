import type { NextConfig } from "next";

/**
 * The SQLite database lives at `prisma/dev.db`, inside the project, so Next's
 * dev file watcher treats every write to it as a source change.
 *
 * The simulator writes on every tick — twice a second at 20x — which triggered
 * a Fast Refresh rebuild roughly every two seconds. The page remounted
 * constantly, and `IncidentMap` was torn down and rebuilt before MapLibre's
 * asynchronous style load could ever complete. The map never finished
 * initialising, so no fire, no crew markers, no basemap tiles: a live map that
 * simply never appeared, with nothing in the console to explain it.
 *
 * Excluding the database from the watcher fixes it. Nothing under `prisma/`
 * that actually matters to the build — the schema, the migrations — changes
 * during a run, and editing the schema requires a migration and a restart
 * anyway.
 */
const nextConfig: NextConfig = {
  webpack: (config) => {
    // Must be plain glob strings — webpack rejects a mixed array, and Next's
    // default value is a RegExp, so it cannot be spread in here.
    config.watchOptions = {
      ...config.watchOptions,
      ignored: [
        "**/node_modules/**",
        "**/.git/**",
        "**/.next/**",
        "**/prisma/*.db",
        "**/prisma/*.db-journal",
        "**/prisma/*.db-wal",
        "**/prisma/*.db-shm",
      ],
    };
    return config;
  },
};

export default nextConfig;
