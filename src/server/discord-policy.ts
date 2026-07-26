export type DiscordRequirement = { guildId: string; roleId: string };

export function parseDiscordRequirements(value: string) {
  const seen = new Set<string>();
  const requirements: DiscordRequirement[] = [];
  for (const line of value.split(/[\r\n,]+/)) {
    const [guildId = '', roleId = ''] = line.split(':').map((item) => item.trim());
    if (!/^\d{5,30}$/.test(guildId) || !/^\d{5,30}$/.test(roleId)) continue;
    const key = `${guildId}:${roleId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    requirements.push({ guildId, roleId });
  }
  return requirements;
}

export function matchesDiscordRequirement(
  requirements: DiscordRequirement[],
  memberships: Map<string, string[]>,
) {
  return requirements.some(({ guildId, roleId }) => memberships.get(guildId)?.includes(roleId));
}
