// Steering limit for the vehicle examples: a driver aid applied to the input before it reaches
// the vehicle, so full lock on a keyboard corners near the front tires' grip limit instead of
// ploughing or spinning. It ships with the presets in box3d.js/vehicles, which are tuned to be
// driven with it; see createSteeringLimiter there.

export { createSteeringLimiter } from 'box3d.js/vehicles';
