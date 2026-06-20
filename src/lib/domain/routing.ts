import type { LatLng, Stop, TravelMode } from './types';
import { routeMeters, routeTravelMin } from './algorithm';

export { routeMeters, routeTravelMin };

export function recalcStopLegs(stops: Stop[], mode: TravelMode = 'walk'): Stop[] {
  return stops.map((stop, index) => {
    if (index === 0) return { ...stop, walkMin: undefined };
    const prev = stops[index - 1];
    return { ...stop, walkMin: Math.round(routeTravelMin(prev, stop, mode)) };
  });
}

export function routeDistanceKm(stops: Stop[], mode: TravelMode = 'walk'): number {
  return stops.reduce((total, stop, index) => {
    if (index === 0) return total;
    return total + routeMeters(stops[index - 1], stop, mode);
  }, 0) / 1000;
}
