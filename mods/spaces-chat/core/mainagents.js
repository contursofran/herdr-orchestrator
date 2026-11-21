const MAIN_KEYS = 9;

// Spaces are in the order shown in the Projects sidebar.
export function mainAgents(spaces, projects) {
  return spaces.flatMap((space) => (projects.get(space.id) ?? [])
    .filter((row) => row.live && row.depth === 0 && !row.task && !["worker", "helper", "reviewer"].includes(row.role))
    .map((row) => ({ row, space }))).slice(0, MAIN_KEYS);
}
