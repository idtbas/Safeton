import type { AppManifest } from '../../os/apps/registry';
import { cx } from '../../ui';

/**
 * App icon tile: rounded square with a hue-tinted gradient and the app glyph. Used by dock,
 * launcher, desktop icons, window title bars and system search.
 */
export function AppIcon({
  app,
  size = 44,
  className,
}: {
  app: Pick<AppManifest, 'icon' | 'hue'>;
  size?: number;
  className?: string;
}) {
  const Icon = app.icon;
  return (
    <span
      className={cx('ap-icon', className)}
      style={{
        width: size,
        height: size,
        ['--icon-h' as string]: String(app.hue),
        ['--icon-r' as string]: `${Math.round(size * 0.24)}px`,
      }}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.5)} strokeWidth={size >= 32 ? 1.6 : 1.9} />
    </span>
  );
}
