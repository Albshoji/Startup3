import { APPMAP_VERSION, type AppMap, type ClassMapPackage, type Event, type Metadata } from "./types.js";

/** Builds a recording file in the AppMap format. With no events it is still a valid AppMap. */
export function buildAppMap(metadata: Metadata, events: Event[] = [], classMap: ClassMapPackage[] = []): AppMap {
  return {
    version: APPMAP_VERSION,
    metadata,
    classMap,
    events,
  };
}
