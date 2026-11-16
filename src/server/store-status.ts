export function statusIntentUpdate<T extends string>(current: T, requested: T, explicitlyRequested: boolean) {
  return {
    status: explicitlyRequested ? requested : current,
    refreshTimestamp: explicitlyRequested,
  };
}
