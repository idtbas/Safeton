/** Simulation-level reliability assumptions not tied to a single catalog part. */

/** Server fan module AFR (assumption). */
export const FAN_AFR = 0.02;
/** Optical transceiver / cable induced link flaps per rail-year (assumption). */
export const LINK_FLAP_AFR = 0.03;
/** Software / firmware induced node crashes (kernel panic, hangs) per node-year (assumption). */
export const CRASH_NODE_AFR = 0.05;
