export const TOUR_START = "spx-tour-start";
export const TOUR_KEY = "spx-tour-step";

/** Starts the tour from anywhere (the "Take the tour" buttons). */
export function startTour() {
  window.dispatchEvent(new Event(TOUR_START));
}
