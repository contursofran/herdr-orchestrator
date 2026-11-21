const MAIN_KEYS = 9;

// Spaces are already in project order within each machine. The keyboard starts with this machine.
export function mainAgents(spaces, projects) {
  const ordered = spaces.slice().sort((a, b) => (a.machine ?? "").localeCompare(b.machine ?? ""));
  return ordered.flatMap((space) => (projects.get(space.id) ?? [])
    .filter((row) => row.live && row.depth === 0 && !row.task)
    .map((row) => ({ row, space }))).slice(0, MAIN_KEYS);
}
