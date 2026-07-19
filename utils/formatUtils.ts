export const formatDuration = (mins?: number | null): string => {
  if (mins === null || mins === undefined) return 'جاري العمل...';
  const safe = Math.max(0, Math.floor(mins));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}س ${m}د`;
};

export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

export const COLORS = ['#0d9488', '#0f766e', '#115e59', '#134e4a', '#f59e0b'];
