/**
 * Browser tab title showing the unread count while signed in, e.g.
 * "(3) Notifications". Falls back to the plain base title otherwise.
 */
export function formatTabTitle(
  unreadCount: number,
  isAuthenticated: boolean,
): string {
  if (isAuthenticated && unreadCount > 0) {
    return `(${unreadCount}) Notifications`;
  }
  return "Notifications";
}
