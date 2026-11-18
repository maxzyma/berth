/** The times *Remind Me Later…* offers (spec §6). */
export function reminderChoices(now: Date): { label: string; at: number }[] {
  const minutes = (n: number) => now.getTime() + n * 60_000;
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  return [
    { label: 'In 30 minutes', at: minutes(30) },
    { label: 'In 1 hour', at: minutes(60) },
    { label: 'In 3 hours', at: minutes(180) },
    { label: 'Tomorrow at 9:00', at: tomorrow.getTime() },
  ];
}
