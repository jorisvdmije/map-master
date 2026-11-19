/**
 * The isochrone service for reachability contours. The public Valhalla
 * instance is a fallback for development and demos; deployments set
 * NEXT_PUBLIC_VALHALLA_ENDPOINT to their own or a contracted service.
 */
export const valhallaEndpoint =
  process.env.NEXT_PUBLIC_VALHALLA_ENDPOINT ||
  "https://valhalla1.openstreetmap.de/isochrone";
