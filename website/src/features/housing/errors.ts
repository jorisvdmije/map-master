/** Keep expected source failures useful in the interface without hiding domain errors. */
export function sourceMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === "TimeoutError")
      return "De databron reageert niet op tijd. Probeer het opnieuw.";
    if (error.name === "AbortError")
      return "De bronopvraag is onderbroken. Probeer het opnieuw.";
    if (error instanceof TypeError)
      return "De databron is niet bereikbaar. Controleer je verbinding of probeer het opnieuw.";
    return error.message;
  }
  return "De gegevens konden niet worden opgehaald. Probeer het opnieuw.";
}
