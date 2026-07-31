export const getRemaining = (target: number, serverOffsetMs: number, clientNow = Date.now()) =>
  Math.max(0, target - (clientNow + serverOffsetMs));

export const splitDuration = (durationMs: number) => {
  const seconds = Math.floor(durationMs / 1000);
  return {
    days: Math.floor(seconds / 86400),
    hours: Math.floor((seconds % 86400) / 3600),
    minutes: Math.floor((seconds % 3600) / 60),
    seconds: seconds % 60,
  };
};
