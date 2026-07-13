import styles from '../styles/CompanionDownloadLink.module.css';

export function CompanionDownloadLink({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <a
      className={[styles.link, compact ? styles.compact : '', className ?? '']
        .filter(Boolean)
        .join(' ')}
      href="/api/companion/download"
      download="livekit-companion-setup.cmd"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 3v11m0 0 4-4m-4 4-4-4M5 18h14" />
      </svg>
      <span>
        <small>WINDOWS</small>
        <strong>Скачать companion</strong>
      </span>
    </a>
  );
}
