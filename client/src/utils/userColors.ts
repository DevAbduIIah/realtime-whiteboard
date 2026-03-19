const USER_COLORS = [
  { bg: 'bg-blue-500', text: 'text-blue-500', fill: '#3B82F6' },
  { bg: 'bg-emerald-500', text: 'text-emerald-500', fill: '#10B981' },
  { bg: 'bg-violet-500', text: 'text-violet-500', fill: '#8B5CF6' },
  { bg: 'bg-amber-500', text: 'text-amber-500', fill: '#F59E0B' },
  { bg: 'bg-rose-500', text: 'text-rose-500', fill: '#F43F5E' },
  { bg: 'bg-cyan-500', text: 'text-cyan-500', fill: '#06B6D4' },
  { bg: 'bg-fuchsia-500', text: 'text-fuchsia-500', fill: '#D946EF' },
  { bg: 'bg-lime-500', text: 'text-lime-500', fill: '#84CC16' },
];

export function getUserColor(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = userId.charCodeAt(i) + ((hash << 5) - hash);
  }
  const index = Math.abs(hash) % USER_COLORS.length;
  return USER_COLORS[index];
}

export function getUserInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part.charAt(0))
    .slice(0, 2)
    .join('')
    .toUpperCase();
}
