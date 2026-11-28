/** Whether the signed-in user may edit or delete an event. Mirrors the server's rule (app/auth/policy.py), which stays
 * the authority: the form only hides what would be refused. Admins always; the creator; a person the event is for;
 * an event for everyone (no people) only its creator or an admin. */
export function canChangeEvent(user: { id: number; role: "user" | "admin" | "superadmin" }, event: { created_by: number | null; people: number[]; editable?: boolean }): boolean {
  return event.editable ?? (user.role !== "user" || user.id === event.created_by || event.people.includes(user.id));
}
