export function clearDraftAfterSuccess(current: string, submitted: string, succeeded: boolean): string {
  return succeeded && current === submitted ? "" : current;
}
