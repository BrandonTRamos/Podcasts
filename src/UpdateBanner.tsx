/**
 * Says a new version has been deployed since the app opened, and loads it on
 * Refresh, so there's no need to close and reopen the installed app.
 */
export function UpdateBanner({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="update-banner" role="status">
      <span>A new version is available.</span>
      <button type="button" onClick={onRefresh}>
        Refresh
      </button>
    </div>
  )
}
