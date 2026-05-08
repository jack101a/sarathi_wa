export function useTheme(isDark) {
  const t_bg          = isDark ? 'bg-dark'   : 'bg-light';
  const t_textHeading = isDark ? 'text-heading-dark'  : 'text-heading-light';
  const t_textMuted   = isDark ? 'text-muted-dark'    : 'text-muted-light';
  const t_rowHover    = isDark ? 'row-hover-dark'     : 'row-hover-light';

  const glassPanel = isDark
    ? 'glass-panel-dark'
    : 'glass-panel-light';

  const glassNav = isDark
    ? 'glass-nav-dark'
    : 'glass-nav-light';

  const glassButton = isDark
    ? 'glass-btn-dark'
    : 'glass-btn-light';

  const solidButton = isDark
    ? 'solid-btn-dark'
    : 'solid-btn-light';

  return { t_bg, t_textHeading, t_textMuted, t_rowHover, glassPanel, glassNav, glassButton, solidButton };
}
